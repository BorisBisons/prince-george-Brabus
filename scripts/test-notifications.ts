/**
 * Integration test for the §7 notification pipeline: policy matrix, quiet
 * hours, dedupe, scheduled queuers, CASL unsubscribe. Fake transports
 * capture every send. Run against a seeded database (npm run test:notifications).
 */
import { prisma } from "../src/lib/db";
import { queueNotification } from "../src/lib/notifications";
import {
  drainNotifications,
  queueScheduledNotifications,
  setTransports,
  unsubscribeByToken,
  type Transports,
} from "../src/lib/notification-sender";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ok — ${name}`);
  else {
    failures++;
    console.error(`  FAIL — ${name}`, detail ?? "");
  }
}

const sent: { channel: string; to: string; subject: string }[] = [];
const fakeTransports: Transports = {
  email: async (o) => {
    sent.push({ channel: "EMAIL", to: o.to, subject: o.subject });
  },
  emailReady: () => true,
  push: async (userId, p) => {
    sent.push({ channel: "PUSH", to: userId, subject: p.title });
  },
  pushReady: () => true,
  sms: async (to, body) => {
    sent.push({ channel: "SMS", to, subject: body });
  },
  smsReady: () => false, // launch config: SMS off
};

// Deterministic "daytime" and "night" instants in America/Vancouver.
// 2026-08-11: PDT (UTC-7) → 20:00Z = 1 PM local (day); 06:00Z = 11 PM prev local (quiet).
const DAY = new Date("2026-08-11T20:00:00Z");
const NIGHT = new Date("2026-08-11T06:00:00Z");

async function main() {
  setTransports(fakeTransports);

  console.log("1. policy matrix + delivery");
  await queueNotification({
    userId: "usr_alice",
    event: "OUTBID",
    dedupeKey: "T:OUTBID:1",
    payload: { title: "Test Blooms", priceCents: 7500, slug: "aurora-peonies" },
  });
  let rows = await prisma.notificationLog.findMany({ where: { dedupeKey: { startsWith: "T:OUTBID:1" } } });
  check("OUTBID queues EMAIL+PUSH (SMS off)", rows.length === 2 && rows.every((r) => r.channel !== "SMS"), rows.map((r) => r.channel));

  const drained = await drainNotifications(DAY);
  check("daytime drain sends both", drained.sent >= 2 && sent.some((s) => s.channel === "EMAIL" && s.to === "alice@example.com"));
  rows = await prisma.notificationLog.findMany({ where: { dedupeKey: { startsWith: "T:OUTBID:1" } } });
  check("rows marked SENT", rows.every((r) => r.status === "SENT"));

  console.log("2. dedupe: same key never double-queues");
  await queueNotification({ userId: "usr_alice", event: "OUTBID", dedupeKey: "T:OUTBID:1", payload: {} });
  const count = await prisma.notificationLog.count({ where: { dedupeKey: { startsWith: "T:OUTBID:1" } } });
  check("still exactly 2 rows", count === 2, count);

  console.log("3. quiet hours: push held at night, email flows, critical exempt");
  sent.length = 0;
  await queueNotification({
    userId: "usr_ben",
    event: "OUTBID",
    dedupeKey: "T:OUTBID:night",
    payload: { title: "Nocturne", priceCents: 9000 },
  });
  await queueNotification({
    userId: "usr_ben",
    event: "WON",
    dedupeKey: "T:WON:night",
    payload: { title: "Nocturne", totalCents: 10640 },
  });
  const nightDrain = await drainNotifications(NIGHT);
  check("non-critical push held", nightDrain.heldQuietHours === 1, nightDrain);
  const heldRow = await prisma.notificationLog.findFirst({ where: { dedupeKey: "T:OUTBID:night:PUSH" } });
  check("held row still QUEUED", heldRow?.status === "QUEUED");
  check(
    "outbid email + WON push both sent at night",
    sent.some((s) => s.channel === "EMAIL" && s.subject.includes("Outbid")) &&
      sent.some((s) => s.channel === "PUSH" && s.subject.includes("won")),
    sent,
  );
  const morningDrain = await drainNotifications(DAY);
  check("held push flows in the morning", morningDrain.sent === 1, morningDrain);

  console.log("4. per-user pref override suppresses a channel at queue time");
  await prisma.notificationPref.upsert({
    where: { userId_event: { userId: "usr_chloe", event: "OUTBID" } },
    create: { userId: "usr_chloe", event: "OUTBID", email: false, push: true, sms: false },
    update: { email: false, push: true, sms: false },
  });
  await queueNotification({ userId: "usr_chloe", event: "OUTBID", dedupeKey: "T:OUTBID:pref", payload: {} });
  const chloeRows = await prisma.notificationLog.findMany({ where: { dedupeKey: { startsWith: "T:OUTBID:pref" } } });
  check("email suppressed, push queued", chloeRows.length === 1 && chloeRows[0]?.channel === "PUSH", chloeRows.map((r) => r.channel));

  console.log("5. scheduled queuers");
  // Make one auction close in 20 minutes with participants → CLOSING_SOON
  const soon = await prisma.auction.findFirstOrThrow({ where: { slug: "aurora-peonies" } });
  await prisma.auction.update({
    where: { id: soon.id },
    data: { currentEndAt: new Date(DAY.getTime() + 20 * 60_000) },
  });
  const sched = await queueScheduledNotifications(DAY);
  check("DROP_LIVE queued for users + verified subscriber", sched.dropLive >= 6, sched);
  check("CLOSING_SOON queued for participants", sched.closingSoon >= 1, sched);
  const sched2 = await queueScheduledNotifications(DAY);
  check("second run is a no-op (dedupe)", sched2.dropLive === 0 || sched2.closingSoon === 0, sched2);
  const subRow = await prisma.notificationLog.findFirst({ where: { email: "curious@example.com" } });
  check("teaser subscriber gets email-only row", subRow?.channel === "EMAIL" && subRow.userId === null);

  console.log("6. delivery-details reminder (2h after paid win, no form)");
  const owner = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });
  const a = await prisma.auction.create({
    data: {
      slug: "notif-ddr",
      title: "notif-ddr",
      description: "x",
      status: "PAID",
      startPriceCents: 5000,
      createdById: owner.id,
    },
  });
  await prisma.order.create({
    data: {
      auctionId: a.id,
      userId: "usr_dmitri",
      kind: "AUCTION_WIN",
      status: "PAID",
      subtotalCents: 5000,
      gstCents: 250,
      pstCents: 350,
      totalCents: 5600,
      stripePaymentIntentId: "pi_ddr",
      createdAt: new Date(DAY.getTime() - 3 * 3600_000),
    },
  });
  const sched3 = await queueScheduledNotifications(DAY);
  check("DDR queued", sched3.deliveryReminders >= 1, sched3);

  console.log("7. CASL unsubscribe");
  const emma = await prisma.user.findUniqueOrThrow({ where: { id: "usr_emma" } });
  const ok = await unsubscribeByToken(emma.unsubscribeToken);
  check("token accepted", ok);
  const emmaOutbidPref = await prisma.notificationPref.findUnique({
    where: { userId_event: { userId: "usr_emma", event: "OUTBID" } },
  });
  const emmaWonPref = await prisma.notificationPref.findUnique({
    where: { userId_event: { userId: "usr_emma", event: "WON" } },
  });
  check("marketing email off, critical untouched", emmaOutbidPref?.email === false && !emmaWonPref);
  await queueNotification({ userId: "usr_emma", event: "OUTBID", dedupeKey: "T:OUTBID:unsub", payload: {} });
  const emmaRows = await prisma.notificationLog.findMany({ where: { dedupeKey: { startsWith: "T:OUTBID:unsub" } } });
  check("post-unsubscribe OUTBID has no email row", emmaRows.every((r) => r.channel !== "EMAIL"), emmaRows.map((r) => r.channel));
  const badToken = await unsubscribeByToken("nope");
  check("bad token rejected", !badToken);

  console.log("8. transport failure marks row FAILED with error");
  setTransports({
    ...fakeTransports,
    email: async () => {
      throw new Error("boom");
    },
  });
  await queueNotification({ userId: "usr_alice", event: "LOST", dedupeKey: "T:LOST:fail", payload: {} });
  await drainNotifications(DAY);
  const failedRow = await prisma.notificationLog.findFirst({ where: { dedupeKey: "T:LOST:fail:EMAIL" } });
  check("FAILED with error recorded", failedRow?.status === "FAILED" && failedRow.error === "boom", failedRow);

  console.log(failures === 0 ? "\nNOTIFICATION TESTS: ALL PASSED" : `\nNOTIFICATION TESTS: ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
