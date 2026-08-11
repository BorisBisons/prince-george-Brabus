import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getEligibility } from "@/lib/bidding-eligibility";
import {
  ANTI_SNIPE_EXTENSION_MS,
  ANTI_SNIPE_WINDOW_MS,
  BID_RATE_LIMIT_PER_MIN,
  transition,
} from "@/lib/auction/state-machine";

/**
 * Bid placement — the one path that writes bids.
 *
 * Runs in a SERIALIZABLE transaction against the current high bid, so two
 * bids at the same amount in the same instant are decided by commit order:
 * the loser's transaction retries, sees the winner's bid, and either becomes
 * a losing (immediately-outbid) bid or is rejected as too low (spec §5, §11).
 *
 * Proxy model (eBay-style): a ProxyBid ceiling auto-bids the minimum needed.
 * Manual bids stand at their typed amount; auto-bids are min(ceiling,
 * price + increment). A ceiling defends only while strictly above the
 * standing price — at an exact tie the standing (earlier) bid keeps the lead,
 * consistent with "transaction ordering decides".
 */

export class BidError extends Error {
  constructor(
    public readonly code:
      | "NOT_OPEN"
      | "ENDED"
      | "NOT_ELIGIBLE"
      | "RATE_LIMITED"
      | "SELF_OUTBID"
      | "TOO_LOW"
      | "CEILING_TOO_LOW"
      | "NOTHING_TO_DO",
    message: string,
  ) {
    super(message);
    this.name = "BidError";
  }
}

export interface PlaceBidInput {
  auctionId: string;
  userId: string;
  /** Manual bid amount; omit to enter with just a max-bid ceiling. */
  amountCents?: number;
  /** Optional proxy ceiling to set/raise alongside (or instead of) the bid. */
  maxBidCents?: number;
}

export interface PlaceBidOutcome {
  /** Final standing price + leader after any proxy battle. */
  priceCents: number;
  leaderUserId: string;
  leaderAlias: number;
  yourAlias: number;
  youAreLeading: boolean;
  extended: boolean;
  endAt: Date;
  /** Leader before this action, if the lead changed hands (→ OUTBID notification). */
  outbidUserId: string | null;
  /** Ceiling owners whose max was exhausted by this action (→ MAX_BID_REACHED). */
  ceilingReachedUserIds: string[];
}

const OPEN_STATUSES = ["LIVE", "CLOSING_EXTENDED"] as const;

export async function placeBid(input: PlaceBidInput): Promise<PlaceBidOutcome> {
  // Eligibility gate (account + verified email + valid card + not suspended)
  const eligibility = await getEligibility(input.userId);
  if (!eligibility.ok) {
    throw new BidError(
      "NOT_ELIGIBLE",
      eligibility.suspended
        ? "Bidding is paused on your account — save a fresh card to get going again."
        : !eligibility.hasUsableCard
          ? "Add a valid card first — it's only charged if you win."
          : "Verify your email first — check your inbox for the sign-in link.",
    );
  }

  // Serializable + retry on serialization conflicts (two bids, same instant).
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction((tx) => placeBidTx(tx, input, new Date()), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (e) {
      const serializationFailure =
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034";
      if (!serializationFailure || attempt >= 3) throw e;
    }
  }
}

type Tx = Prisma.TransactionClient;

