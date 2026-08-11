import { test, expect } from "@playwright/test";
import { FIX_CARD_WINDOW_MS } from "../src/lib/auction/state-machine";
import {
  prisma,
  signIn,
  createLiveAuction,
  setFakeGatewayMode,
  forceCloseAndSweep,
  runSweep,
} from "./helpers";

test.afterAll(async () => {
  await prisma.$disconnect();
});

test.describe("BloomBid end-to-end", () => {
  test("happy path: bid → outbid → win → pay → delivery form", async ({ browser, request }) => {
    await setFakeGatewayMode("succeed");
    const auction = await createLiveAuction("e2e-happy", 120);

    // Alice opens the auction and places the quick bid ($50 start).
    const aliceCtx = await browser.newContext();
    await signIn(aliceCtx, "usr_alice");
    const alice = await aliceCtx.newPage();
    await alice.goto(`/auctions/${auction.slug}`);
    await alice.getByRole("button", { name: /^Bid \$50$/ }).first().click();
    await expect(alice.getByText("Held by you")).toBeVisible();
    await expect(alice.getByText("You're winning")).toBeVisible();

    // Ben outbids with a custom amount through the same UI.
    const benCtx = await browser.newContext();
    await signIn(benCtx, "usr_ben");
    const ben = await benCtx.newPage();
    await ben.goto(`/auctions/${auction.slug}`);
    await ben.getByLabel("Or your own amount").fill("85");
    await ben.getByRole("button", { name: /^Bid$/ }).click();
    await expect(ben.getByText("Held by you")).toBeVisible();

    // Public history shows anonymized aliases.
    await expect(ben.getByText("Bidder #1")).toBeVisible();

    // Close + charge (fake gateway succeeds) → Ben's order is PAID.
    await forceCloseAndSweep(request, auction.id);
    const order = await prisma.order.findFirstOrThrow({ where: { auctionId: auction.id } });
    expect(order.userId).toBe("usr_ben");
    expect(order.status).toBe("PAID");
    expect(order.totalCents).toBe(Math.round(8500 * 1.12));

    // Ben sets up delivery through the form.
    await ben.goto("/my-orders");
    await ben.getByRole("link", { name: /Set up delivery/ }).first().click();
    await ben.getByLabel("Recipient's name").fill("Priya Okafor");
    await ben.getByLabel("Workplace / business name").fill("Northern Health");
    await ben.getByLabel("Street address (Prince George)").fill("1488 4th Ave");
    await ben.getByLabel("Postal code").fill("V2L 4Y2");
    await ben.getByLabel(/Gift note/).fill("Happy anniversary — e2e edition.");
    await ben.getByLabel(/Your mobile/).fill("+12505550142");
    await ben.getByRole("button", { name: "Schedule delivery" }).click();
    await ben.waitForURL(/my-orders/);

    const after = await prisma.auction.findUniqueOrThrow({ where: { id: auction.id } });
    expect(after.status).toBe("DELIVERY_SCHEDULED");
    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(delivery.postalCode).toBe("V2L 4Y2");

    await aliceCtx.close();
    await benCtx.close();
  });

  test("snipe path: bid in final 5 minutes extends the close, twice", async ({ browser }) => {
    const auction = await createLiveAuction("e2e-snipe", 3); // 3 minutes left
    const endBefore = (await prisma.auction.findUniqueOrThrow({ where: { id: auction.id } }))
      .currentEndAt!;

    const chloeCtx = await browser.newContext();
    await signIn(chloeCtx, "usr_chloe");
    const chloe = await chloeCtx.newPage();
    await chloe.goto(`/auctions/${auction.slug}`);
    await chloe.getByRole("button", { name: /^Bid \$50$/ }).first().click();
    await expect(chloe.getByText(/extended ×1/)).toBeVisible();

    let state = await prisma.auction.findUniqueOrThrow({ where: { id: auction.id } });
    expect(state.status).toBe("CLOSING_EXTENDED");
    expect(state.currentEndAt!.getTime()).toBe(endBefore.getTime() + 5 * 60_000);

    // Second snipe from another bidder self-loops and logs a second extension.
    // (The first extension pushed the close 8 minutes out — pull it back into
    // the snipe window so the next bid is genuinely a snipe.)
    await prisma.auction.update({
      where: { id: auction.id },
      data: { currentEndAt: new Date(Date.now() + 2 * 60_000) },
    });
    const dmitriCtx = await browser.newContext();
    await signIn(dmitriCtx, "usr_dmitri");
    const dmitri = await dmitriCtx.newPage();
    await dmitri.goto(`/auctions/${auction.slug}`);
    await dmitri.getByRole("button", { name: /^Bid \$55$/ }).first().click();
    await expect(dmitri.getByText(/extended ×2/)).toBeVisible();

    state = await prisma.auction.findUniqueOrThrow({ where: { id: auction.id } });
    expect(state.extensionCount).toBe(2);
    const extensionEvents = await prisma.auctionEvent.count({
      where: { auctionId: auction.id, type: "SNIPE_EXTENSION" },
    });
    expect(extensionEvents).toBe(2);

    await chloeCtx.close();
    await dmitriCtx.close();
  });

  test("payment-fail path: retry ladder → second-chance offer → accept", async ({
    browser,
    request,
  }) => {
    const auction = await createLiveAuction("e2e-payfail", 120);

    // Two bidders through the API surface (UI already covered above).
    const emmaCtx = await browser.newContext();
    await signIn(emmaCtx, "usr_emma");
    const emma = await emmaCtx.newPage();
    await emma.goto(`/auctions/${auction.slug}`);
    await emma.getByRole("button", { name: /^Bid \$50$/ }).first().click();
    await expect(emma.getByText("Held by you")).toBeVisible();

    const benCtx = await browser.newContext();
    await signIn(benCtx, "usr_ben");
    const ben = await benCtx.newPage();
    await ben.goto(`/auctions/${auction.slug}`);
    await ben.getByLabel("Or your own amount").fill("70");
    await ben.getByRole("button", { name: /^Bid$/ }).click();
    await expect(ben.getByText("Held by you")).toBeVisible();

    // Ben's card is broken: close → immediate retry also fails → fix window.
    await setFakeGatewayMode("fail");
    await forceCloseAndSweep(request, auction.id);
    let order = await prisma.order.findFirstOrThrow({
      where: { auctionId: auction.id, kind: "AUCTION_WIN" },
    });
    expect(order.status).toBe("PENDING_CHARGE");
    expect(order.chargeAttempts).toBe(2);
    expect(order.fixCardDeadlineAt).not.toBeNull();

    // Ben sees the fix-card prompt.
    await ben.goto("/my-orders");
    await expect(ben.getByText(/couldn't charge your card/)).toBeVisible();

    // Walk the 30/60/120 ladder to exhaustion (anchor shifted, cron re-run).
    for (const minutes of [31, 61, 121]) {
      await prisma.order.update({
        where: { id: order.id },
        data: {
          fixCardDeadlineAt: new Date(Date.now() + FIX_CARD_WINDOW_MS - minutes * 60e3),
          nextRetryAt: new Date(Date.now() - 1000),
        },
      });
      await runSweep(request);
    }
    order = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(order.status).toBe("FAILED");

    // Second-chance offer lands with Emma at HER highest bid ($50).
    const offer = await prisma.order.findFirstOrThrow({
      where: { auctionId: auction.id, kind: "SECOND_CHANCE" },
    });
    expect(offer.userId).toBe("usr_emma");
    expect(offer.subtotalCents).toBe(5000);

    // Emma accepts through the UI with a healthy card → PAID.
    await setFakeGatewayMode("succeed");
    await emma.goto("/my-orders");
    await expect(emma.getByText(/yours at your top bid/)).toBeVisible();
    await emma.getByRole("button", { name: /Take it/ }).click();
    await emma.waitForLoadState("networkidle");

    const finalAuction = await prisma.auction.findUniqueOrThrow({ where: { id: auction.id } });
    expect(finalAuction.status).toBe("PAID");
    const paidOffer = await prisma.order.findUniqueOrThrow({ where: { id: offer.id } });
    expect(paidOffer.status).toBe("PAID");

    await emmaCtx.close();
    await benCtx.close();
  });
});
