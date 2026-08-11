import { defineConfig } from "@playwright/test";

/**
 * E2E config. Expects:
 *  - DATABASE_URL / DIRECT_URL pointing at a disposable Postgres with the
 *    schema pushed and seed applied (scripts/e2e.sh does all of this)
 *  - a production build (`next build`) already made
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false, // tests share one database
  workers: 1,
  use: {
    baseURL: "http://localhost:3200",
    ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } }
      : {}),
  },
  webServer: {
    command: "npx next start -p 3200",
    url: "http://localhost:3200/api/time",
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      ...process.env,
      AUTH_TRUST_HOST: "true",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "e2e-secret-1234567890",
      FAKE_PAYMENT_GATEWAY: "1",
      CRON_SECRET: "e2e-cron-secret",
    },
  },
});
