import { AuctionStatus, ActorType, Prisma, PrismaClient } from "@prisma/client";

/**
 * BloomBid auction state machine.
 *
 * One machine per arrangement, from draft through delivery resolution.
 * The database column `Auction.status` is the only source of truth;
 * this module is the only code allowed to change it, and every change
 * writes an immutable AuctionEvent row in the same transaction.
 */

// --- Bidding constants -----------------------------------------------------

export const MIN_INCREMENT_CENTS = 500; // $5
export const ANTI_SNIPE_WINDOW_MS = 5 * 60 * 1000; // bid in final 5 min…
export const ANTI_SNIPE_EXTENSION_MS = 5 * 60 * 1000; // …extends close by 5 min
export const BID_RATE_LIMIT_PER_MIN = 10;
export const CANCEL_WINDOW_MS = 60 * 60 * 1000; // winner cancel: 1h after close
export const RESTOCKING_FEE_PCT = 15;
export const CHARGE_RETRY_OFFSETS_MIN = [30, 60, 120]; // after the immediate retry
export const FIX_CARD_WINDOW_MS = 2 * 60 * 60 * 1000;
export const SECOND_CHANCE_WINDOW_MS = 3 * 60 * 60 * 1000;
export const PAYMENT_FAILURES_BEFORE_SUSPENSION = 2;
export const REDELIVERY_FEE_CENTS = 1000; // $10, buyer-fault redelivery
export const OUR_FAULT_CREDIT_CENTS = 1000; // $10 next-auction credit

// --- Transition table ------------------------------------------------------

export type TransitionTrigger =
  | "ADMIN" // tapped a button in admin
  | "SYSTEM" // cron or engine (close job, charge pipeline)
  | "USER" // buyer action (cancel, buy-now, resolution choice)
  | "STRIPE"; // webhook outcome

export interface TransitionDef {
  to: AuctionStatus;
  /** Machine-readable name, stored as AuctionEvent.type. */
  event: string;
  trigger: TransitionTrigger;
  /** Human description of the guard; enforced in the calling service. */
  guard?: string;
}

const S = AuctionStatus;

/**
 * Allowed transitions. Anything not listed here throws.
 * Terminal states: DELIVERED, RESOLVED_REFUND, EXPIRED,
 * and CLOSED_UNSOLD when the admin chooses not to run LAST_CHANCE.
 */