async function placeBidTx(tx: Tx, input: PlaceBidInput, now: Date): Promise<PlaceBidOutcome> {
  const { auctionId, userId } = input;

  const auction = await tx.auction.findUniqueOrThrow({
    where: { id: auctionId },
    include: { currentBid: { select: { id: true, userId: true, amountCents: true } } },
  });

  if (!OPEN_STATUSES.includes(auction.status as (typeof OPEN_STATUSES)[number])) {
    throw new BidError("NOT_OPEN", "This auction isn't taking bids right now.");
  }
  if (!auction.currentEndAt || auction.currentEndAt <= now) {
    throw new BidError("ENDED", "Just missed it — this one has closed.");
  }

  // Rate limit: 10 manual bids/min/user (auto proxy bids don't count).
  const recent = await tx.bid.count({
    where: { userId, isProxy: false, createdAt: { gt: new Date(now.getTime() - 60_000) } },
  });
  if (recent >= BID_RATE_LIMIT_PER_MIN) {
    throw new BidError("RATE_LIMITED", "Easy there — max 10 bids a minute. Try again shortly.");
  }

  const inc = auction.minIncrementCents;
  let price = auction.currentBid?.amountCents ?? null;
  let leaderId = auction.currentBid?.userId ?? null;
  const previousLeaderId = leaderId;
  const minNext = price === null ? auction.startPriceCents : price + inc;

  // --- Ceiling set/raise -------------------------------------------------
  let ownProxyId: string | null = null;
  if (input.maxBidCents !== undefined) {
    const ceiling = input.maxBidCents;
    if (ceiling < minNext || (input.amountCents !== undefined && ceiling < input.amountCents)) {
      throw new BidError(
        "CEILING_TOO_LOW",
        `A max bid needs to be at least the next bid (${fmt(minNext)}).`,
      );
    }
    const proxy = await tx.proxyBid.upsert({
      where: { auctionId_userId: { auctionId, userId } },
      create: { auctionId, userId, ceilingCents: ceiling },
      update: { ceilingCents: ceiling, status: "ACTIVE", notifiedCeilingReachedAt: null },
    });
    ownProxyId = proxy.id;
    await tx.auctionEvent.create({
      data: {
        auctionId,
        type: "PROXY_SET",
        actorType: "USER",
        actorId: userId,
        payload: { ceilingCents: ceiling },
      },
    });
  }

  // --- The user's own bid ------------------------------------------------
  let manualAmount = input.amountCents ?? null;
  const leadingAlready = leaderId === userId;

  if (manualAmount === null) {
    if (ownProxyId === null) throw new BidError("NOTHING_TO_DO", "Enter a bid or a max bid.");
    if (leadingAlready) {
      // Raising your ceiling while leading: no new bid, price unchanged.
      const [alias] = await Promise.all([ensureParticipant(tx, auctionId, userId, now)]);
      return {
        priceCents: price!,
        leaderUserId: userId,
        leaderAlias: alias,
        yourAlias: alias,
        youAreLeading: true,
        extended: false,
        endAt: auction.currentEndAt,
        outbidUserId: null,
        ceilingReachedUserIds: [],
      };
    }
    manualAmount = minNext; // ceiling-only entry: system bids the minimum for you
  } else {
    if (leadingAlready) {
      throw new BidError("SELF_OUTBID", "You're already the high bidder — no need to bid against yourself.");
    }
    if (manualAmount < minNext) {
      throw new BidError("TOO_LOW", `Bids start at ${fmt(minNext)} now (minimum $5 steps).`);
    }
  }

  const yourAlias = await ensureParticipant(tx, auctionId, userId, now);

  let lastBid = await tx.bid.create({
    data: {
      auctionId,
      userId,
      amountCents: manualAmount,
      isProxy: input.amountCents === undefined, // system-entered minimum for a ceiling
      proxyBidId: input.amountCents === undefined ? ownProxyId : null,
    },
  });
  price = manualAmount;
  leaderId = userId;
  await logBid(tx, auctionId, userId, manualAmount, lastBid.isProxy, yourAlias);

  // --- Proxy battle: ceilings defend with minimal auto-bids ---------------
  // Terminates because price strictly increases every iteration.
  while (true) {
    const defender: { id: string; userId: string; ceilingCents: number } | null =
      await tx.proxyBid.findFirst({
        where: { auctionId, status: "ACTIVE", userId: { not: leaderId }, ceilingCents: { gt: price } },
        orderBy: [{ ceilingCents: "desc" }, { createdAt: "asc" }],
        select: { id: true, userId: true, ceilingCents: true },
      });
    if (!defender) break;

    const autoAmount = Math.min(defender.ceilingCents, price + inc);
    const defenderAlias = await ensureParticipant(tx, auctionId, defender.userId, now);
    lastBid = await tx.bid.create({
      data: {
        auctionId,
        userId: defender.userId,
        amountCents: autoAmount,
        isProxy: true,
        proxyBidId: defender.id,
      },
    });
    price = autoAmount;
    leaderId = defender.userId;
    await logBid(tx, auctionId, defender.userId, autoAmount, true, defenderAlias);
  }

  // --- Exhausted ceilings -------------------------------------------------
  const exhausted = await tx.proxyBid.findMany({
    where: { auctionId, status: "ACTIVE", userId: { not: leaderId }, ceilingCents: { lte: price } },
    select: { id: true, userId: true },
  });
  if (exhausted.length > 0) {
    await tx.proxyBid.updateMany({
      where: { id: { in: exhausted.map((p) => p.id) } },
      data: { status: "CEILING_REACHED", notifiedCeilingReachedAt: now },
    });
  }

  await tx.auction.update({ where: { id: auctionId }, data: { currentBidId: lastBid.id } });

  // --- Anti-snipe: final 5 min → +5 min, unlimited, each one logged --------
  let endAt = auction.currentEndAt;
  let extended = false;
  if (endAt.getTime() - now.getTime() <= ANTI_SNIPE_WINDOW_MS) {
    endAt = new Date(endAt.getTime() + ANTI_SNIPE_EXTENSION_MS);
    extended = true;
    await tx.auction.update({
      where: { id: auctionId },
      data: { currentEndAt: endAt, extensionCount: { increment: 1 } },
    });
    await transition(tx, {
      auctionId,
      to: "CLOSING_EXTENDED",
      actorType: "SYSTEM",
      payload: { extension: auction.extensionCount + 1, newEndAt: endAt.toISOString() },
    });
  }

  const leaderAlias = await ensureParticipant(tx, auctionId, leaderId, now);
  return {
    priceCents: price,
    leaderUserId: leaderId,
    leaderAlias,
    yourAlias,
    youAreLeading: leaderId === userId,
    extended,
    endAt,
    outbidUserId: previousLeaderId !== null && previousLeaderId !== leaderId ? previousLeaderId : null,
    ceilingReachedUserIds: exhausted.map((p) => p.userId),
  };
}

