# Auction state machine

One machine per arrangement. `Auction.status` in Postgres is the only source of
truth; every change goes through `src/lib/auction/state-machine.ts`, which
validates the transition against the table below and writes an immutable
`AuctionEvent` row (who, what, when, payload) in the same transaction.

```mermaid
stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> SCHEDULED: admin publishes
    SCHEDULED --> DRAFT: admin unpublishes
    SCHEDULED --> LIVE: 9 AM open cron
    LIVE --> CLOSING_EXTENDED: bid in final 5 min (+5 min)
    CLOSING_EXTENDED --> CLOSING_EXTENDED: another snipe bid (unlimited)
    LIVE --> CLOSED_WON: close cron, has bids
    LIVE --> CLOSED_UNSOLD: close cron, no bids
    CLOSING_EXTENDED --> CLOSED_WON: close cron
    CLOSED_WON --> PAYMENT_PENDING: order created, card charged
    PAYMENT_PENDING --> PAID: charge succeeded
    PAYMENT_PENDING --> CLOSED_UNSOLD: retries + 2nd-chance exhausted
    PAID --> DELIVERY_SCHEDULED: delivery form complete
    PAID --> PAYMENT_PENDING: winner cancels ≤1h (2nd-chance order)
    PAID --> CLOSED_UNSOLD: winner cancels, no 2nd bidder
    DELIVERY_SCHEDULED --> OUT_FOR_DELIVERY: driver starts route
    OUT_FOR_DELIVERY --> DELIVERED: photo + GPS captured
    OUT_FOR_DELIVERY --> DELIVERY_FAILED: reason + photo
    DELIVERY_FAILED --> RESOLVED_REDELIVERY: buyer picks redelivery (+$10)
    DELIVERY_FAILED --> DELIVERED: buyer picks same-day pickup
    DELIVERY_FAILED --> RESOLVED_REFUND: our fault — refund + $10 credit
    RESOLVED_REDELIVERY --> DELIVERY_SCHEDULED: second attempt
    CLOSED_UNSOLD --> LAST_CHANCE: buy-now at start price
    CLOSED_UNSOLD --> EXPIRED: admin writes off
    LAST_CHANCE --> SOLD_BUYNOW: buy-now purchase
    LAST_CHANCE --> EXPIRED: 11:59 PM cron
    SOLD_BUYNOW --> PAID: charge succeeded
    SOLD_BUYNOW --> LAST_CHANCE: charge failed
    DELIVERED --> [*]
    RESOLVED_REFUND --> [*]
    EXPIRED --> [*]
```

Terminal states: **DELIVERED**, **RESOLVED_REFUND**, **EXPIRED** (and
**CLOSED_UNSOLD** if the admin never opens last-chance).

## Decisions the diagram encodes (beyond the spec's arrows)

The spec names the states; a few connections had to be pinned down. Each is
changeable — flag anything you'd rule differently:

1. **`CLOSED_WON → PAYMENT_PENDING` is immediate and automatic.** The close
   cron creates the `Order` and fires the PaymentIntent in the same job, so
   `CLOSED_WON` is instantaneous in practice but kept as a distinct state so
   the audit trail separates "auction outcome" from "money in flight".
2. **Charge retries and the second-chance offer are *not* states.** The
   auction sits in `PAYMENT_PENDING` while the Order-level retry ladder
   (immediate, 30/60/120 min) and the 3-hour second-chance offer play out.
   Each attempt/offer/response is an `AuctionEvent` + `Order` field update.
   This keeps the machine small and the money trail on `Order`, where a
   second-chance fallback is a **new Order row** — nothing is overwritten.
3. **Winner cancellation happens from `PAID`** (the card was charged at
   close). ≤1 h after close and before delivery details: 15% kept, 85%
   refunded, status returns to `PAYMENT_PENDING` under a new second-chance
   Order — or `CLOSED_UNSOLD` if there is no 2nd bidder (then last-chance can
   still run). After delivery is scheduled there is **no transition at all**
   for buyer cancellation — only the admin goodwill 50% credit button, which
   issues a `Credit` + event without touching status.
4. **Delivery-failure pickup resolves straight to `DELIVERED`** (with photo),
   since `RESOLVED_REDELIVERY` exists to re-enter the scheduling loop and
   pickup doesn't need that. `RESOLVED_REDELIVERY → DELIVERY_SCHEDULED` is the
   one deliberate loop-back, with `Delivery.attemptCount` incremented.
5. **`SOLD_BUYNOW` can fall back to `LAST_CHANCE`** if the synchronous charge
   fails, so a dead card doesn't kill the arrangement's remaining sale window.
6. **Kill switch is an overlay, not a state.** A `Setting` row pauses the
   whole site, freezes countdowns, and shifts every live `currentEndAt`
   forward by the pause duration on resume — bids preserved, no per-auction
   status churn.

## Concurrency & idempotency

- **Bid writes** run in `SERIALIZABLE` transactions that read the current high
  bid, apply proxy logic, and update `Auction.currentBidId` atomically. Two
  bids at the same amount in the same instant: first transaction to commit
  wins (tiebreak `createdAt ASC, id ASC`); the loser is immediately outbid.
- **Transitions** use a guarded `updateMany({ where: { id, status: from } })`
  — if the close cron double-fires, the second run matches zero rows and
  becomes a no-op. Safe to re-run, per the edge-case list.
- **Watchdog**: a cron alert to Sentry if any auction is `LIVE`/`CLOSING_EXTENDED`
  more than 5 minutes past `currentEndAt`.
- **Clock**: server (DB) time is truth; clients re-sync their countdown every
  30 s and on tab focus.

## Order sub-machine (money trail)

`Order.status`: `PENDING_CHARGE → PAID | FAILED`, with `OFFERED` for
second-chance orders awaiting accept/decline, `CANCELLED` for restocking-fee
cancellations, and `REFUNDED`/`PARTIALLY_REFUNDED` applied by refund rows.
Every refund is a `Refund` row with a `RefundReasonCode` — the §6 matrix maps
1:1 onto those codes.
