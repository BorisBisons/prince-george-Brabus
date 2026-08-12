/**
 * Integration test for the §6 payments/cancellation matrix, run against a
 * seeded database with a fake payment gateway (npm run test:payments).
 * Ladder timing is simulated by shifting fixCardDeadlineAt (the anchor is
 * derived from it), not by sleeping.
 */
import { prisma } from "../src/lib/db";
import { placeBid } from "../src/lib/auction/bidding";
import { runAuctionSweep } from "../src/lib/auction/close";
import {
  buyNow,
  cancelOrderByWinner,
  adminRefund,
  goodwillCredit,
  respondToOffer,
  runPaymentSweep,
  setPaymentGateway,
  PaymentError,
  type PaymentGateway,
} from "../src/lib/payments";
import { FIX_CARD_WINDOW_MS } from "../src/lib/auction/state-machine";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) console.log(`  ok — ${name}`);
  else {
    failures++;
    console.error(`  FAIL — ${name}`, detail ?? "");
  }
}

/** Gateway that fails the next N charges, then succeeds. */
function makeFakeGateway() {
  let failuresLeft = 0;
  let counter = 0;
  const charges: string[] = [];
  const refunds: { paymentIntentId: string; amountCents: number }[] = [];
  const gateway: PaymentGateway = {
    async charge(opts) {
      charges.push(opts.idempotencyKey);
      if (failuresLeft > 0) {
        failuresLeft--;
        return { ok: false, declineCode: "card_declined" };
      }
      return { ok: true, paymentIntentId: `pi_fake_${++counter}` };
    },
    async refund(opts) {
      refunds.push({ paymentIntentId: opts.paymentIntentId, amountCents: opts.amountCents });
      return { refundId: `re_fake_${++counter}` };
    },
  };
  return {
    gateway,
    charges,
    refunds,
    failNext: (n: number) => {
      failuresLeft = n;
    },
  };
}

async function mkClosedAuction(slug: string, ownerId: string, bids: Array<[string, number]>) {
  const a = await prisma.auction.create({
    data: {
      slug,
      title: slug,
      description: "test",
      status: "LIVE",
      startPriceCents: 5000,
      createdById: ownerId,
      scheduledStartAt: new Date(Date.now() - 7200e3),
      scheduledEndAt: new Date(Date.now() + 3600e3),
      currentEndAt: new Date(Date.now() + 3600e3),
    },
  });
  for (const [userId, amountCents] of bids) {
    await placeBid({ auctionId: a.id, userId, amountCents });
  }
  await prisma.auction.update({ where: { id: a.id }, data: { currentEndAt: new Date(Date.now() - 1000) } });
  return a;
}

/** Rewind the ladder anchor so the next cron retry is "due" at minute offset `m`. */
async function warpLadder(orderId: string, minutesSinceFirstFailure: number) {
  await prisma.order.update({
    where: { id: orderId },
    data: {
      fixCardDeadlineAt: new Date(Date.now() + FIX_CARD_WINDOW_MS - minutesSinceFirstFailure * 60e3),
      nextRetryAt: new Date(Date.now() - 1000),
    },
  });
}

