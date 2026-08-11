import type Stripe from "stripe";
import { CardStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";

/**
 * Card snapshot sync. Stripe is the source of truth; we mirror brand/last4/
 * expiry so the UI and the "card expires before close" pre-warning never need
 * a Stripe round trip. Called from the SetupIntent return flow AND webhooks —
 * both paths upsert, so ordering/duplication is harmless.
 */

export function computeCardStatus(expMonth: number, expYear: number, now = new Date()): CardStatus {
  // Cards are valid through the last day of their expiry month.
  const expiresEnd = new Date(Date.UTC(expYear, expMonth, 1)); // first instant after expiry month
  if (expiresEnd <= now) return "EXPIRED";
  // "Expiring soon" = gone before the end of next month — worth a pre-close warning.
  const endOfNextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1));
  if (expiresEnd <= endOfNextMonth) return "EXPIRING_SOON";
  return "VALID";
}

export async function upsertCardSnapshot(userId: string, pm: Stripe.PaymentMethod, opts?: { makeDefault?: boolean }) {
  if (pm.type !== "card" || !pm.card) return null;
  const { brand, last4, exp_month, exp_year } = pm.card;
  const status = computeCardStatus(exp_month, exp_year);

  const saved = await prisma.paymentMethod.upsert({
    where: { stripePaymentMethodId: pm.id },
    create: {
      userId,
      stripePaymentMethodId: pm.id,
      brand,
      last4,
      expMonth: exp_month,
      expYear: exp_year,
      status,
    },
    update: { brand, last4, expMonth: exp_month, expYear: exp_year, status },
  });

  if (opts?.makeDefault) await setDefaultCard(userId, saved.id);
  return saved;
}

/** Make a saved card the default, in Stripe and in our mirror. */
export async function setDefaultCard(userId: string, paymentMethodId: string) {
  const pm = await prisma.paymentMethod.findUniqueOrThrow({ where: { id: paymentMethodId } });
  if (pm.userId !== userId) throw new Error("Not your card");

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { stripeCustomerId: true },
  });
  if (user.stripeCustomerId) {
    await stripe().customers.update(user.stripeCustomerId, {
      invoice_settings: { default_payment_method: pm.stripePaymentMethodId },
    });
  }

  await prisma.$transaction([
    prisma.paymentMethod.updateMany({ where: { userId }, data: { isDefault: false } }),
    prisma.paymentMethod.update({ where: { id: paymentMethodId }, data: { isDefault: true } }),
  ]);
}

/**
 * Detach + remove a card. Blocked when it's the user's last usable card and
 * they still have live skin in the game (high bidder, active proxy ceiling,
 * or an unpaid order) — the spec requires a valid card behind every bid.
 */
export async function removeCard(userId: string, paymentMethodId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const pm = await prisma.paymentMethod.findUniqueOrThrow({ where: { id: paymentMethodId } });
  if (pm.userId !== userId) throw new Error("Not your card");

  const otherUsable = await prisma.paymentMethod.count({
    where: { userId, id: { not: paymentMethodId }, status: { in: ["VALID", "EXPIRING_SOON"] } },
  });

  if (otherUsable === 0) {
    const [liveBids, activeProxies, openOrders] = await Promise.all([
      prisma.bid.count({
        where: { userId, auction: { status: { in: ["LIVE", "CLOSING_EXTENDED"] } } },
      }),
      prisma.proxyBid.count({
        where: { userId, status: "ACTIVE", auction: { status: { in: ["LIVE", "CLOSING_EXTENDED"] } } },
      }),
      prisma.order.count({ where: { userId, status: { in: ["PENDING_CHARGE", "OFFERED"] } } }),
    ]);
    if (liveBids + activeProxies + openOrders > 0) {
      return {
        ok: false,
        reason:
          "This card is backing a live bid or an open order. Add another card first — every bid needs a valid card behind it.",
      };
    }
  }

  await stripe().paymentMethods.detach(pm.stripePaymentMethodId);
  await prisma.paymentMethod.delete({ where: { id: paymentMethodId } });

  // Promote another card to default so bidding keeps working.
  if (pm.isDefault) {
    const next = await prisma.paymentMethod.findFirst({
      where: { userId, status: { in: ["VALID", "EXPIRING_SOON"] } },
      orderBy: { createdAt: "desc" },
    });
    if (next) await setDefaultCard(userId, next.id);
  }
  return { ok: true };
}

/**
 * Nightly sweep (wired to a cron in step 5): recompute snapshot statuses so
 * "user bids then card expires before close" is caught and warned pre-close.
 */
export async function recomputeCardStatuses() {
  const cards = await prisma.paymentMethod.findMany({
    where: { status: { in: ["VALID", "EXPIRING_SOON"] } },
    select: { id: true, expMonth: true, expYear: true, status: true },
  });
  for (const card of cards) {
    const status = computeCardStatus(card.expMonth, card.expYear);
    if (status !== card.status) {
      await prisma.paymentMethod.update({ where: { id: card.id }, data: { status } });
    }
  }
}