export const TRANSITIONS: Record<AuctionStatus, TransitionDef[]> = {
  [S.DRAFT]: [
    {
      to: S.SCHEDULED,
      event: "PUBLISHED",
      trigger: "ADMIN",
      guard: "≥1 photo, start price > 0, start/end times set, start < end",
    },
  ],
  [S.SCHEDULED]: [
    { to: S.LIVE, event: "OPENED", trigger: "SYSTEM", guard: "now ≥ scheduledStartAt (open cron, idempotent)" },
    { to: S.DRAFT, event: "UNPUBLISHED", trigger: "ADMIN", guard: "not yet live" },
  ],
  [S.LIVE]: [
    {
      to: S.CLOSING_EXTENDED,
      event: "SNIPE_EXTENSION",
      trigger: "SYSTEM",
      guard: "bid accepted with (currentEndAt − now) ≤ 5 min ⇒ currentEndAt += 5 min; extension logged",
    },
    {
      to: S.CLOSED_WON,
      event: "CLOSED",
      trigger: "SYSTEM",
      guard: "now ≥ currentEndAt and ≥1 bid (close cron, idempotent, safe to re-run)",
    },
    {
      to: S.CLOSED_UNSOLD,
      event: "CLOSED_NO_BIDS",
      trigger: "SYSTEM",
      guard: "now ≥ currentEndAt and 0 bids",
    },
  ],
  [S.CLOSING_EXTENDED]: [
    {
      to: S.CLOSING_EXTENDED,
      event: "SNIPE_EXTENSION",
      trigger: "SYSTEM",
      guard: "unlimited self-loops; each extension is its own AuctionEvent",
    },
    {
      to: S.CLOSED_WON,
      event: "CLOSED",
      trigger: "SYSTEM",
      guard: "now ≥ currentEndAt (an extended auction always has bids)",
    },
  ],
  [S.CLOSED_WON]: [
    {
      to: S.PAYMENT_PENDING,
      event: "ORDER_CREATED",
      trigger: "SYSTEM",
      guard: "immediate at close: Order(AUCTION_WIN) created, PaymentIntent fired on saved card",
    },
  ],
  [S.PAYMENT_PENDING]: [
    { to: S.PAID, event: "CHARGE_SUCCEEDED", trigger: "STRIPE" },
    // Charge retries (immediate, then 30/60/120 min) and the second-chance
    // offer are Order-level events, not status changes — the auction sits in
    // PAYMENT_PENDING while the money is unresolved. If the 2nd bidder
    // accepts, a new Order(SECOND_CHANCE) continues from here.
    {
      to: S.CLOSED_UNSOLD,
      event: "PAYMENT_EXHAUSTED",
      trigger: "SYSTEM",
      guard: "retries exhausted AND (no 2nd bidder, offer declined, or 3-hour offer expired); winner flagged",
    },
  ],
  [S.PAID]: [
    {
      to: S.DELIVERY_SCHEDULED,
      event: "DELIVERY_SCHEDULED",
      trigger: "USER",
      guard: "delivery form complete (validated PG postal code or admin override)",
    },
    {
      to: S.PAYMENT_PENDING,
      event: "WINNER_CANCELLED_ROLLOVER",
      trigger: "USER",
      guard:
        "within 1h of close, delivery details not yet submitted; 15% restocking fee kept, 85% refunded; new Order(SECOND_CHANCE) for 2nd bidder",
    },
    {
      to: S.CLOSED_UNSOLD,
      event: "WINNER_CANCELLED_NO_FALLBACK",
      trigger: "USER",
      guard: "same cancel window, but no 2nd bidder exists",
    },
  ],
  [S.DELIVERY_SCHEDULED]: [
    { to: S.OUT_FOR_DELIVERY, event: "ROUTE_STARTED", trigger: "ADMIN", guard: "driver taps start on run sheet" },
    // Cancel after scheduling: NO status change and no refund — flowers are
    // cut. The optional goodwill 50% credit is an admin button that issues a
    // Credit + AuctionEvent, delivery still proceeds or is abandoned by admin.
  ],
  [S.OUT_FOR_DELIVERY]: [
    {
      to: S.DELIVERED,
      event: "DELIVERED",
      trigger: "ADMIN",
      guard: "photo capture forced; photo + timestamp + GPS stored (dispute evidence)",
    },
    {
      to: S.DELIVERY_FAILED,
      event: "DELIVERY_FAILED",
      trigger: "ADMIN",
      guard: "reason + photo + note required; buyer notified instantly with resolution link",
    },
  ],
  [S.DELIVERY_FAILED]: [
    {
      to: S.RESOLVED_REDELIVERY,
      event: "RESOLUTION_REDELIVERY",
      trigger: "USER",
      guard: "buyer-fault: next business day, +$10 fee charged; no refund",
    },
    {
      to: S.DELIVERED,
      event: "RESOLUTION_PICKUP",
      trigger: "USER",
      guard: "buyer picks up same day; completion photo still captured",
    },
    {
      to: S.RESOLVED_REFUND,
      event: "RESOLUTION_REFUND",
      trigger: "ADMIN",
      guard: "our fault: full refund + $10 next-auction credit, one tap",
    },
  ],
  [S.RESOLVED_REDELIVERY]: [
    {
      to: S.DELIVERY_SCHEDULED,
      event: "REDELIVERY_SCHEDULED",
      trigger: "SYSTEM",
      guard: "re-enters the delivery loop for the second attempt (attemptCount++)",
    },
  ],
  [S.CLOSED_UNSOLD]: [
    {
      to: S.LAST_CHANCE,
      event: "LAST_CHANCE_OPENED",
      trigger: "SYSTEM",
      guard: "buy-now at start price until 11:59 PM local; everyone who bid is notified",
    },
    { to: S.EXPIRED, event: "WRITTEN_OFF", trigger: "ADMIN", guard: "admin skips last-chance" },
  ],
  [S.LAST_CHANCE]: [
    {
      to: S.SOLD_BUYNOW,
      event: "BOUGHT_NOW",
      trigger: "USER",
      guard: "first buyer wins (serializable tx); Order(BUY_NOW) created and charged",
    },
    { to: S.EXPIRED, event: "LAST_CHANCE_EXPIRED", trigger: "SYSTEM", guard: "11:59 PM cron" },
  ],
  [S.SOLD_BUYNOW]: [
    { to: S.PAID, event: "CHARGE_SUCCEEDED", trigger: "STRIPE", guard: "then joins the normal delivery flow" },
    {
      to: S.LAST_CHANCE,
      event: "BUYNOW_CHARGE_FAILED",
      trigger: "SYSTEM",
      guard: "synchronous charge failed — arrangement returns to last-chance until 11:59 PM",
    },
  ],
  [S.DELIVERED]: [], // terminal
  [S.RESOLVED_REFUND]: [], // terminal
  [S.EXPIRED]: [], // terminal
};

