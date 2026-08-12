/**
 * Integration test for §9 admin ops: kill switch (pause/resume with clock
 * shift), morning-flow duplicate + publish, money stats, buyer CRM stats.
 * Run against a seeded database (npm run test:admin).
 */
import { prisma } from "../src/lib/db";
import { placeBid, BidError } from "../src/lib/auction/bidding";
import { runAuctionSweep } from "../src/lib/auction/close";
import { getKillSwitch, pauseAll, resumeAll } from "../src/lib/kill-switch";
import { duplicateLastDrop, publishAuction, moneyStats, buyerStats, nextDropWindow, PublishError } from "../src/lib/admin-ops";
import { setPaymentGateway } from "../src/lib/payments";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ok — ${name}`);
  else {
    failures++;
    console.error(`  FAIL — ${name}`, detail ?? "");
  }
}

async function main() {
  let pi = 0;
  setPaymentGateway({
    charge: async () => ({ ok: true, paymentIntentId: `pi_admin_${++pi}` }),
    refund: async () => ({ refundId: `re_admin_${++pi}` }),
  });
  const owner = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });

  console.log("1. kill switch: pause blocks bids + freezes the sweep");
  const live = await prisma.auction.findFirstOrThrow({ where: { slug: "aurora-peonies" } });
  const endBefore = live.currentEndAt!;
  await pauseAll(owner.id, "Snow day — auctions paused, bids preserved.");
  check("state active with banner", (await getKillSwitch()).active);

  let paused = false;
  try {
    await placeBid({ auctionId: live.id, userId: "usr_dmitri", amountCents: 9900 });
  } catch (e) {
    paused = e instanceof BidError && e.message.includes("paused");
  }
  check("bids rejected while paused", paused);

  // Force the auction past due — a paused sweep must NOT close it.
  await prisma.auction.update({ where: { id: live.id }, data: { currentEndAt: new Date(Date.now() - 60_000) } });
  const sweep = await runAuctionSweep();
  check("sweep frozen (nothing closed)", sweep.closedWon.length === 0 && sweep.closedUnsold.length === 0, sweep);

  console.log("2. resume shifts clocks forward by the pause duration");
  // Backdate pausedAt by 10 minutes to simulate a real pause.
  await prisma.setting.update({
    where: { key: "kill_switch" },
    data: {
      value: {
        active: true,
        banner: "x",
        pausedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      },
    },
  });
  await resumeAll(owner.id);
  check("state inactive", !(await getKillSwitch()).active);
  const liveAfter = await prisma.auction.findUniqueOrThrow({ where: { id: live.id } });
  const shiftMin = (liveAfter.currentEndAt!.getTime() - new Date(Date.now() - 60_000).getTime()) / 60_000;
  check("clock shifted ~10 min forward", shiftMin > 8.5 && shiftMin < 11.5, shiftMin);
  const bidNow = await placeBid({ auctionId: live.id, userId: "usr_dmitri", amountCents: 9900 });
  check("bidding works again", bidNow.priceCents >= 9900);

  console.log("3. morning flow: duplicate last drop → drafts");
  const created = await duplicateLastDrop(owner.id);
  check("duplicated yesterday-style drop", created >= 1, created);
  const draft = await prisma.auction.findFirstOrThrow({
    where: { status: "DRAFT" },
    include: { photos: true },
    orderBy: { createdAt: "desc" },
  });
  check("photos cloned", draft.photos.length > 0);

  console.log("4. publish: guarded, lands on next 9 AM window");
  const { startAt, endAt } = await publishAuction(draft.id, owner.id);
  const published = await prisma.auction.findUniqueOrThrow({ where: { id: draft.id } });
  check("SCHEDULED with times", published.status === "SCHEDULED" && published.currentEndAt !== null);
  check("start before end, both future", startAt < endAt && startAt > new Date());
  const windowCheck = nextDropWindow(new Date("2026-08-11T14:00:00Z")); // 7 AM local → today
  check("pre-9AM publish targets same day", windowCheck.startAt.toISOString() === "2026-08-11T16:00:00.000Z", windowCheck);

  const bare = await prisma.auction.create({
    data: { slug: "no-photos", title: "x", description: "x", startPriceCents: 5000, createdById: owner.id },
  });
  let guarded = false;
  try {
    await publishAuction(bare.id, owner.id);
  } catch (e) {
    guarded = e instanceof PublishError;
  }
  check("photo guard blocks publish", guarded);

  console.log("5. money stats");
  const stats = await moneyStats(new Date(Date.now() - 30 * 86400e3), new Date(Date.now() + 86400e3));
  // Seed has two charged orders: 9520 + 10640 = 20160; gst 900; pst 1260.
  check("gross ≥ seeded orders", stats.grossCents >= 20160, stats);
  check("gst + pst tracked", stats.gstCents >= 900 && stats.pstCents >= 1260, stats);
  check("net = gross − refunds", stats.netCents === stats.grossCents - stats.refundedCents);

  console.log("6. buyer CRM stats");
  const buyers = await buyerStats();
  const ben = buyers.find((b) => b.id === "usr_ben");
  check("ben has a win and LTV", (ben?.wins ?? 0) >= 1 && (ben?.ltvCents ?? 0) >= 9520, ben);
  check("sorted by LTV desc", buyers.every((b, i) => i === 0 || buyers[i - 1]!.ltvCents >= b.ltvCents));

  console.log(failures === 0 ? "\nADMIN TESTS: ALL PASSED" : `\nADMIN TESTS: ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
