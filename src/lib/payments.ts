import { Order, Prisma, RefundReasonCode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { transition, InvalidTransitionError, CHARGE_RETRY_OFFSETS_MIN, FIX_CARD_WINDOW_MS, SECOND_CHANCE_WINDOW_MS, PAYMENT_FAILURES_BEFORE_SUSPENSION, RESTOCKING_FEE_PCT, CANCEL_WINDOW_MS, OUR_FAULT_CREDIT_CENTS } from "@/lib/auction/state-machine";
import { queueNotification } from "@/lib/notifications";
import { broadcastAuction } from "@/lib/realtime";
import { endOfDayInVancouver } from "@/lib/time";

/**
 * Payments + the §6 cancellation/refund matrix.
 *
 * All Stripe traffic goes through a tiny PaymentGateway so the entire matrix
 * (retry ladder, second-chance offers, cancellation windows, suspension) is
 * integration-tested against a fake gateway; production uses Stripe with
 * idempotency keys on every mutating call.
 */

// --- Gateway ---------------------------------------------------------------

export type ChargeResult =
  | { ok: true; paymentIntentId: string }
  | { ok: false; paymentIntentId?: string; declineCode?: string };

export interface PaymentGateway {
  charge(opts: {
    customerId: string;
    paymentMethodId: string;
    amountCents: number;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<ChargeResult>;
  refund(opts: {
    paymentIntentId: string;
    amountCents: number;
    idempotencyKey: string;
  }): Promise<{ refundId: string }>;
}

const stripeGateway: PaymentGateway = {
  async charge(opts) {
    try {
      const intent = await stripe().paymentIntents.create(
        {
          amount: opts.amountCents,
          currency: "cad",
          customer: opts.customerId,
          payment_method: opts.paymentMethodId,
          off_session: true,
          confirm: true,
          metadata: opts.metadata,
        },
        { idempotencyKey: opts.idempotencyKey },
      );
      if (intent.status === "succeeded") return { ok: true, paymentIntentId: intent.id };
      return { ok: false, paymentIntentId: intent.id };
    } catch (e) {
      const err = e as { payment_intent?: { id: string }; decline_code?: string; code?: string };
      return {
        ok: false,
        paymentIntentId: err.payment_intent?.id,
        declineCode: err.decline_code ?? err.code,
      };
    }
  },
  async refund(opts) {
    const refund = await stripe().refunds.create(
      { payment_intent: opts.paymentIntentId, amount: opts.amountCents },
      { idempotencyKey: opts.idempotencyKey },
    );
    return { refundId: refund.id };
  },
};

let gateway: PaymentGateway = stripeGateway;
/** Test seam — swap the gateway in integration tests. */
export function setPaymentGateway(g: PaymentGateway | null) {
  gateway = g ?? stripeGateway;
}

// --- Tax -------------------------------------------------------------------

/**
 * BC GST 5% + PST 7%. Flat local calculation; `stripe.tax.calculations` can
 * replace this behind the same signature once Stripe Tax is enabled on the
 * account (registration required) — the rates for cut flowers in BC are flat,
 * so the numbers are identical either way.
 */
export function calculateTax(subtotalCents: number): { gstCents: number; pstCents: number; totalCents: number } {
  const gstCents = Math.round(subtotalCents * 0.05);
  const pstCents = Math.round(subtotalCents * 0.07);
  return { gstCents, pstCents, totalCents: subtotalCents + gstCents + pstCents };
}

// --- Charging --------------------------------------------------------------

export class PaymentError extends Error {
  constructor(
    public readonly code: "NO_CARD" | "DECLINED" | "BAD_STATE",
    message: string,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}

/**
 * Charge an order on the buyer's default saved card.
 *
 * `mode: "off_session"` (auction close): failures walk the §6 ladder —
 * immediate retry, then cron retries at 30/60/120 min with a 2-hour
 * fix-your-card window, then the second-chance offer.
 * `mode: "interactive"` (buy-now): a decline throws immediately; the caller
 * reverts state and tells the buyer.
 */
export async function chargeOrder(orderId: string, mode: "off_session" | "interactive"): Promise<boolean> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      user: {
        select: {
          id: true,
          stripeCustomerId: true,
          paymentMethods: { where: { isDefault: true }, take: 1 },
        },
      },
    },
  });
  if (order.status !== "PENDING_CHARGE") throw new PaymentError("BAD_STATE", `Order is ${order.status}`);

  const attempt = order.chargeAttempts + 1;
  await prisma.order.update({ where: { id: orderId }, data: { chargeAttempts: attempt } });

  const card = order.user.paymentMethods[0];
  if (!card || !order.user.stripeCustomerId) {
    // No card at all: skip the pointless immediate retry, but enter the
    // fix-your-card window right away so the ladder still runs.
    await recordChargeFailure(order, Math.max(attempt, 2), "no_saved_card", mode);
    if (mode === "interactive") throw new PaymentError("NO_CARD", "No saved card — add one first.");
    return false;
  }

  const result = await gateway.charge({
    customerId: order.user.stripeCustomerId,
    paymentMethodId: card.stripePaymentMethodId,
    amountCents: order.totalCents,
    idempotencyKey: `order:${orderId}:attempt:${attempt}`,
    metadata: { orderId, auctionId: order.auctionId, kind: order.kind },
  });

  if (result.ok) {
    await markOrderPaid(orderId, result.paymentIntentId);
    return true;
  }

  await recordChargeFailure(order, attempt, result.declineCode ?? "card_declined", mode, result.paymentIntentId);

  if (mode === "interactive") {
    throw new PaymentError("DECLINED", "Your card was declined — try another card.");
  }

  // Immediate retry, once (spec: "retry immediately, then …").
  if (attempt === 1) {
    return chargeOrder(orderId, mode);
  }
  return false;
}

