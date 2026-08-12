# Getting BloomBid live

Total hands-on time: ~15 minutes of account setup, then one command.
Everything in steps 1–3 requires account ownership and can't be automated;
everything after is scripted.

## 1. Neon (database, ~3 min)

1. [neon.tech](https://neon.tech) → New project → name it `bloombid`, region **US West (Oregon)** (closest to PG).
2. From the dashboard copy **both** connection strings:
   - the **pooled** one (`…-pooler.…neon.tech`) → this is `DATABASE_URL`
   - the **direct** one → this is `DIRECT_URL`

## 2. Vercel (hosting, ~4 min)

1. [vercel.com/new](https://vercel.com/new) → **Continue with GitHub** → Import the `BorisBisons/prince-george-Brabus` repo (after merging PR #1, or pick the `claude/bloombid-flower-auction-28uxsy` branch).
2. Framework preset: Next.js (auto-detected). Don't deploy yet — add env vars first (Settings → Environment Variables), from the table below.
3. **The whole thing runs on the free Hobby plan.** The per-minute cron in `vercel.json` only fires daily on Hobby, so a GitHub Actions workflow (`.github/workflows/auction-cron.yml`) drives the sweep every 5 minutes instead: in the GitHub repo → Settings → Secrets and variables → Actions, add `CRON_URL` (`https://<your-url>/api/cron/close`) and `CRON_SECRET` (same value as on Vercel). Closes can land a few minutes late at that cadence — fine at launch scale; Vercel Pro's per-minute cron is a later upgrade.
4. Storage → Blob → Create store → this sets `BLOB_READ_WRITE_TOKEN` automatically.

## 3. The service keys (~8 min)

| Env var | Where it comes from |
| --- | --- |
| `DATABASE_URL`, `DIRECT_URL` | Neon (step 1) |
| `AUTH_SECRET` | run `openssl rand -base64 32` |
| `AUTH_TRUST_HOST` | `true` |
| `NEXT_PUBLIC_APP_URL` | your Vercel URL, e.g. `https://bloombid.vercel.app` |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | [dashboard.stripe.com](https://dashboard.stripe.com) → Developers → API keys (start in **test mode**) |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → Add endpoint `https://<your-url>/api/webhooks/stripe`, events: `setup_intent.succeeded`, `payment_method.updated`, `payment_method.automatically_updated`, `payment_method.detached`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.dispute.created` → copy the signing secret |
| `RESEND_API_KEY`, `EMAIL_FROM` | [resend.com](https://resend.com) → verify your sending domain → create API key. `EMAIL_FROM` like `BloomBid <hello@yourdomain.ca>` — **sign-in is dead without this** (magic links are email) |
| `PUSHER_APP_ID`, `PUSHER_SECRET`, `NEXT_PUBLIC_PUSHER_KEY`, `NEXT_PUBLIC_PUSHER_CLUSTER` | [pusher.com](https://pusher.com) → Channels app (cluster `us3`). Optional — the site falls back to polling without it |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | run `npx web-push generate-vapid-keys`; subject = `mailto:hello@yourdomain.ca`. Optional — email still works without push |
| `CRON_SECRET` | run `openssl rand -base64 32` (Vercel sends it to the cron automatically) |
| `SMS_ENABLED` | `false` (ruling #3 — Twilio vars can stay empty) |

Priority if you want to stage it: **Neon + Vercel + AUTH_SECRET** gets the site
rendering; **Resend** turns on sign-in; **Stripe** turns on cards/bidding;
Pusher/VAPID are progressive enhancements.

## 4. Bootstrap the database (one command)

With the two database URLs from step 1:

```bash
DATABASE_URL="postgresql://…-pooler…" DIRECT_URL="postgresql://…" \
  npx tsx scripts/bootstrap-prod.ts --admin you@example.com --demo-data
```

Applies migrations, promotes your email to admin, creates the kill-switch row,
and (with `--demo-data`) loads the demo drop for a dress rehearsal. Re-run
without `--demo-data` before real launch to start clean.

## 5. Go-live smoke test (5 min)

1. Deploy on Vercel → open the URL → home grid renders.
2. Sign in with your admin email → magic link arrives → `/admin` opens.
3. Add a card with Stripe test card `4242 4242 4242 4242` → account shows "All set".
4. `/admin/drops` → Duplicate last drop → publish → confirm it appears scheduled.
5. Bid on a live auction from a second (non-admin) account; watch price update.
6. Stripe test-mode dashboard: confirm the SetupIntent and (after a close) the PaymentIntent.
7. When real: flip Stripe to live keys, clear demo data (`bootstrap-prod` without `--demo-data` on a reset DB), and take real photos through `/admin/drops`.

## Notes

- **Terms/Privacy** are placeholders — get counsel's pass before charging real cards.
- **Stripe Tax**: rates are flat BC GST 5% + PST 7% computed in-app; enabling
  Stripe Tax on the account later is a drop-in (see `calculateTax` in `src/lib/payments.ts`).
- `FAKE_PAYMENT_GATEWAY` must **never** be set in production — it exists for the
  E2E suite and refuses to activate when `VERCEL_ENV=production` anyway.
