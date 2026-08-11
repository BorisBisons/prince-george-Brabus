import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { transition, InvalidTransitionError } from "@/lib/auction/state-machine";
import { queueNotification } from "@/lib/notifications";
import { endOfDayInVancouver } from "@/lib/time";
import { calculateTax, chargeOrder, PaymentError } from "@/lib/payments";
import { broadcastAuction } from "@/lib/realtime";

/**
 * The minute sweep behind Vercel Cron: opens scheduled auctions, closes due
 * ones, expires last-chance, and watchdogs stuck auctions. Idempotent and
 * safe to re-run — every status write is a guarded transition, so a raced or
 * repeated run turns into no-ops (spec §11).
 */
export interface SweepResult {
  opened: string[];
  closedWon: string[];
  closedUnsold: string[];
  expired: string[];
  stuck: string[];
}

export async function runAuctionSweep(now = new Date()): Promise<SweepResult> {
  const result: SweepResult = { opened: [], closedWon: [], closedUnsold: [], expired: [], stuck: [] };

  // --- Open scheduled drops ------------------------------------------------
  const toOpen = await prisma.auction.findMany({
    where: { status: "SCHEDULED", scheduledStartAt: { lte: now } },
    select: { id: true },
  });
  for (const { id } of toOpen) {
    try {
      await prisma.$transaction(async (tx) => {
        await transition(tx, { auctionId: id, to: "LIVE", actorType: "SYSTEM" });
      });
      result.opened.push(id);
      await broadcastAuction(id, "status", { status: "LIVE" });
    } catch (e) {
      if (!(e instanceof InvalidTransitionError)) throw e; // raced by another run
    }
  }

  // --- Close due auctions --------------------------------------------------
  const due = await prisma.auction.findMany({
    where: { status: { in: ["LIVE", "CLOSING_EXTENDED"] }, currentEndAt: { lte: now } },
    select: { id: true },
  });
  for (const { id } of due) {
    const closed = await closeOne(id, now);
    if (closed === "won") result.closedWon.push(id);
    else if (closed === "unsold") result.closedUnsold.push(id);
  }

  // --- Expire last-chance at 11:59 PM -------------------------------------
  const lastChanceOver = await prisma.auction.findMany({
    where: { status: "LAST_CHANCE", lastChanceExpiresAt: { lte: now } },
    select: { id: true },
  });
  for (const { id } of lastChanceOver) {
    try {
      await prisma.$transaction((tx) =>
        transition(tx, { auctionId: id, to: "EXPIRED", actorType: "SYSTEM" }),
      );
      result.expired.push(id);
    } catch (e) {
      if (!(e instanceof InvalidTransitionError)) throw e;
    }
  }

  // --- Watchdog: anything open >5 min past close is a cron failure ---------
  const stuck = await prisma.auction.findMany({
    where: {
      status: { in: ["LIVE", "CLOSING_EXTENDED"] },
      currentEndAt: { lte: new Date(now.getTime() - 5 * 60_000) },
    },
    select: { id: true, slug: true },
  });
  if (stuck.length > 0) {
    result.stuck = stuck.map((a) => a.id);
    // Surfaces in Vercel logs; Sentry capture is wired in the observability pass.
    console.error(`[watchdog] auctions past close +5min: ${stuck.map((a) => a.slug).join(", ")}`);
  }

  return result;
}

/**
 * Close a single auction. Re-checks the deadline inside the serializable
 * transaction — a snipe bid committing just before us may have extended it.
 */
async function closeOne(auctionId: string, now: Date): Promise<"won" | "unsold" | "skipped"> {
  try {
    const outcome = await prisma.$transaction(
      async (tx) => {
        const auction = await tx.auction.findUniqueOrThrow({
          where: { id: auctionId },
          include: { currentBid: { select: { id: true, userId: true, amountCents: true } } },
        });
        if (
          (auction.status !== "LIVE" && auction.status !== "CLOSING_EXTENDED") ||
          !auction.currentEndAt ||
          auction.currentEndAt > now
        ) {
          return { kind: "skipped" as const };
        }

        if (auction.currentBid) {
          await transition(tx, {
            auctionId,
            to: "CLOSED_WON",
            actorType: "SYSTEM",
            payload: {
              winningBidCents: auction.currentBid.amountCents,
              winnerUserId: auction.currentBid.userId,
            },
          });

          // Money in flight: order created here, charged post-commit.
          const subtotal = auction.currentBid.amountCents;
          const order = await tx.order.create({
            data: {
              auctionId,
              userId: auction.currentBid.userId,
              kind: "AUCTION_WIN",
              status: "PENDING_CHARGE",
              subtotalCents: subtotal,
              ...calculateTax(subtotal),
            },
          });
          await transition(tx, {
            auctionId,
            to: "PAYMENT_PENDING",
            actorType: "SYSTEM",
            payload: { orderId: order.id },
          });
          return {
            kind: "won" as const,
            winnerUserId: auction.currentBid.userId,
            amountCents: subtotal,
            orderId: order.id,
            title: auction.title,
          };
        }

        await transition(tx, { auctionId, to: "CLOSED_UNSOLD", actorType: "SYSTEM" });
        const lastChanceExpiresAt = endOfDayInVancouver(now);
        await tx.auction.update({ where: { id: auctionId }, data: { lastChanceExpiresAt } });
        await transition(tx, {
          auctionId,
          to: "LAST_CHANCE",
          actorType: "SYSTEM",
          payload: {
            buyNowCents: auction.startPriceCents,
            expiresAt: lastChanceExpiresAt.toISOString(),
          },
        });
        return { kind: "unsold" as const, title: auction.title };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    // Post-commit side effects
    if (outcome.kind === "won") {
      await broadcastAuction(auctionId, "status", { status: "PAYMENT_PENDING" });
      // Charge the saved card now; WON (receipt + delivery link) queues on
      // success inside the payment pipeline, PAYMENT_FAILED on the sad path.
      await chargeOrder(outcome.orderId, "off_session").catch((e) => {
        if (!(e instanceof PaymentError)) throw e;
      });
      // Losers: everyone who bid except the winner
      const losers = await prisma.auctionParticipant.findMany({
        where: { auctionId, userId: { not: outcome.winnerUserId } },
        select: { userId: true },
      });
      for (const { userId } of losers) {
        await queueNotification({
          userId,
          event: "LOST",
          dedupeKey: `LOST:${auctionId}:${userId}`,
          payload: { auctionId, amountCents: outcome.amountCents, title: outcome.title },
        });
      }
      return "won";
    }
    if (outcome.kind === "unsold") {
      await broadcastAuction(auctionId, "status", { status: "LAST_CHANCE" });
      // Last-chance buy-now: tell everyone who bid (empty when zero bids —
      // the fallback paths from §6 can repopulate this state with bidders).
      const bidders = await prisma.auctionParticipant.findMany({
        where: { auctionId },
        select: { userId: true },
      });
      for (const { userId } of bidders) {
        await queueNotification({
          userId,
          event: "LAST_CHANCE",
          dedupeKey: `LAST_CHANCE:${auctionId}:${userId}`,
          payload: { auctionId, title: outcome.title },
        });
      }
      return "unsold";
    }
    return "skipped";
  } catch (e) {
    if (e instanceof InvalidTransitionError) return "skipped"; // raced by a parallel run
    throw e;
  }
}