/** Stable per-auction alias ("Bidder #4"), assigned in first-participation order. */
async function ensureParticipant(tx: Tx, auctionId: string, userId: string, now: Date): Promise<number> {
  const existing = await tx.auctionParticipant.findUnique({
    where: { auctionId_userId: { auctionId, userId } },
    select: { bidderNumber: true },
  });
  if (existing) return existing.bidderNumber;
  const count = await tx.auctionParticipant.count({ where: { auctionId } });
  const created = await tx.auctionParticipant.create({
    data: { auctionId, userId, bidderNumber: count + 1, createdAt: now },
    select: { bidderNumber: true },
  });
  return created.bidderNumber;
}

function logBid(tx: Tx, auctionId: string, userId: string, amountCents: number, isProxy: boolean, alias: number) {
  return tx.auctionEvent.create({
    data: {
      auctionId,
      type: "BID_PLACED",
      actorType: isProxy ? "SYSTEM" : "USER",
      actorId: userId,
      payload: { amountCents, isProxy, bidderNumber: alias },
    },
  });
}

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export type AuctionPublicState = Awaited<ReturnType<typeof buildAuctionState>>;

/** Public state snapshot — powers the detail page, polling fallback, and realtime payloads. */
export async function buildAuctionState(db: PrismaClient, auctionId: string, viewerUserId?: string) {
  const auction = await db.auction.findUniqueOrThrow({
    where: { id: auctionId },
    include: {
      currentBid: { select: { userId: true, amountCents: true } },
      _count: { select: { bids: true } },
    },
  });

  const [history, leaderParticipant, viewer] = await Promise.all([
    db.bid.findMany({
      where: { auctionId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
      select: {
        amountCents: true,
        isProxy: true,
        createdAt: true,
        user: { select: { participations: { where: { auctionId }, select: { bidderNumber: true } } } },
      },
    }),
    auction.currentBid
      ? db.auctionParticipant.findUnique({
          where: { auctionId_userId: { auctionId, userId: auction.currentBid.userId } },
          select: { bidderNumber: true },
        })
      : null,
    viewerUserId
      ? Promise.all([
          db.auctionParticipant.findUnique({
            where: { auctionId_userId: { auctionId, userId: viewerUserId } },
            select: { bidderNumber: true },
          }),
          db.proxyBid.findUnique({
            where: { auctionId_userId: { auctionId, userId: viewerUserId } },
            select: { ceilingCents: true, status: true },
          }),
        ])
      : null,
  ]);

  const priceCents = auction.currentBid?.amountCents ?? null;
  return {
    id: auction.id,
    slug: auction.slug,
    status: auction.status,
    startPriceCents: auction.startPriceCents,
    priceCents,
    minNextBidCents: priceCents === null ? auction.startPriceCents : priceCents + auction.minIncrementCents,
    minIncrementCents: auction.minIncrementCents,
    endAt: auction.currentEndAt?.toISOString() ?? null,
    lastChanceExpiresAt: auction.lastChanceExpiresAt?.toISOString() ?? null,
    extensionCount: auction.extensionCount,
    bidCount: auction._count.bids,
    leaderAlias: leaderParticipant?.bidderNumber ?? null,
    serverNow: new Date().toISOString(),
    history: history.map((b) => ({
      alias: b.user.participations[0]?.bidderNumber ?? 0,
      amountCents: b.amountCents,
      isProxy: b.isProxy,
      at: b.createdAt.toISOString(),
    })),
    viewer: viewer
      ? {
          alias: viewer[0]?.bidderNumber ?? null,
          isLeading:
            auction.currentBid !== null && viewerUserId !== undefined
              ? auction.currentBid.userId === viewerUserId
              : false,
          ceilingCents: viewer[1]?.status === "ACTIVE" ? viewer[1].ceilingCents : null,
          ceilingReached: viewer[1]?.status === "CEILING_REACHED",
        }
      : null,
  };
}