/** Webhook path for async charge settlement (idempotent with the sync path). */
export async function markOrderPaidFromWebhook(orderId: string, paymentIntentId: string) {
  return markOrderPaid(orderId, paymentIntentId);
}

async function markOrderPaid(orderId: string, paymentIntentId: string) {
  const order = await prisma.$transaction(async (tx) => {
    const o = await tx.order.update({
      where: { id: orderId },
      data: { status: "PAID", stripePaymentIntentId: paymentIntentId, nextRetryAt: null },
      include: { auction: { select: { id: true, status: true, title: true } } },
    });
    try {
      await transition(tx, {
        auctionId: o.auctionId,
        to: "PAID",
        actorType: "SYSTEM",
        payload: { orderId, paymentIntentId, totalCents: o.totalCents },
      });
    } catch (e) {
      if (!(e instanceof InvalidTransitionError)) throw e; // already PAID via webhook race
    }
    return o;
  });

  // WON carries the receipt + delivery-form link, so it sends on successful
  // charge (not at close, when the money isn't real yet).
  await queueNotification({
    userId: order.userId,
    event: "WON",
    dedupeKey: `WON:${order.auctionId}:${order.userId}:${orderId}`,
    payload: {
      auctionId: order.auctionId,
      orderId,
      title: order.auction.title,
      subtotalCents: order.subtotalCents,
      gstCents: order.gstCents,
      pstCents: order.pstCents,
      totalCents: order.totalCents,
    },
  });
  await broadcastAuction(order.auctionId, "status", { status: "PAID" });
}

