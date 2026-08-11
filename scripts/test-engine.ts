/**
 * Integration test for the bidding engine + close sweep (run against the
 * requires a seeded database — see README; npm run test:engine).
 */
import { prisma } from "../src/lib/db";
import { BidError, placeBid } from "../src/lib/auction/bidding";
import { endOfDayInVancouver, runAuctionSweep } from "../src/lib/auction/close";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ok — ${name}`);
  else {
    failures++;
    console.error(`  FAIL — ${name}`, detail ?? "");
  }
}
async function expectBidError(name: string, code: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(name, false, "no error thrown");
  } catch (e) {
    check(name, e instanceof BidError && e.code === code, e);
  }
}

async function main() {
  const owner = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  const mkAuction = async (slug: string, minsLeft: number) =>
    prisma.auction.create({
      data: {
        slug,
        title: slug,
        description: "test",
        status: "LIVE",
        startPriceCents: 5000,
        createdById: owner.id,
        scheduledStartAt: new Date(Date.now() - 3600e3),
        scheduledEndAt: new Date(Date.now() + minsLeft * 60e3),
        currentEndAt: new Date(Date.now() + minsLeft * 60e3),
      },
    });

  console.log("1. basic rules");
  const a = await mkAuction("t-basic", 120);
  await expectBidError("below start price", "TOO_LOW", () =>
    placeBid({ auctionId: a.id, userId: "usr_alice", amountCents: 4500 }),
  );
  const b1 = await placeBid({ auctionId: a.id, userId: "usr_alice", amountCents: 5000 });
  check("first bid at start price leads", b1.youAreLeading && b1.priceCents === 5000);
  await expectBidError("self-outbid rejected", "SELF_OUTBID", () =>
    placeBid({ auctionId: a.id, userId: "usr_alice", amountCents: 5500 }),
  );
  await expectBidError("increment enforced", "TOO_LOW", () =>
    placeBid({ auctionId: a.id, userId: "usr_ben", amountCents: 5400 }),
  );
  const b2 = await placeBid({ auctionId: a.id, userId: "usr_ben", amountCents: 5500 });
  check("outbid reported", b2.youAreLeading && b2.outbidUserId === "usr_alice");
  const aliases = await prisma.auctionParticipant.findMany({ where: { auctionId: a.id }, orderBy: { bidderNumber: "asc" } });
  check("aliases stable/ordered", aliases.map((x) => x.bidderNumber).join(",") === "1,2");

  console.log("2. proxy battle");
  const p = await mkAuction("t-proxy", 120);
  // chloe sets ceiling $90 only → system enters her at $50
  const c1 = await placeBid({ auctionId: p.id, userId: "usr_chloe", maxBidCents: 9000 });
  check("ceiling-only entry bids minimum", c1.priceCents === 5000 && c1.youAreLeading);
  // dmitri bids $60 manually → chloe's proxy defends at $65
  const c2 = await placeBid({ auctionId: p.id, userId: "usr_dmitri", amountCents: 6000 });
  check("proxy defends minimally", !c2.youAreLeading && c2.priceCents === 6500, c2);
  // emma sets ceiling $80 → ping-pong ends: chloe leads at $85 (80+5 capped at 90)
  const c3 = await placeBid({ auctionId: p.id, userId: "usr_emma", maxBidCents: 8000 });
  check("ceiling war → higher ceiling wins at loser+inc", !c3.youAreLeading && c3.priceCents === 8500, c3);
  check("exhausted ceiling flagged", c3.ceilingReachedUserIds.includes("usr_emma"), c3);
  const emmaProxy = await prisma.proxyBid.findUnique({ where: { auctionId_userId: { auctionId: p.id, userId: "usr_emma" } } });
  check("proxy status CEILING_REACHED", emmaProxy?.status === "CEILING_REACHED");
  // ben bids $92 → beats chloe's 90: chloe auto-raised to 90, ben stands 92... sequence: ben manual 92 > all ceilings
  const c4 = await placeBid({ auctionId: p.id, userId: "usr_ben", amountCents: 9200 });
  check("manual bid beats ceiling", c4.youAreLeading && c4.priceCents === 9200, c4);
  check("chloe notified ceiling reached", c4.ceilingReachedUserIds.includes("usr_chloe"), c4);

  console.log("3. anti-snipe");
  const s = await mkAuction("t-snipe", 3); // 3 minutes left
  const s1 = await placeBid({ auctionId: s.id, userId: "usr_alice", amountCents: 5000 });
  check("snipe extends by 5 min", s1.extended);
  const sAuction = await prisma.auction.findUniqueOrThrow({ where: { id: s.id } });
  check("status CLOSING_EXTENDED", sAuction.status === "CLOSING_EXTENDED");
  check("extension counted", sAuction.extensionCount === 1);
  // shrink the clock back into the snipe window to exercise the self-loop
  await prisma.auction.update({ where: { id: s.id }, data: { currentEndAt: new Date(Date.now() + 2 * 60e3) } });
  const s2 = await placeBid({ auctionId: s.id, userId: "usr_ben", amountCents: 5500 });
  check("second snipe self-loops", s2.extended);
  const sAuction2 = await prisma.auction.findUniqueOrThrow({ where: { id: s.id } });
  check("extension 2 logged", sAuction2.extensionCount === 2);
  const extEvents = await prisma.auctionEvent.count({ where: { auctionId: s.id, type: "SNIPE_EXTENSION" } });
  check("each extension is an event", extEvents === 2);

  console.log("4. rate limit");
  const r = await mkAuction("t-rate", 240);
  const users = ["usr_alice", "usr_ben"];
  let rateLimited = false;
  let amount = 5000;
  try {
    for (let i = 0; i < 24; i++) {
      await placeBid({ auctionId: r.id, userId: users[i % 2]!, amountCents: amount });
      amount += 500;
    }
  } catch (e) {
    rateLimited = e instanceof BidError && e.code === "RATE_LIMITED";
  }
  check("10 bids/min/user enforced", rateLimited);
  // clear the rate-limit window so later tests aren't contaminated
  await prisma.auction.update({ where: { id: r.id }, data: { currentBidId: null } });
  await prisma.bid.deleteMany({ where: { auctionId: r.id } });

  console.log("5. concurrent same-amount bids");
  const cc = await mkAuction("t-concurrent", 240);
  await placeBid({ auctionId: cc.id, userId: "usr_emma", amountCents: 5000 });
  const results = await Promise.allSettled([
    placeBid({ auctionId: cc.id, userId: "usr_alice", amountCents: 5500 }),
    placeBid({ auctionId: cc.id, userId: "usr_ben", amountCents: 5500 }),
  ]);
  const wins = results.filter((x) => x.status === "fulfilled" && x.value.youAreLeading).length;
  const losses = results.filter(
    (x) => (x.status === "fulfilled" && !x.value.youAreLeading) || (x.status === "rejected" && x.reason instanceof BidError && x.reason.code === "TOO_LOW"),
  ).length;
  check("exactly one winner, ordering decides", wins === 1 && losses === 1, results.map((x) => (x.status === "fulfilled" ? x.value : String(x.reason))));
  const ccState = await prisma.auction.findUniqueOrThrow({ where: { id: cc.id }, include: { currentBid: true } });
  check("standing price is 5500", ccState.currentBid?.amountCents === 5500);

  console.log("6. close sweep");
  // force both past due
  await prisma.auction.update({ where: { id: cc.id }, data: { currentEndAt: new Date(Date.now() - 60e3) } });
  const unsold = await mkAuction("t-unsold", 240);
  await prisma.auction.update({ where: { id: unsold.id }, data: { currentEndAt: new Date(Date.now() - 60e3) } });
  const sweep = await runAuctionSweep();
  check("won auction closed", sweep.closedWon.includes(cc.id), sweep);
  check("unsold → last chance", sweep.closedUnsold.includes(unsold.id), sweep);
  const ccAfter = await prisma.auction.findUniqueOrThrow({ where: { id: cc.id }, include: { orders: true } });
  check("status PAYMENT_PENDING", ccAfter.status === "PAYMENT_PENDING");
  check("order created with tax", ccAfter.orders[0]?.totalCents === Math.round(5500 * 1.12), ccAfter.orders);
  const unsoldAfter = await prisma.auction.findUniqueOrThrow({ where: { id: unsold.id } });
  check("LAST_CHANCE with expiry", unsoldAfter.status === "LAST_CHANCE" && unsoldAfter.lastChanceExpiresAt !== null);
  const wonNotif = await prisma.notificationLog.count({ where: { event: "WON", userId: ccAfter.orders[0]?.userId ?? "" } });
  const lostNotif = await prisma.notificationLog.count({ where: { event: "LOST" } });
  check("WON + LOST notifications queued", wonNotif >= 1 && lostNotif >= 1, { wonNotif, lostNotif });
  // idempotency: re-run changes nothing
  const sweep2 = await runAuctionSweep();
  check("sweep idempotent", sweep2.closedWon.length === 0 && sweep2.closedUnsold.length === 0, sweep2);
  // bids on closed auction rejected
  await expectBidError("bid after close rejected", "NOT_OPEN", () =>
    placeBid({ auctionId: cc.id, userId: "usr_dmitri", amountCents: 9900 }),
  );

  console.log("7. timezone");
  const eod = endOfDayInVancouver(new Date("2026-08-11T18:00:00Z"));
  check("Aug 11 23:59 PDT = Aug 12 06:59 UTC", eod.toISOString() === "2026-08-12T06:59:00.000Z", eod.toISOString());
  const eodWinter = endOfDayInVancouver(new Date("2026-01-15T18:00:00Z"));
  check("Jan 15 23:59 PST = Jan 16 07:59 UTC", eodWinter.toISOString() === "2026-01-16T07:59:00.000Z", eodWinter.toISOString());

  console.log(failures === 0 ? "\nENGINE TESTS: ALL PASSED" : `\nENGINE TESTS: ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
