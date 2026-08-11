# Architecture decisions (step 1)

## Realtime: Pusher Channels (over Supabase Realtime)

The spec says pick one and justify. **Pusher**, because:

1. **Presence channels give us the watchers count for free** — the admin
   live-day view wants "watchers per auction", and Pusher presence is exactly
   that; with Supabase Realtime we'd hand-roll presence bookkeeping.
2. **We publish after commit, not on replication.** Bids are accepted inside a
   serializable Postgres transaction; the natural pattern is "commit, then
   broadcast the new high bid". Pusher's server SDK is a one-line trigger in
   that spot. Supabase Realtime's main draw is streaming DB changes, which
   couples client updates to logical replication lag and leaks raw rows —
   we want to broadcast a shaped payload (anonymized bidder alias, formatted
   price), not the table row.
3. **Keeps the database choice clean.** With Pusher we take **Neon** for
   Postgres — first-class Vercel integration, branching for preview deploys,
   and no temptation to reach around Prisma into a second data-access SDK.
   Choosing Supabase Realtime effectively drags in Supabase-as-a-platform.

Cost note: Pusher's free tier (200k msgs/day, 100 concurrent) comfortably
covers a one-city daily drop at launch.

## Database: Neon Postgres

Follows from the above. `DATABASE_URL` uses the pooled endpoint (serverless
functions), `DIRECT_URL` the direct endpoint (migrations).

## Money: integer cents, CAD

Every amount column is `Int` cents. GST (5%) and PST (7%) are computed by
Stripe Tax at charge time and stored per-order (`gstCents`, `pstCents`) so the
Money view and CSV export never re-derive tax.

## One `Order` per charge chain, not per auction

Payment failure → second-chance, and winner-cancel → rollover both create a
**new** `Order` row on the same auction (`kind: SECOND_CHANCE` / `BUY_NOW`).
The failed/cancelled order keeps its PaymentIntent id, refunds, and events —
the bookkeeping trail is append-only, matching the immutable `AuctionEvent`
philosophy.

## Anonymized bidders

`AuctionParticipant` assigns `bidderNumber` at first bid, unique per auction —
"Bidder #4" is stable within an auction and unlinkable across auctions.

## Proxy (max-bid) mechanics

`ProxyBid` is one row per (auction, user) with a ceiling; the engine places
minimal `Bid` rows (`isProxy: true`) in response to competing bids, inside the
same serializable transaction as the triggering bid. When two ceilings fight,
the higher ceiling wins at (lower ceiling + $5), capped at its own ceiling;
ties resolve to the earlier ceiling. Ceiling reached → `CEILING_REACHED` +
notification.

## Notifications: outbox with dedupe keys

`NotificationLog.dedupeKey` (unique) makes every send idempotent — crons and
webhook handlers can re-run safely without double-sending. Quiet hours
(9 PM–8 AM, user-adjustable) defer non-critical push/SMS; WON, PAYMENT_FAILED,
SECOND_CHANCE_OFFER, DELIVERY_FAILED are exempt per spec. CASL: every user and
teaser subscriber carries a stable one-click unsubscribe token.

## Stripe webhooks

`StripeWebhookEvent.stripeEventId` is unique — handlers insert-or-skip before
processing, killing duplicate/out-of-order delivery issues.

## Ratified ruling defaults (as recommended in the spec)

1. Proxy max-bidding: **IN** (schema + engine designed around it).
2. Cancel policy: **1 h / 15% fee / nothing after scheduling**, goodwill 50%
   credit as admin button.
3. SMS at launch: **OFF** — Twilio wired, `SMS_ENABLED=false`.
4. 2nd-bidder fallback: **at their own highest bid, 3 h accept window.**