async function recordChargeFailure(
  order: Order,
  attempt: number,
  declineCode: string,
  mode: "off_session" | "interactive",
  paymentIntentId?: string,
) {
  const now = new Date();
  await prisma.auctionEvent.create({
    data: {
      auctionId: order.auctionId,
      type: "CHARGE_FAILED",
      actorType: "SYSTEM",
      payload: { orderId: order.id, attempt, declineCode, paymentIntentId },
    },
  });
  if (mode === "interactive") return;

  const firstFailure = order.fixCardDeadlineAt === null;
  if (firstFailure) {
    // Bookkeeping starts once the immediate retry has also failed:
    // 2-hour fix window + first cron retry in 30 min.
    if (attempt >= 2) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          fixCardDeadlineAt: new Date(now.getTime() + FIX_CARD_WINDOW_MS),
          nextRetryAt: new Date(now.getTime() + CHARGE_RETRY_OFFSETS_MIN[0]! * 60_000),
        },
      });
      await queueNotification({
        userId: order.userId,
        event: "PAYMENT_FAILED",
        dedupeKey: `PAYMENT_FAILED:${order.id}`,
        payload: { orderId: order.id, auctionId: order.auctionId, fixWithinMinutes: 120 },
      });
    }
    return;
  }

  // Cron-retry bookkeeping: walk the 30/60/120 ladder from the first failure.
  const anchor = new Date(order.fixCardDeadlineAt!.getTime() - FIX_CARD_WINDOW_MS);
  const nextOffset = CHARGE_RETRY_OFFSETS_MIN.find(
    (m) => anchor.getTime() + m * 60_000 > now.getTime(),
  );
  if (nextOffset !== undefined) {
    await prisma.order.update({
      where: { id: order.id },
      data: { nextRetryAt: new Date(anchor.getTime() + nextOffset * 60_000) },
    });
  } else {
    await exhaustOrder(order.id);
  }
}

// --- Exhaustion → second-chance / unsold -----------------------------------

/** Retries exhausted: flag the buyer, then offer the 2nd bidder or go unsold. */
export async function exhaustOrder(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { auction: { select: { id: true, title: true } } },
  });
  if (order.status !== "PENDING_CHARGE") return;

  await prisma.order.update({
    where: { id: orderId },
    data: { status: "FAILED", nextRetryAt: null, cancelReason: "payment_exhausted" },
  });

  // Original winner flagged; 2 failures = bidding suspended until re-verified.
  const user = await prisma.user.update({
    where: { id: order.userId },
    data: { paymentFailureCount: { increment: 1 } },
    select: { id: true, paymentFailureCount: true, biddingSuspendedAt: true },
  });
  if (user.paymentFailureCount >= PAYMENT_FAILURES_BEFORE_SUSPENSION && !user.biddingSuspendedAt) {
    await prisma.user.update({
      where: { id: user.id },
      data: { biddingSuspendedAt: new Date(), suspensionReason: "repeated_payment_failures" },
    });
  }
  await prisma.auctionEvent.create({
    data: {
      auctionId: order.auctionId,
      type: "PAYMENT_EXHAUSTED",
      actorType: "SYSTEM",
      payload: { orderId, userId: order.userId, failureCount: user.paymentFailureCount },
    },
  });

  // Only the original win rolls to the 2nd bidder; an exhausted second chance
  // (or buy-now) goes straight to unsold/last-chance.
  if (order.kind === "AUCTION_WIN") {
    const offered = await offerSecondChance(order.auctionId, order.userId, order.id);
    if (offered) return;
  }
  await auctionToUnsold(order.auctionId);
}

/** Offer the auction to the 2nd-highest bidder at THEIR highest bid (3h window). */
async function offerSecondChance(
  auctionId: string,
  excludeUserId: string,
  failedOrderId: string,
): Promise<boolean> {
  const runnerUp = await prisma.bid.findFirst({
    where: { auctionId, userId: { not: excludeUserId } },
    orderBy: [{ amountCents: "desc" }, { createdAt: "asc" }],
    select: { userId: true, amountCents: true },
  });
  if (!runnerUp) return false;

  const tax = calculateTax(runnerUp.amountCents);
  const offerExpiresAt = new Date(Date.now() + SECOND_CHANCE_WINDOW_MS);
  const offer = await prisma.order.create({
    data: {
      auctionId,
      userId: runnerUp.userId,
      kind: "SECOND_CHANCE",
      status: "OFFERED",
      subtotalCents: runnerUp.amountCents,
      ...tax,
      offerExpiresAt,
    },
  });
  await prisma.auctionEvent.create({
    data: {
      auctionId,
      type: "SECOND_CHANCE_OFFERED",
      actorType: "SYSTEM",
      payload: {
        orderId: offer.id,
        userId: runnerUp.userId,
        amountCents: runnerUp.amountCents,
        expiresAt: offerExpiresAt.toISOString(),
        failedOrderId,
      },
    },
  });
  await queueNotification({
    userId: runnerUp.userId,
    event: "SECOND_CHANCE_OFFER",
    dedupeKey: `SECOND_CHANCE_OFFER:${offer.id}`,
    payload: { orderId: offer.id, auctionId, amountCents: runnerUp.amountCents, expiresAt: offerExpiresAt.toISOString() },
  });
  return true;
}

