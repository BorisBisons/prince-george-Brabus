/**
 * Integration test for §8 delivery ops: form validation, scheduling, route
 * ordering, driver complete/fail with proof, and the failure-resolution
 * matrix (redelivery +$10 / pickup / refused). Fake payment gateway.
 * Run against a seeded database (npm run test:delivery).
 */
import { prisma } from "../src/lib/db";
import {
  scheduleDelivery,
  completeDelivery,
  completePickup,
  failDelivery,
  resolveFailedDelivery,
  assignRoute,
  orderStops,
  nextBusinessDay,
  isDeliverablePostal,
  DeliveryError,
} from "../src/lib/delivery";
import { setPaymentGateway, type PaymentGateway } from "../src/lib/payments";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ok — ${name}`);
  else {
    failures++;
    console.error(`  FAIL — ${name}`, detail ?? "");
  }
}

let chargeFails = false;
const charges: number[] = [];
const fakeGateway: PaymentGateway = {
  async charge(o) {
    charges.push(o.amountCents);
    return chargeFails ? { ok: false, declineCode: "card_declined" } : { ok: true, paymentIntentId: `pi_d_${charges.length}` };
  },
  async refund() {
    return { refundId: "re_d" };
  },
};

async function mkPaidOrder(slug: string, ownerId: string, userId: string) {
  const auction = await prisma.auction.create({
    data: {
      slug,
      title: slug,
      description: "x",
      status: "PAID",
      startPriceCents: 5000,
      createdById: ownerId,
    },
  });
  const order = await prisma.order.create({
    data: {
      auctionId: auction.id,
      userId,
      kind: "AUCTION_WIN",
      status: "PAID",
      subtotalCents: 5000,
      gstCents: 250,
      pstCents: 350,
      totalCents: 5600,
      stripePaymentIntentId: `pi_${slug}`,
    },
  });
  return { auction, order };
}

const FORM = {
  recipientName: "Jamie Fox",
  businessName: "City Hall",
  addressLine1: "1100 Patricia Blvd",
  postalCode: "v2l3v9",
  window: "W12_15" as const,
  giftNote: "You make Tuesdays feel like Fridays.",
  anonymousSender: false,
  buyerPhone: "+12505550111",
};

async function main() {
  setPaymentGateway(fakeGateway);
  const owner = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });

  console.log("1. postal validation + form guards");
  check("V2L valid", isDeliverablePostal("V2L 3V9") && isDeliverablePostal("v2k1a1"));
  check("out-of-zone rejected", !isDeliverablePostal("V2X 1A1") && !isDeliverablePostal("T5J 0N3"));
  const { order: o1 } = await mkPaidOrder("del-happy", owner.id, "usr_alice");
  let err = "";
  try {
    await scheduleDelivery(o1.id, "usr_alice", { ...FORM, postalCode: "V9A 1A1" });
  } catch (e) {
    err = e instanceof DeliveryError ? e.message : "";
  }
  check("zone error is friendly", err.includes("delivery zone"));
  try {
    await scheduleDelivery(o1.id, "usr_ben", FORM);
    err = "";
  } catch (e) {
    err = (e as Error).message;
  }
  check("other user blocked", err.includes("Not your order"));

  console.log("2. scheduling: form → DELIVERY_SCHEDULED, next business day");
  const { scheduledDate } = await scheduleDelivery(o1.id, "usr_alice", FORM);
  const a1 = await prisma.auction.findFirstOrThrow({ where: { slug: "del-happy" } });
  check("auction DELIVERY_SCHEDULED", a1.status === "DELIVERY_SCHEDULED");
  check("weekday scheduled", ![0, 6].includes(scheduledDate.getUTCDay()), scheduledDate);
  const d1 = await prisma.delivery.findUniqueOrThrow({ where: { orderId: o1.id } });
  check("postal normalized", d1.postalCode === "V2L 3V9");
  const notif = await prisma.notificationLog.count({
    where: { event: "DELIVERY_SCHEDULED", userId: "usr_alice" },
  });
  check("DELIVERY_SCHEDULED notification queued", notif >= 1);
  let dup = "";
  try {
    await scheduleDelivery(o1.id, "usr_alice", FORM);
  } catch (e) {
    dup = (e as Error).message;
  }
  check("double submit blocked", dup.includes("already") || dup.includes("isn't ready"));

  console.log("3. business-day math");
  check("Fri → Mon", nextBusinessDay(new Date("2026-08-14T20:00:00Z")).getUTCDay() === 1);
  check("Tue → Wed", nextBusinessDay(new Date("2026-08-11T20:00:00Z")).getUTCDay() === 3);

  console.log("4. route ordering: windows first, then FSA proximity");
  const routeIds = orderStops([
    { id: "a", postalCode: "V2N 1A1", window: "W12_15", addressLine1: "1 University Way" },
    { id: "b", postalCode: "V2L 1A1", window: "W10_12", addressLine1: "500 Dominion St" },
    { id: "c", postalCode: "V2K 1A1", window: "W10_12", addressLine1: "900 Hart Hwy" },
    { id: "d", postalCode: "V2M 1A1", window: "W15_17", addressLine1: "200 Spruce St" },
  ]);
  check("morning window first, downtown before Hart", routeIds.join(",") === "b,c,a,d", routeIds);

  console.log("5. driver: delivered with forced photo + GPS");
  await prisma.$transaction(async (tx) => {
    const { transition } = await import("../src/lib/auction/state-machine");
    await transition(tx, { auctionId: a1.id, to: "OUT_FOR_DELIVERY", actorType: "ADMIN", actorId: owner.id });
  });
  let photoErr = "";
  try {
    await completeDelivery(d1.id, owner.id, { photoUrl: "" });
  } catch (e) {
    photoErr = (e as Error).message;
  }
  check("photo required", photoErr.includes("Photo required"));
  await completeDelivery(d1.id, owner.id, { photoUrl: "https://x/p.webp", gpsLat: 53.91, gpsLng: -122.75 });
  const a1Done = await prisma.auction.findUniqueOrThrow({ where: { id: a1.id } });
  const d1Done = await prisma.delivery.findUniqueOrThrow({ where: { id: d1.id } });
  check("DELIVERED with proof", a1Done.status === "DELIVERED" && d1Done.gpsLat === 53.91 && d1Done.deliveredAt !== null);
  const deliveredNotif = await prisma.notificationLog.count({ where: { event: "DELIVERED", userId: "usr_alice" } });
  check("DELIVERED notification queued", deliveredNotif >= 1);

  console.log("6. failure → redelivery (+$10 fee, re-enters schedule)");
  const { auction: a2, order: o2 } = await mkPaidOrder("del-fail", owner.id, "usr_ben");
  await scheduleDelivery(o2.id, "usr_ben", FORM);
  const d2 = await prisma.delivery.findUniqueOrThrow({ where: { orderId: o2.id } });
  await prisma.$transaction(async (tx) => {
    const { transition } = await import("../src/lib/auction/state-machine");
    await transition(tx, { auctionId: a2.id, to: "OUT_FOR_DELIVERY", actorType: "ADMIN", actorId: owner.id });
  });
  await failDelivery(d2.id, owner.id, { reason: "RECIPIENT_UNREACHABLE", note: "Front desk had no idea", photoUrl: "https://x/f.webp" });
  const a2Failed = await prisma.auction.findUniqueOrThrow({ where: { id: a2.id } });
  check("DELIVERY_FAILED", a2Failed.status === "DELIVERY_FAILED");
  const dfNotif = await prisma.notificationLog.count({ where: { event: "DELIVERY_FAILED", userId: "usr_ben" } });
  check("failure notification queued", dfNotif >= 1);

  chargeFails = true;
  const declined = await resolveFailedDelivery(o2.id, "usr_ben", "redelivery");
  check("fee decline keeps options open", !declined.ok && declined.message.includes("didn't go through"));
  chargeFails = false;
  const resolved = await resolveFailedDelivery(o2.id, "usr_ben", "redelivery");
  check("redelivery accepted", resolved.ok, resolved);
  check("$10 charged", charges.includes(1000), charges);
  const a2Re = await prisma.auction.findUniqueOrThrow({ where: { id: a2.id } });
  const d2Re = await prisma.delivery.findUniqueOrThrow({ where: { id: d2.id } });
  check("back to DELIVERY_SCHEDULED, next business day, failure cleared",
    a2Re.status === "DELIVERY_SCHEDULED" && d2Re.failureReason === null && d2Re.redeliveryFeeCents === 1000 && d2Re.attemptCount === 1);

  console.log("7. failure → pickup, admin completes handoff");
  const { auction: a3, order: o3 } = await mkPaidOrder("del-pickup", owner.id, "usr_chloe");
  await scheduleDelivery(o3.id, "usr_chloe", FORM);
  const d3 = await prisma.delivery.findUniqueOrThrow({ where: { orderId: o3.id } });
  await prisma.$transaction(async (tx) => {
    const { transition } = await import("../src/lib/auction/state-machine");
    await transition(tx, { auctionId: a3.id, to: "OUT_FOR_DELIVERY", actorType: "ADMIN", actorId: owner.id });
  });
  await failDelivery(d3.id, owner.id, { reason: "WRONG_ADDRESS", note: "No suite 900 here" });
  const pickup = await resolveFailedDelivery(o3.id, "usr_chloe", "pickup");
  check("pickup chosen", pickup.ok && pickup.message.includes("Pickup"));
  const doubleResolve = await resolveFailedDelivery(o3.id, "usr_chloe", "redelivery");
  check("double resolution blocked", !doubleResolve.ok);
  await completePickup(d3.id, owner.id, "https://x/pickup.webp");
  const a3Done = await prisma.auction.findUniqueOrThrow({ where: { id: a3.id } });
  check("pickup handoff → DELIVERED", a3Done.status === "DELIVERED");

  console.log("8. recipient refused: logged, donated, no buyer options");
  const { auction: a4, order: o4 } = await mkPaidOrder("del-refused", owner.id, "usr_dmitri");
  await scheduleDelivery(o4.id, "usr_dmitri", FORM);
  const d4 = await prisma.delivery.findUniqueOrThrow({ where: { orderId: o4.id } });
  await prisma.$transaction(async (tx) => {
    const { transition } = await import("../src/lib/auction/state-machine");
    await transition(tx, { auctionId: a4.id, to: "OUT_FOR_DELIVERY", actorType: "ADMIN", actorId: owner.id });
  });
  await failDelivery(d4.id, owner.id, { reason: "RECIPIENT_REFUSED", note: "Said no thank you" });
  const d4After = await prisma.delivery.findUniqueOrThrow({ where: { id: d4.id } });
  check("auto-marked returned/donated", d4After.resolution === "RETURNED_DONATED");
  const refusedResolve = await resolveFailedDelivery(o4.id, "usr_dmitri", "redelivery");
  check("no redelivery option after refusal", !refusedResolve.ok);
  const refunds = await prisma.refund.count({ where: { orderId: o4.id } });
  check("no refund on refusal", refunds === 0);

  console.log("9. route assignment persists positions");
  const day = (await prisma.delivery.findUniqueOrThrow({ where: { id: d2.id } })).scheduledDate!;
  const count = await assignRoute(day);
  const positions = await prisma.delivery.findMany({
    where: { scheduledDate: day, deliveredAt: null, failureReason: null },
    select: { routePosition: true },
  });
  check("all pending stops positioned", count === positions.length && positions.every((p) => p.routePosition !== null), positions);

  console.log(failures === 0 ? "\nDELIVERY TESTS: ALL PASSED" : `\nDELIVERY TESTS: ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
