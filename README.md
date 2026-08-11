# BloomBid 🌸

A daily flower auction for Prince George, BC. Every morning a limited batch of
arrangements drops; people bid all day; the highest bidder wins and we
hand-deliver to their partner's workplace.

**Status: Step 4 of the build order** — payments live: charge-at-close with
the full §6 retry/second-chance/cancel/refund matrix, buy-now, and dispute
evidence. Next: notification senders.

Run the integration tests against a seeded database:

```bash
npm run test:engine     # bidding, proxy wars, anti-snipe, close sweep
npm run test:payments   # §6 charge/retry/cancel/refund matrix
```

## What's here

| Path | Purpose |
| --- | --- |
| `prisma/schema.prisma` | Full data model: auctions, bids, proxy bidding, orders, refunds, credits, delivery, notifications, audit trail |
| `src/lib/auction/state-machine.ts` | Transition table + guarded transition engine (every change writes an `AuctionEvent`) |
| `prisma/seed.ts` | 5 arrangements across the lifecycle with fake bid history |
| `docs/state-machine.md` | State diagram + the judgment calls it encodes |
| `docs/decisions.md` | Realtime/DB choice, money handling, order model, ratified rulings |

## Getting started

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL / DIRECT_URL (Neon)
npx prisma migrate dev --name init
npm run db:seed
```

## Stack (per spec)

Next.js 14 App Router · TypeScript · Tailwind + restyled shadcn/ui · Neon
Postgres + Prisma · Stripe (SetupIntent/PaymentIntent + Stripe Tax) · Resend ·
Twilio (flagged off) · Web Push · Pusher Channels · Vercel + Vercel Cron ·
Sentry · PostHog.
