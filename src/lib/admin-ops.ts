import { prisma } from "@/lib/db";
import { transition } from "@/lib/auction/state-machine";
import { vancouverDayRange, vancouverParts, zonedTimeInVancouver } from "@/lib/time";

/**
 * Admin operations (spec §9): the ≤5-minute morning flow, money view
 * aggregates, and buyer CRM stats.
 */

/** Drop schedule: 9 AM → 6 PM local, today if 9 AM hasn't passed, else tomorrow. */
export function nextDropWindow(now = new Date()): { startAt: Date; endAt: Date } {
  const { y, m, d } = vancouverParts(now);
  let startAt = zonedTimeInVancouver(y, m, d, 9, 0);
  let endAt = zonedTimeInVancouver(y, m, d, 18, 0);
  if (startAt <= now) {
    startAt = zonedTimeInVancouver(y, m, d + 1, 9, 0);
    endAt = zonedTimeInVancouver(y, m, d + 1, 18, 0);
  }
  return { startAt, endAt };
}

/** Duplicate the most recent drop's arrangements as fresh DRAFTs. */
export async function duplicateLastDrop(adminId: string): Promise<number> {
  const latest = await prisma.auction.findFirst({
    where: { status: { notIn: ["DRAFT"] }, scheduledStartAt: { not: null } },
    orderBy: { scheduledStartAt: "desc" },
    select: { scheduledStartAt: true },
  });
  if (!latest?.scheduledStartAt) return 0;

  const { start, end } = vancouverDayRange(latest.scheduledStartAt);
  const templates = await prisma.auction.findMany({
    where: { scheduledStartAt: { gte: start, lt: end }, status: { notIn: ["DRAFT"] } },
    include: { photos: { orderBy: { position: "asc" } } },
  });

  const suffix = Date.now().toString(36);
  for (const t of templates) {
    await prisma.auction.create({
      data: {
        slug: `${t.slug.replace(/-copy-\w+$/, "")}-copy-${suffix}`,
        title: t.title,
        description: t.description,
        status: "DRAFT",
        startPriceCents: t.startPriceCents,
        minIncrementCents: t.minIncrementCents,
        createdById: adminId,
        photos: {
          create: t.photos.map((p) => ({
            url: p.url,
            width: p.width,
            height: p.height,
            position: p.position,
            blurDataUrl: p.blurDataUrl,
          })),
        },
      },
    });
  }
  return templates.length;
}

export class PublishError extends Error {}

/** Publish a draft: guard checks per the state machine, then DRAFT → SCHEDULED. */
export async function publishAuction(auctionId: string, adminId: string) {
  const auction = await prisma.auction.findUniqueOrThrow({
    where: { id: auctionId },
    include: { _count: { select: { photos: true } } },
  });
  if (auction.status !== "DRAFT") throw new PublishError("Only drafts can be published.");
  if (auction._count.photos < 1) throw new PublishError("At least one photo first — this is a flower shop.");
  if (auction.startPriceCents <= 0) throw new PublishError("Start price has to be more than $0.");

  const { startAt, endAt } = nextDropWindow();
  await prisma.$transaction(async (tx) => {
    await tx.auction.update({
      where: { id: auctionId },
      data: { scheduledStartAt: startAt, scheduledEndAt: endAt, currentEndAt: endAt },
    });
    await transition(tx, {
      auctionId,
      to: "SCHEDULED",
      actorType: "ADMIN",
      actorId: adminId,
      payload: { startAt: startAt.toISOString(), endAt: endAt.toISOString() },
    });
  });
  return { startAt, endAt };
}

// --- Money view --------------------------------------------------------------

export interface MoneyStats {
  grossCents: number;
  refundedCents: number;
  netCents: number;
  gstCents: number;
  pstCents: number;
  paidOrders: number;
}

export async function moneyStats(start: Date, end: Date): Promise<MoneyStats> {
  const [orders, refunds] = await Promise.all([
    prisma.order.aggregate({
      where: {
        createdAt: { gte: start, lt: end },
        status: { in: ["PAID", "REFUNDED", "PARTIALLY_REFUNDED", "CANCELLED"] },
        stripePaymentIntentId: { not: null }, // actually charged
      },
      _sum: { totalCents: true, gstCents: true, pstCents: true },
      _count: true,
    }),
    prisma.refund.aggregate({
      where: { createdAt: { gte: start, lt: end } },
      _sum: { amountCents: true },
    }),
  ]);
  const gross = orders._sum.totalCents ?? 0;
  const refunded = refunds._sum.amountCents ?? 0;
  return {
    grossCents: gross,
    refundedCents: refunded,
    netCents: gross - refunded,
    gstCents: orders._sum.gstCents ?? 0,
    pstCents: orders._sum.pstCents ?? 0,
    paidOrders: orders._count,
  };
}

// --- Buyer CRM lite ----------------------------------------------------------

export interface BuyerStats {
  id: string;
  email: string;
  name: string | null;
  bids: number;
  auctionsEntered: number;
  wins: number;
  winRate: number;
  ltvCents: number;
  paymentFailureCount: number;
  suspended: boolean;
  lastActive: Date | null;
}

export async function buyerStats(): Promise<BuyerStats[]> {
  const users = await prisma.user.findMany({
    where: { role: "BUYER", deletedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      paymentFailureCount: true,
      biddingSuspendedAt: true,
      _count: { select: { bids: true, participations: true } },
      bids: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      orders: {
        where: { stripePaymentIntentId: { not: null } },
        select: { totalCents: true, refunds: { select: { amountCents: true } } },
      },
    },
  });
  return users
    .map((u) => {
      const ltv = u.orders.reduce(
        (sum, o) => sum + o.totalCents - o.refunds.reduce((s, r) => s + r.amountCents, 0),
        0,
      );
      const wins = u.orders.length;
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        bids: u._count.bids,
        auctionsEntered: u._count.participations,
        wins,
        winRate: u._count.participations > 0 ? wins / u._count.participations : 0,
        ltvCents: ltv,
        paymentFailureCount: u.paymentFailureCount,
        suspended: u.biddingSuspendedAt !== null,
        lastActive: u.bids[0]?.createdAt ?? null,
      };
    })
    .sort((a, b) => b.ltvCents - a.ltvCents);
}