export const TERMINAL_STATES: ReadonlySet<AuctionStatus> = new Set(
  (Object.keys(TRANSITIONS) as AuctionStatus[]).filter((s) => TRANSITIONS[s].length === 0),
);

// --- Engine ---------------------------------------------------------------

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: AuctionStatus,
    public readonly to: AuctionStatus,
  ) {
    super(`Invalid auction transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function findTransition(from: AuctionStatus, to: AuctionStatus): TransitionDef | undefined {
  return TRANSITIONS[from].find((t) => t.to === to);
}

export function canTransition(from: AuctionStatus, to: AuctionStatus): boolean {
  return findTransition(from, to) !== undefined;
}

export interface TransitionInput {
  auctionId: string;
  to: AuctionStatus;
  actorType: ActorType;
  actorId?: string;
  payload?: Prisma.InputJsonValue;
}

type Tx = Prisma.TransactionClient;

/**
 * Perform a transition inside an existing transaction.
 *
 * The status read + guard + write + event insert share one transaction;
 * bid-adjacent transitions run at SERIALIZABLE via `transitionSerializable`.
 * Re-running a completed transition (e.g. the close cron firing twice) is a
 * no-op error the caller can swallow — the WHERE clause on the current status
 * means only one runner ever wins.
 */
export async function transition(tx: Tx, input: TransitionInput) {
  const auction = await tx.auction.findUniqueOrThrow({
    where: { id: input.auctionId },
    select: { status: true },
  });

  const def = findTransition(auction.status, input.to);
  if (!def) throw new InvalidTransitionError(auction.status, input.to);

  // Guarded update: fails (count 0) if someone else moved the status first.
  const updated = await tx.auction.updateMany({
    where: { id: input.auctionId, status: auction.status },
    data: { status: input.to },
  });
  if (updated.count === 0) throw new InvalidTransitionError(auction.status, input.to);

  await tx.auctionEvent.create({
    data: {
      auctionId: input.auctionId,
      type: def.event,
      fromStatus: auction.status,
      toStatus: input.to,
      actorType: input.actorType,
      actorId: input.actorId,
      payload: input.payload,
    },
  });

  return def;
}

/** Convenience wrapper: run a transition in its own SERIALIZABLE transaction. */
export async function transitionSerializable(prisma: PrismaClient, input: TransitionInput) {
  return prisma.$transaction((tx) => transition(tx, input), {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}
