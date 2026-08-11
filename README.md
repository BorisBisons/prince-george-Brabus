# BloomBid 🌸

A daily flower auction for Prince George, BC. Every morning a limited batch of
arrangements drops; people bid all day; the highest bidder wins and we
hand-deliver to their partner's workplace.

**Status: Step 7 of the build order** — admin suite live: ≤5-min morning
flow (duplicate → photos → publish), live day view with revenue ticker,
orders kanban with refund/goodwill actions, money view + CSV export, buyer
CRM, and the kill switch (pause with clock-shift resume). Next: design
polish pass + Playwright tests.

Run the integration tests against a seeded database:

```bash
npm run test:engine          # bidding, proxy wars, anti-snipe, close sweep
npm run test:payments        # §6 charge/retry/cancel/refund matrix
npm run test:notifications   # §7 policy matrix, quiet hours, CASL
npm run test:delivery        # §8 delivery form, run sheet, resolutions
npm run test:admin           # §9 kill switch, morning flow, money, CRM
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
