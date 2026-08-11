#!/usr/bin/env bash
# Full E2E run against a disposable local Postgres.
# Usage: bash scripts/e2e.sh   (expects postgres binaries + a chromium)
set -euo pipefail

PGDIR="${PGDIR:-/tmp/bloombid-e2e-pg}"
PGPORT="${PGPORT:-54331}"
export DATABASE_URL="postgresql://postgres@127.0.0.1:${PGPORT}/bloombid_e2e"
export DIRECT_URL="$DATABASE_URL"
export AUTH_SECRET="e2e-secret-1234567890"
export AUTH_TRUST_HOST="true"
export FAKE_PAYMENT_GATEWAY="1"
export CRON_SECRET="e2e-cron-secret"

PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1 || true)"
[ -n "$PGBIN" ] && export PATH="$PGBIN:$PATH"

AS_PG=""
if [ "$(id -u)" = "0" ]; then AS_PG="setpriv --reuid=65534 --regid=65534 --clear-groups env PATH=$PATH"; fi

cleanup() { $AS_PG pg_ctl -D "$PGDIR" stop -m fast >/dev/null 2>&1 || true; rm -rf "$PGDIR"; }
trap cleanup EXIT

rm -rf "$PGDIR" && mkdir -p "$PGDIR"
[ -n "$AS_PG" ] && chown 65534:65534 "$PGDIR"
$AS_PG initdb -D "$PGDIR" -U postgres -A trust >/dev/null
$AS_PG pg_ctl -D "$PGDIR" -o "-k /tmp -p $PGPORT -c listen_addresses=127.0.0.1" -l "$PGDIR/log" start >/dev/null
sleep 1
psql -h 127.0.0.1 -p "$PGPORT" -U postgres -c "CREATE DATABASE bloombid_e2e;" >/dev/null

npx prisma db push --skip-generate >/dev/null
npx tsx prisma/seed.ts >/dev/null

npx next build
PLAYWRIGHT_CHROMIUM_PATH="${PLAYWRIGHT_CHROMIUM_PATH:-$(command -v chromium || echo /opt/pw-browsers/chromium)}" \
  npx playwright test "$@"