async function main() {
  const fake = makeFakeGateway();
  setPaymentGateway(fake.gateway);
  const owner = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN" } });

  console.log("1. happy path: close → charge → PAID");
  const a1 = await mkClosedAuction("pay-happy", owner.id, [["usr_alice", 5000], ["usr_ben", 6000]]);
  await runAuctionSweep();
  const a1After = await prisma.auction.findUniqueOrThrow({ where: { id: a1.id }, include: { orders: true } });
  check("auction PAID", a1After.status === "PAID");
  check("order PAID with 12% tax", a1After.orders[0]?.status === "PAID" && a1After.orders[0]?.totalCents === 6720);
  const wonQueued = await prisma.notificationLog.count({ where: { event: "WON", userId: "usr_ben" } });
  check("WON queued after charge", wonQueued >= 1);

  console.log("2. failure ladder: immediate retry, 30/60/120, exhaustion → 2nd chance");
  const a2 = await mkClosedAuction("pay-fail", owner.id, [["usr_chloe", 5000], ["usr_dmitri", 7000]]);
  fake.failNext(99);
  await runAuctionSweep();
  let order2 = await prisma.order.findFirstOrThrow({ where: { auctionId: a2.id, kind: "AUCTION_WIN" } });
  check("still PENDING_CHARGE after immediate retry", order2.status === "PENDING_CHARGE");
  check("2 attempts (initial + immediate)", order2.chargeAttempts === 2, order2.chargeAttempts);
  check("fix-card window set", order2.fixCardDeadlineAt !== null && order2.nextRetryAt !== null);
  const pfNotif = await prisma.notificationLog.count({ where: { event: "PAYMENT_FAILED", userId: "usr_dmitri" } });
  check("PAYMENT_FAILED queued (E+P+S policy, SMS off)", pfNotif === 2, pfNotif);

  await warpLadder(order2.id, 31);
  await runPaymentSweep();
  order2 = await prisma.order.findUniqueOrThrow({ where: { id: order2.id } });
  check("retry at +30 walked to +60", order2.chargeAttempts === 3 && order2.nextRetryAt !== null);

  await warpLadder(order2.id, 61);
  await runPaymentSweep();
  await warpLadder(order2.id, 121);
  await runPaymentSweep();
  order2 = await prisma.order.findUniqueOrThrow({ where: { id: order2.id } });
  check("exhausted → FAILED", order2.status === "FAILED", order2);
  const dmitri = await prisma.user.findUniqueOrThrow({ where: { id: "usr_dmitri" } });
  check("winner flagged (1 failure, not yet suspended)", dmitri.paymentFailureCount === 1 && dmitri.biddingSuspendedAt === null);
  const offer = await prisma.order.findFirstOrThrow({ where: { auctionId: a2.id, kind: "SECOND_CHANCE" } });
  check("2nd bidder offered at THEIR highest bid", offer.userId === "usr_chloe" && offer.subtotalCents === 5000 && offer.status === "OFFERED");
  const offerNotif = await prisma.notificationLog.count({ where: { event: "SECOND_CHANCE_OFFER", userId: "usr_chloe" } });
  check("offer notification queued", offerNotif >= 1);

  console.log("3. second-chance accept → charge → PAID");
  fake.failNext(0); // healthy card again
  const accept = await respondToOffer(offer.id, "usr_chloe", "accept");
  check("accept ok", accept.ok, accept);
  const a2After = await prisma.auction.findUniqueOrThrow({ where: { id: a2.id } });
  check("auction PAID via 2nd chance", a2After.status === "PAID");

  console.log("4. offer decline → LAST_CHANCE");
  const a4 = await mkClosedAuction("pay-decline", owner.id, [["usr_alice", 5000], ["usr_emma", 7000]]);
  fake.failNext(99);
  await runAuctionSweep();
  const o4 = await prisma.order.findFirstOrThrow({ where: { auctionId: a4.id, kind: "AUCTION_WIN" } });
  await warpLadder(o4.id, 121);
  await runPaymentSweep();
  fake.failNext(0);
  const offer4 = await prisma.order.findFirstOrThrow({ where: { auctionId: a4.id, kind: "SECOND_CHANCE" } });
  await respondToOffer(offer4.id, "usr_alice", "decline");
  const a4After = await prisma.auction.findUniqueOrThrow({ where: { id: a4.id } });
  check("declined → LAST_CHANCE", a4After.status === "LAST_CHANCE");
  const emma = await prisma.user.findUniqueOrThrow({ where: { id: "usr_emma" } });
  check("emma flagged once", emma.paymentFailureCount === 1);

  console.log("5. second failure → suspension; new card lifts it");
  const a5 = await mkClosedAuction("pay-suspend", owner.id, [["usr_ben", 5000], ["usr_emma", 7000]]);
  fake.failNext(99);
  await runAuctionSweep();
  const o5 = await prisma.order.findFirstOrThrow({ where: { auctionId: a5.id, kind: "AUCTION_WIN" } });
  await warpLadder(o5.id, 121);
  await runPaymentSweep();
  fake.failNext(0);
  const emmaSuspended = await prisma.user.findUniqueOrThrow({ where: { id: "usr_emma" } });
  check("2 failures = suspended", emmaSuspended.paymentFailureCount === 2 && emmaSuspended.biddingSuspendedAt !== null);
  let suspendedBidRejected = false;
  try {
    await placeBid({ auctionId: a5.id, userId: "usr_emma", amountCents: 9000 });
  } catch {
    suspendedBidRejected = true;
  }
  check("suspended user can't bid", suspendedBidRejected);
  const { upsertCardSnapshot } = await import("../src/lib/payment-methods");
  await upsertCardSnapshot("usr_emma", {
    id: "pm_fresh_emma",
    type: "card",
    card: { brand: "visa", last4: "9999", exp_month: 12, exp_year: new Date().getFullYear() + 3 },
  } as never);
  const emmaBack = await prisma.user.findUniqueOrThrow({ where: { id: "usr_emma" } });
  check("fresh valid card lifts suspension", emmaBack.biddingSuspendedAt === null);

  console.log("6. winner cancel ≤1h: 85% refund → 2nd-chance rollover");
  const a6 = await mkClosedAuction("pay-cancel", owner.id, [["usr_alice", 6000], ["usr_ben", 8000]]);
  await runAuctionSweep(); // ben pays 8960
  const o6 = await prisma.order.findFirstOrThrow({ where: { auctionId: a6.id, kind: "AUCTION_WIN" } });
  const cancel = await cancelOrderByWinner(o6.id, "usr_ben");
  check("cancel ok", cancel.ok, cancel);
  check("85% refunded", cancel.refundedCents === Math.round(8960 * 0.85), cancel.refundedCents);
  const refundRow = await prisma.refund.findFirstOrThrow({ where: { orderId: o6.id } });
  check("refund row with restocking code", refundRow.reasonCode === "WINNER_CANCEL_RESTOCKING");
  const rollover = await prisma.order.findFirst({ where: { auctionId: a6.id, kind: "SECOND_CHANCE" } });
  check("rolled to alice at her highest ($60)", rollover?.userId === "usr_alice" && rollover?.subtotalCents === 6000);
  const cancelAgain = await cancelOrderByWinner(o6.id, "usr_ben");
  check("double-cancel rejected", !cancelAgain.ok);

  console.log("7. cancel windows enforced");
  const a7 = await mkClosedAuction("pay-cancel-late", owner.id, [["usr_ben", 6000]]);
  await runAuctionSweep();
  const o7 = await prisma.order.findFirstOrThrow({ where: { auctionId: a7.id } });
  await prisma.order.update({ where: { id: o7.id }, data: { createdAt: new Date(Date.now() - 2 * 3600e3) } });
  const lateCancel = await cancelOrderByWinner(o7.id, "usr_ben");
  check("cancel after 1h rejected", !lateCancel.ok && lateCancel.message.includes("window"));

  console.log("8. offer expiry via sweep");
  const a8 = await mkClosedAuction("pay-expire", owner.id, [["usr_alice", 5000], ["usr_ben", 7000]]);
  fake.failNext(99);
  await runAuctionSweep();
  const o8 = await prisma.order.findFirstOrThrow({ where: { auctionId: a8.id, kind: "AUCTION_WIN" } });
  await warpLadder(o8.id, 121);
  await runPaymentSweep();
  fake.failNext(0);
  const offer8 = await prisma.order.findFirstOrThrow({ where: { auctionId: a8.id, kind: "SECOND_CHANCE" } });
  await prisma.order.update({ where: { id: offer8.id }, data: { offerExpiresAt: new Date(Date.now() - 1000) } });
  const sweep8 = await runPaymentSweep();
  check("expired offer swept", sweep8.offersExpired.includes(offer8.id));
  const a8After = await prisma.auction.findUniqueOrThrow({ where: { id: a8.id } });
  check("expiry → LAST_CHANCE", a8After.status === "LAST_CHANCE");

  console.log("9. buy-now happy + declined");
  const buy = await buyNow(a8.id, "usr_dmitri");
  const a8Bought = await prisma.auction.findUniqueOrThrow({ where: { id: a8.id } });
  const buyOrder = await prisma.order.findUniqueOrThrow({ where: { id: buy.orderId } });
  check("buy-now → PAID at start price", a8Bought.status === "PAID" && buyOrder.subtotalCents === 5000 && buyOrder.status === "PAID");

  fake.failNext(99);
  let buyDeclined = false;
  try {
    await buyNow(a4.id, "usr_dmitri"); // a4 is in LAST_CHANCE from test 4
  } catch (e) {
    buyDeclined = e instanceof PaymentError;
  }
  fake.failNext(0);
  const a4Reverted = await prisma.auction.findUniqueOrThrow({ where: { id: a4.id } });
  check("declined buy-now reverts to LAST_CHANCE", buyDeclined && a4Reverted.status === "LAST_CHANCE");

  console.log("10. admin refunds + credits");
  await adminRefund({ orderId: buy.orderId, adminId: owner.id, amountCents: 1000, reasonCode: "ADMIN_PARTIAL", note: "test" });
  let buyOrderAfter = await prisma.order.findUniqueOrThrow({ where: { id: buy.orderId } });
  check("partial refund status", buyOrderAfter.status === "PARTIALLY_REFUNDED");
  await adminRefund({ orderId: buy.orderId, adminId: owner.id, amountCents: buyOrderAfter.totalCents - 1000, reasonCode: "ADMIN_FULL" });
  buyOrderAfter = await prisma.order.findUniqueOrThrow({ where: { id: buy.orderId } });
  check("full refund status", buyOrderAfter.status === "REFUNDED");
  let overRefund = false;
  try {
    await adminRefund({ orderId: buy.orderId, adminId: owner.id, amountCents: 1, reasonCode: "OTHER" });
  } catch (e) {
    overRefund = e instanceof PaymentError;
  }
  check("over-refund rejected", overRefund);
  const gw = await goodwillCredit(o7.id, owner.id);
  const credit = await prisma.credit.findFirst({ where: { sourceOrderId: o7.id } });
  check("goodwill 50% credit issued", gw === Math.round(6720 / 2) && credit?.amountCents === gw);

  console.log(failures === 0 ? "\nPAYMENT TESTS: ALL PASSED" : `\nPAYMENT TESTS: ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