/** PAYMENT_PENDING (or PAID post-cancel) → CLOSED_UNSOLD → LAST_CHANCE. */
async function auctionToUnsold(auctionId: string) {
  await prisma.$transaction(async (tx) => {
    try {
      await transition(tx, { auctionId, to: "CLOSED_UNSOLD", actorType: "SYSTEM" });
    } catch (e) {
      if (!(e instanceof InvalidTransitionError)) throw e;
      return; // already moved
    }
    const auction = await tx.auction.findUniqueOrThrow({
      where: { id: auctionId },
      select: { startPriceCents: true },
    });
    const lastChanceExpiresAt = endOfDayInVancouver(new Date());
    await tx.auction.update({ where: { id: auctionId }, data: { lastChanceExpiresAt } });
    await transition(tx, {
      auctionId,
      to: "LAST_CHANCE",
      actorType: "SYSTEM",
      payload: { buyNowCents: auction.startPriceCents, expiresAt: lastChanceExpiresAt.toISOString() },
    });
  });
  await broadcastAuction(auctionId, "status", { status: "LAST_CHANCE" });
}

// --- Second-chance accept/decline ------------------------------------------

export async function respondToOffer(
  orderId: string,
  userId: string,
  response: "accept" | "decline",
): Promise<{ ok: boolean; message: string }> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.userId !== userId) return { ok: false, message: "This offer isn't yours." };
  if (order.status !== "OFFERED") return { ok: false, message: "This offer is no longer open." };
  if (order.offerExpiresAt && order.offerExpiresAt <= new Date()) {
    await expireOffer(orderId);
    return { ok: false, message: "This offer expired — sorry, flowers move fast." };
  }

  if (response === "decline") {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "FAILED", offerRespondedAt: new Date(), cancelReason: "offer_declined" },
    });
    await prisma.auctionEvent.create({
      data: { auctionId: order.auctionId, type: "SECOND_CHANCE_DECLINED", actorType: "USER", actorId: userId, payload: { orderId } },
    });
    await auctionToUnsold(order.auctionId);
    return { ok: true, message: "No hard feelings — maybe tomorrow's drop." };
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { status: "PENDING_CHARGE", offerRespondedAt: new Date() },
  });
  await prisma.auctionEvent.create({
    data: { auctionId: order.auctionId, type: "SECOND_CHANCE_ACCEPTED", actorType: "USER", actorId: userId, payload: { orderId } },
  });
  const paid = await chargeOrder(orderId, "off_session");
  return paid
    ? { ok: true, message: "They're yours! Receipt and delivery details are on the way." }
    : { ok: true, message: "Accepted — but your card needs attention. Check your email to fix payment." };
}

async function expireOffer(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  if (order.status !== "OFFERED") return;
  await prisma.order.update({
    where: { id: orderId },
    data: { status: "FAILED", cancelReason: "offer_expired" },
  });
  await prisma.auctionEvent.create({
    data: { auctionId: order.auctionId, type: "SECOND_CHANCE_EXPIRED", actorType: "SYSTEM", payload: { orderId } },
  });
  await auctionToUnsold(order.auctionId);
}

// --- Winner cancellation (§6) ----------------------------------------------

