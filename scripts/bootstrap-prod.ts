/**
 * Production bootstrap — run ONCE against the production database after the
 * Vercel project and env vars exist:
 *
 *   DATABASE_URL=... DIRECT_URL=... npx tsx scripts/bootstrap-prod.ts --admin you@example.com [--demo-data]
 *
 * What it does:
 *   1. Applies all committed migrations (prisma migrate deploy)
 *   2. Creates/promotes the admin user for the given email
 *   3. Creates the kill-switch setting row
 *   4. Optionally loads the demo drop (--demo-data) for a dress rehearsal
 *   5. Prints a go-live verification summary
 */
import { execSync } from "child_process";
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const adminIdx = args.indexOf("--admin");
const adminEmail = adminIdx >= 0 ? args[adminIdx + 1]?.toLowerCase() : undefined;
const withDemoData = args.includes("--demo-data");

if (!adminEmail || !adminEmail.includes("@")) {
  console.error("Usage: npx tsx scripts/bootstrap-prod.ts --admin you@example.com [--demo-data]");
  process.exit(1);
}

async function main() {
  console.log("1/4 Applying migrations…");
  execSync("npx prisma migrate deploy", { stdio: "inherit" });

  const prisma = new PrismaClient();
  try {
    console.log(`2/4 Ensuring admin account for ${adminEmail}…`);
    await prisma.user.upsert({
      where: { email: adminEmail! },
      create: { email: adminEmail!, role: "ADMIN", emailVerified: new Date() },
      update: { role: "ADMIN" },
    });

    console.log("3/4 Ensuring kill-switch setting…");
    await prisma.setting.upsert({
      where: { key: "kill_switch" },
      create: { key: "kill_switch", value: { active: false, banner: null, pausedAt: null } },
      update: {},
    });

    if (withDemoData) {
      console.log("4/4 Loading demo drop (seed)…");
      execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });
      // Seed wipes users — re-apply the admin promotion.
      await prisma.user.upsert({
        where: { email: adminEmail! },
        create: { email: adminEmail!, role: "ADMIN", emailVerified: new Date() },
        update: { role: "ADMIN" },
      });
    } else {
      console.log("4/4 Skipping demo data (pass --demo-data for a dress rehearsal).");
    }

    const [users, auctions, settings] = await Promise.all([
      prisma.user.count(),
      prisma.auction.count(),
      prisma.setting.count(),
    ]);
    console.log("\n✔ Bootstrap complete");
    console.log(`  users: ${users} (admin: ${adminEmail})`);
    console.log(`  auctions: ${auctions}`);
    console.log(`  settings: ${settings}`);
    console.log("\nNext: sign in on the site with the admin email (magic link) and open /admin.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