export async function cancelOrderByWinner(
  orderId: string,
  userId: string,
): Promise<{ ok: boolean; message: string; refundedCents?: number }> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { delivery: true },
  });
  if (order.userId !== userId) return { ok: false, message: "Not your order." };
  if (order.status !== "PAID") return { ok: false, message: "This order can't be cancelled." };
  if (order.delivery) {
    return {
      ok: false,
      message:
        "Delivery is already being prepared, so cancellation isn't available — the flowers are cut. Reach out if something's truly wrong.",
    };
  }
  if (Date.now() - order.createdAt.getTime() > CANCEL_WINDOW_MS) {
    return { ok: false, message: "The 1-hour cancellation window has passed." };
  }
  if (!order.stripePaymentIntentId) return { ok: false, message: "Payment still settling — try again shortly." };

  const refundCents = Math.round((order.totalCents * (100 - RESTOCKING_FEE_PCT)) / 100);
  const { refundId } = await gateway.refund({
    paymentIntentId: order.stripePaymentIntentId,
    amountCents: refundCents,
    idempotencyKey: `cancel:${orderId}`,
  });

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "winner_cancelled" },
    });
    await tx.refund.create({
      data: {
        orderId,
        stripeRefundId: refundId,
        amountCents: refundCents,
        reasonCode: "WINNER_CANCEL_RESTOCKING",
        note: `${RESTOCKING_FEE_PCT}% restocking fee retained`,
      },
    });
    await transition(tx, {
      auctionId: order.auctionId,
      to: "PAYMENT_PENDING",
      actorType: "USER",
      actorId: userId,
      payload: { orderId, refundedCents: refundCents, event: "WINNER_CANCELLED_ROLLOVER" },
    });
  });

  const offered = await offerSecondChance(order.auctionId, userId, orderId);
  if (!offered) await auctionToUnsold(order.auctionId);

  return {
    ok: true,
    refundedCents: refundCents,
    message: `Cancelled. ${fmtC(refundCents)} is on its way back to your card (15% restocking fee applies).`,
  };
}

// --- Admin refunds & credits (§6) -------------------------------------------

export async function adminRefund(opts: {
  orderId: string;
  adminId: string;
  amountCents: number;
  reasonCode: RefundReasonCode;
  note?: string;
}) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: opts.orderId } });
  if (!order.stripePaymentIntentId) throw new PaymentError("BAD_STATE", "Order was never charged");
  const alreadyRefunded = await prisma.refund.aggregate({
    where: { orderId: opts.orderId },
    _sum: { amountCents: true },
  });
  const remaining = order.totalCents - (alreadyRefunded._sum.amountCents ?? 0);
  if (opts.amountCents > remaining) throw new PaymentError("BAD_STATE", "Refund exceeds remaining balance");

  const { refundId } = await gateway.refund({
    paymentIntentId: order.stripePaymentIntentId,
    amountCents: opts.amountCents,
    idempotencyKey: `refund:${opts.orderId}:${(alreadyRefunded._sum.amountCents ?? 0) + opts.amountCents}`,
  });
  await prisma.$transaction([
    prisma.refund.create({
      data: {
        orderId: opts.orderId,
        stripeRefundId: refundId,
        amountCents: opts.amountCents,
        reasonCode: opts.reasonCode,
        note: opts.note,
        issuedById: opts.adminId,
      },
    }),
    prisma.order.update({
      where: { id: opts.orderId },
      data: { status: opts.amountCents === remaining ? "REFUNDED" : "PARTIALLY_REFUNDED" },
    }),
    prisma.auctionEvent.create({
      data: {
        auctionId: order.auctionId,
        type: "REFUND_ISSUED",
        actorType: "ADMIN",
        actorId: opts.adminId,
        payload: { orderId: opts.orderId, amountCents: opts.amountCents, reasonCode: opts.reasonCode, note: opts.note },
      },
    }),
  ]);
}

/** One-tap "we failed to deliver": full refund + $10 next-auction credit. */
export async function ourFaultRefund(orderId: string, adminId: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const refunded = await prisma.refund.aggregate({ where: { orderId }, _sum: { amountCents: true } });
  const remaining = order.totalCents - (refunded._sum.amountCents ?? 0);
  if (remaining > 0) {
    await adminRefund({ orderId, adminId, amountCents: remaining, reasonCode: "OUR_FAULT_DELIVERY" });
  }
  await prisma.credit.create({
    data: {
      userId: order.userId,
      amountCents: OUR_FAULT_CREDIT_CENTS,
      reason: "delivery_failure_our_fault",
      issuedById: adminId,
      sourceOrderId: orderId,
    },
  });
}

/** Admin-discretion goodwill: 50% credit after delivery is already scheduled. */
export async function goodwillCredit(orderId: string, adminId: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const amountCents = Math.round(order.totalCents / 2);
  await prisma.credit.create({
    data: {
      userId: order.userId,
      amountCents,
      reason: "goodwill_50",
      issuedById: adminId,
      sourceOrderId: orderId,
    },
  });
  await prisma.auctionEvent.create({
    data: {
      auctionId: order.auctionId,
      type: "GOODWILL_CREDIT",
      actorType: "ADMIN",
      actorId: adminId,
      payload: { orderId, amountCents },
    },
  });
  return amountCents;
}

// --- Buy-now (LAST_CHANCE) --------------------------------------------------

export async function buyNow(auctionId: string, userId: string): Promise<{ orderId: string }> {
  // Claim the arrangement first (serializable — first buyer wins)…
  const order = await prisma.$transaction(
    async (tx) => {
      const auction = await tx.auction.findUniqueOrThrow({
        where: { id: auctionId },
        select: { status: true, startPriceCents: true, lastChanceExpiresAt: true },
      });
      if (auction.status !== "LAST_CHANCE") throw new PaymentError("BAD_STATE", "Buy-now isn't open on this one.");
      if (auction.lastChanceExpiresAt && auction.lastChanceExpiresAt <= new Date()) {
        throw new PaymentError("BAD_STATE", "Buy-now closed at midnight — tomorrow's drop lands at 9 AM.");
      }
      await transition(tx, { auctionId, to: "SOLD_BUYNOW", actorType: "USER", actorId: userId });
      const tax = calculateTax(auction.startPriceCents);
      return tx.order.create({
        data: {
          auctionId,
          userId,
          kind: "BUY_NOW",
          status: "PENDING_CHARGE",
          subtotalCents: auction.startPriceCents,
          ...tax,
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  // …then charge interactively; a decline releases it back to LAST_CHANCE.
  try {
    await chargeOrder(order.id, "interactive");
  } catch (e) {
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: { status: "FAILED", cancelReason: "buynow_charge_failed" },
      });
      await transition(tx, { auctionId, to: "LAST_CHANCE", actorType: "SYSTEM", payload: { orderId: order.id } });
    });
    throw e;
  }
  return { orderId: order.id };
}

// --- Cron sweep -------------------------------------------------------------

export interface PaymentSweepResult {
  retried: string[];
  offersExpired: string[];
}

/** Called from the minute cron next to the auction sweep. Idempotent. */
export async function runPaymentSweep(now = new Date()): Promise<PaymentSweepResult> {
  const result: PaymentSweepResult = { retried: [], offersExpired: [] };

  const due = await prisma.order.findMany({
    where: { status: "PENDING_CHARGE", nextRetryAt: { lte: now } },
    select: { id: true },
  });
  for (const { id } of due) {
    // Clear the pointer first so an overlapping sweep can't double-charge
    // (the gateway idempotency key is the second line of defense).
    const claimed = await prisma.order.updateMany({
      where: { id, status: "PENDING_CHARGE", nextRetryAt: { lte: now } },
      data: { nextRetryAt: null },
    });
    if (claimed.count === 0) continue;
    result.retried.push(id);
    await chargeOrder(id, "off_session").catch((e) => {
      if (!(e instanceof PaymentError)) throw e;
    });
  }

  const expired = await prisma.order.findMany({
    where: { status: "OFFERED", offerExpiresAt: { lte: now } },
    select: { id: true },
  });
  for (const { id } of expired) {
    await expireOffer(id);
    result.offersExpired.push(id);
  }

  return result;
}

function fmtC(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
