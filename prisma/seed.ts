/**
 * BloomBid seed — 5 arrangements spread across the lifecycle so every screen
 * has something real to render:
 *
 *   1. Aurora Peonies      LIVE               proxy-bid battle in progress
 *   2. Midnight Garden     CLOSING_EXTENDED   two snipe extensions logged
 *   3. Juniper & Cream     DELIVERY_SCHEDULED won, paid, on today's run sheet
 *   4. Winter Rose Nocturne DELIVERED         full happy path incl. photo + GPS
 *   5. Wild Lupine         LAST_CHANCE        closed unsold, buy-now open
 *
 * Idempotent: wipes and re-creates. Times are offsets from `now` so the data
 * always looks live no matter when you seed.
 */
import { PrismaClient, AuctionStatus, ActorType, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

const now = new Date();
const min = (n: number) => new Date(now.getTime() + n * 60_000);
const hr = (n: number) => min(n * 60);
const day = (n: number) => hr(n * 24);

const photo = (slug: string, n: number) =>
  `https://picsum.photos/seed/bloombid-${slug}-${n}/1200/1500`; // 4:5, ≥1200px

async function main() {
  // Wipe in dependency order
  await prisma.notificationLog.deleteMany();
  await prisma.notificationPref.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.refund.deleteMany();
  await prisma.credit.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.auctionEvent.deleteMany();
  await prisma.auction.updateMany({ data: { currentBidId: null } });
  await prisma.bid.deleteMany();
  await prisma.proxyBid.deleteMany();
  await prisma.auctionParticipant.deleteMany();
  await prisma.order.deleteMany();
  await prisma.auctionPhoto.deleteMany();
  await prisma.auction.deleteMany();
  await prisma.paymentMethod.deleteMany();
  await prisma.emailSubscriber.deleteMany();
  await prisma.stripeWebhookEvent.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();

  // --- Users ---------------------------------------------------------------
  const owner = await prisma.user.create({
    data: {
      id: "usr_owner",
      email: "owner@bloombid.ca",
      emailVerified: day(-30),
      name: "The Florist",
      role: "ADMIN",
    },
  });

  const buyerRows: Array<[string, string, string]> = [
    ["usr_alice", "alice@example.com", "Alice Tremblay"],
    ["usr_ben", "ben@example.com", "Ben Okafor"],
    ["usr_chloe", "chloe@example.com", "Chloe Sandhu"],
    ["usr_dmitri", "dmitri@example.com", "Dmitri Wolf"],
    ["usr_emma", "emma@example.com", "Emma Lindqvist"],
  ];
  const buyers = await Promise.all(
    buyerRows.map(([id, email, name], i) =>
      prisma.user.create({
        data: {
          id,
          email,
          name,
          emailVerified: day(-20 + i),
          stripeCustomerId: `cus_seed_${id}`,
          paymentMethods: {
            create: {
              stripePaymentMethodId: `pm_seed_${id}`,
              brand: ["visa", "mastercard", "visa", "amex", "visa"][i]!,
              last4: String(4240 + i),
              expMonth: ((i * 3) % 12) + 1,
              expYear: now.getFullYear() + 2,
              isDefault: true,
            },
          },
        },
      }),
    ),
  );
  const [alice, ben, chloe, dmitri, emma] = buyers as [
    (typeof buyers)[0], (typeof buyers)[0], (typeof buyers)[0], (typeof buyers)[0], (typeof buyers)[0],
  ];

  // A couple of non-default notification prefs (missing row = event defaults)
  await prisma.notificationPref.createMany({
    data: [
      { userId: alice.id, event: "OUTBID", email: true, push: true, sms: false },
      { userId: chloe.id, event: "CLOSING_SOON", email: false, push: true, sms: false },
      { userId: dmitri.id, event: "DROP_LIVE", email: false, push: false, sms: false },
    ],
  });

  await prisma.emailSubscriber.create({
    data: { email: "curious@example.com", verifiedAt: day(-3) },
  });

  await prisma.setting.create({
    data: { key: "kill_switch", value: { active: false, banner: null } },
  });

  // --- Helpers -------------------------------------------------------------
  type EventRow = {
    auctionId: string;
    type: string;
    fromStatus?: AuctionStatus | null;
    toStatus?: AuctionStatus | null;
    actorType: ActorType;
    actorId?: string | null;
    payload?: Prisma.InputJsonValue;
    createdAt: Date;
  };
  const events: EventRow[] = [];

  async function createAuction(opts: {
    id: string;
    slug: string;
    title: string;
    description: string;
    status: AuctionStatus;
    startPriceCents: number;
    scheduledStartAt: Date;
    scheduledEndAt: Date;
    currentEndAt?: Date;
    extensionCount?: number;
    lastChanceExpiresAt?: Date;
  }) {
    const a = await prisma.auction.create({
      data: {
        ...opts,
        currentEndAt: opts.currentEndAt ?? opts.scheduledEndAt,
        createdById: owner.id,
        photos: {
          create: [0, 1, 2].map((n) => ({
            url: photo(opts.slug, n),
            width: 1200,
            height: 1500,
            position: n,
          })),
        },
      },
    });
    events.push(
      {
        auctionId: a.id, type: "PUBLISHED", fromStatus: "DRAFT", toStatus: "SCHEDULED",
        actorType: "ADMIN", actorId: owner.id, createdAt: new Date(opts.scheduledStartAt.getTime() - 3_600_000),
      },
      {
        auctionId: a.id, type: "OPENED", fromStatus: "SCHEDULED", toStatus: "LIVE",
        actorType: "SYSTEM", createdAt: opts.scheduledStartAt,
      },
    );
    return a;
  }

  /** Insert a bid history; assigns stable Bidder #N aliases in first-bid order. */
  async function placeBids(
    auctionId: string,
    rows: Array<{ user: { id: string }; amountCents: number; at: Date; isProxy?: boolean; proxyBidId?: string }>,
  ) {
    const aliasByUser = new Map<string, number>();
    let lastBidId: string | null = null;
    for (const r of rows) {
      if (!aliasByUser.has(r.user.id)) {
        const bidderNumber = aliasByUser.size + 1;
        aliasByUser.set(r.user.id, bidderNumber);
        await prisma.auctionParticipant.create({
          data: { auctionId, userId: r.user.id, bidderNumber, createdAt: r.at },
        });
      }
      const bid = await prisma.bid.create({
        data: {
          auctionId,
          userId: r.user.id,
          amountCents: r.amountCents,
          isProxy: r.isProxy ?? false,
          proxyBidId: r.proxyBidId,
          createdAt: r.at,
        },
      });
      events.push({
        auctionId, type: "BID_PLACED", actorType: r.isProxy ? "SYSTEM" : "USER", actorId: r.user.id,
        payload: { amountCents: r.amountCents, bidderNumber: aliasByUser.get(r.user.id)!, isProxy: r.isProxy ?? false },
        createdAt: r.at,
      });
      lastBidId = bid.id;
    }
    if (lastBidId) {
      await prisma.auction.update({ where: { id: auctionId }, data: { currentBidId: lastBidId } });
    }
    return lastBidId;
  }

  // --- 1. Aurora Peonies — LIVE with a proxy battle ------------------------
  const a1 = await createAuction({
    id: "auc_aurora",
    slug: "aurora-peonies",
    title: "Aurora Peonies",
    description:
      "Blush peonies with silver-dollar eucalyptus and a whisper of astilbe. The kind of arrangement that makes the whole office ask who sent it.",
    status: "LIVE",
    startPriceCents: 4500,
    scheduledStartAt: hr(-4),
    scheduledEndAt: hr(5),
  });
  const chloeProxy = await prisma.proxyBid.create({
    data: { auctionId: a1.id, userId: chloe.id, ceilingCents: 9000, createdAt: hr(-3) },
  });
  events.push({
    auctionId: a1.id, type: "PROXY_SET", actorType: "USER", actorId: chloe.id,
    payload: { ceilingCents: 9000 }, createdAt: hr(-3),
  });
  await placeBids(a1.id, [
    { user: alice, amountCents: 4500, at: hr(-3.5) },
    { user: chloe, amountCents: 5000, at: hr(-3) },
    { user: alice, amountCents: 5500, at: hr(-2.2) },
    { user: chloe, amountCents: 6000, at: hr(-2.2), isProxy: true, proxyBidId: chloeProxy.id },
    { user: dmitri, amountCents: 6500, at: hr(-1) },
    { user: chloe, amountCents: 7000, at: hr(-1), isProxy: true, proxyBidId: chloeProxy.id },
  ]);

  // --- 2. Midnight Garden — CLOSING_EXTENDED, snipe war --------------------
  const a2 = await createAuction({
    id: "auc_midnight",
    slug: "midnight-garden",
    title: "Midnight Garden",
    description:
      "Deep purple ranunculus, black calla lilies, forest greens. Dramatic, moody, unforgettable — for the partner who wears a lot of black.",
    status: "CLOSING_EXTENDED",
    startPriceCents: 5500,
    scheduledStartAt: hr(-9),
    scheduledEndAt: min(-6),
    currentEndAt: min(4), // two 5-min extensions past the original close
    extensionCount: 2,
  });
  await placeBids(a2.id, [
    { user: ben, amountCents: 5500, at: hr(-7) },
    { user: emma, amountCents: 6000, at: hr(-3) },
    { user: ben, amountCents: 6500, at: min(-10) },
    { user: emma, amountCents: 7000, at: min(-8) }, // inside final 5 min → extension
    { user: ben, amountCents: 7500, at: min(-3) }, // again
  ]);
  events.push(
    {
      auctionId: a2.id, type: "SNIPE_EXTENSION", fromStatus: "LIVE", toStatus: "CLOSING_EXTENDED",
      actorType: "SYSTEM", payload: { extension: 1, newEndAt: min(-1).toISOString() }, createdAt: min(-8),
    },
    {
      auctionId: a2.id, type: "SNIPE_EXTENSION", fromStatus: "CLOSING_EXTENDED", toStatus: "CLOSING_EXTENDED",
      actorType: "SYSTEM", payload: { extension: 2, newEndAt: min(4).toISOString() }, createdAt: min(-3),
    },
  );

  // --- 3. Juniper & Cream — won yesterday, paid, on today's run sheet ------
  const a3 = await createAuction({
    id: "auc_juniper",
    slug: "juniper-and-cream",
    title: "Juniper & Cream",
    description:
      "Cream garden roses nested in fresh juniper and seeded eucalyptus. Smells like a walk in the Ancient Forest.",
    status: "DELIVERY_SCHEDULED",
    startPriceCents: 5000,
    scheduledStartAt: day(-1),
    scheduledEndAt: new Date(day(-1).getTime() + 9 * 3_600_000),
  });
  await placeBids(a3.id, [
    { user: emma, amountCents: 5000, at: new Date(day(-1).getTime() + 2 * 3_600_000) },
    { user: ben, amountCents: 5500, at: new Date(day(-1).getTime() + 4 * 3_600_000) },
    { user: emma, amountCents: 7500, at: new Date(day(-1).getTime() + 6 * 3_600_000) },
    { user: ben, amountCents: 8500, at: new Date(day(-1).getTime() + 8 * 3_600_000) },
  ]);
  const a3Close = new Date(day(-1).getTime() + 9 * 3_600_000);
  const order3 = await prisma.order.create({
    data: {
      auctionId: a3.id,
      userId: ben.id,
      kind: "AUCTION_WIN",
      status: "PAID",
      subtotalCents: 8500,
      gstCents: 425, // 5% GST
      pstCents: 595, // 7% BC PST
      totalCents: 9520,
      stripePaymentIntentId: "pi_seed_juniper",
      chargeAttempts: 1,
      createdAt: a3Close,
      delivery: {
        create: {
          recipientName: "Priya Okafor",
          businessName: "Northern Health — Suite 300",
          addressLine1: "1488 4th Ave",
          postalCode: "V2L 4Y2",
          window: "W10_12",
          giftNote: "Eight years and you still make the bad days easy. Happy anniversary. — B",
          anonymousSender: false,
          buyerPhone: "+12505550142",
          scheduledDate: now,
          routePosition: 1,
        },
      },
    },
  });
  events.push(
    { auctionId: a3.id, type: "CLOSED", fromStatus: "CLOSING_EXTENDED", toStatus: "CLOSED_WON", actorType: "SYSTEM", payload: { winningBidCents: 8500 }, createdAt: a3Close },
    { auctionId: a3.id, type: "ORDER_CREATED", fromStatus: "CLOSED_WON", toStatus: "PAYMENT_PENDING", actorType: "SYSTEM", payload: { orderId: order3.id }, createdAt: a3Close },
    { auctionId: a3.id, type: "CHARGE_SUCCEEDED", fromStatus: "PAYMENT_PENDING", toStatus: "PAID", actorType: "STRIPE", payload: { paymentIntentId: "pi_seed_juniper", totalCents: 9520 }, createdAt: new Date(a3Close.getTime() + 60_000) },
    { auctionId: a3.id, type: "DELIVERY_SCHEDULED", fromStatus: "PAID", toStatus: "DELIVERY_SCHEDULED", actorType: "USER", actorId: ben.id, createdAt: new Date(a3Close.getTime() + 25 * 60_000) },
  );
  // Note: a3's close came out of an extension in this fake history; give it the matching state fields
  await prisma.auction.update({ where: { id: a3.id }, data: { extensionCount: 1 } });
  events.splice(
    events.findIndex((e) => e.auctionId === a3.id && e.type === "CLOSED"), 0,
    {
      auctionId: a3.id, type: "SNIPE_EXTENSION", fromStatus: "LIVE", toStatus: "CLOSING_EXTENDED",
      actorType: "SYSTEM", payload: { extension: 1 }, createdAt: new Date(day(-1).getTime() + 8 * 3_600_000),
    },
  );

  // --- 4. Winter Rose Nocturne — the complete happy path, DELIVERED --------
  const a4 = await createAuction({
    id: "auc_nocturne",
    slug: "winter-rose-nocturne",
    title: "Winter Rose Nocturne",
    description:
      "Garnet roses, dark scabiosa, and pine — winter romance with the volume turned up.",
    status: "DELIVERED",
    startPriceCents: 6000,
    scheduledStartAt: day(-2),
    scheduledEndAt: new Date(day(-2).getTime() + 9 * 3_600_000),
  });
  const emmaProxy4 = await prisma.proxyBid.create({
    data: {
      auctionId: a4.id, userId: emma.id, ceilingCents: 9000,
      status: "CEILING_REACHED", notifiedCeilingReachedAt: new Date(day(-2).getTime() + 7 * 3_600_000),
      createdAt: new Date(day(-2).getTime() + 1 * 3_600_000),
    },
  });
  await placeBids(a4.id, [
    { user: emma, amountCents: 6000, at: new Date(day(-2).getTime() + 1 * 3_600_000) },
    { user: alice, amountCents: 6500, at: new Date(day(-2).getTime() + 3 * 3_600_000) },
    { user: emma, amountCents: 7000, at: new Date(day(-2).getTime() + 3 * 3_600_000), isProxy: true, proxyBidId: emmaProxy4.id },
    { user: alice, amountCents: 9500, at: new Date(day(-2).getTime() + 7 * 3_600_000) }, // blows past emma's ceiling
  ]);
  const a4Close = new Date(day(-2).getTime() + 9 * 3_600_000);
  const order4 = await prisma.order.create({
    data: {
      auctionId: a4.id,
      userId: alice.id,
      kind: "AUCTION_WIN",
      status: "PAID",
      subtotalCents: 9500,
      gstCents: 475,
      pstCents: 665,
      totalCents: 10640,
      stripePaymentIntentId: "pi_seed_nocturne",
      chargeAttempts: 1,
      createdAt: a4Close,
      delivery: {
        create: {
          recipientName: "Jordan Marsh",
          businessName: "Books & Company",
          addressLine1: "1685 3rd Ave",
          postalCode: "V2L 3G5",
          window: "W12_15",
          giftNote: "No reason. Every reason. xo",
          anonymousSender: true,
          buyerPhone: "+12505550177",
          scheduledDate: day(-1),
          routePosition: 2,
          attemptCount: 1,
          deliveredAt: new Date(day(-1).getTime() + 13.5 * 3_600_000),
          deliveryPhotoUrl: photo("nocturne-delivered", 9),
          gpsLat: 53.9143,
          gpsLng: -122.7461,
        },
      },
    },
  });
  const a4Sched = new Date(a4Close.getTime() + 40 * 60_000);
  events.push(
    { auctionId: a4.id, type: "PROXY_CEILING_REACHED", actorType: "SYSTEM", actorId: emma.id, payload: { ceilingCents: 9000, outbidByCents: 9500 }, createdAt: new Date(day(-2).getTime() + 7 * 3_600_000) },
    { auctionId: a4.id, type: "CLOSED", fromStatus: "LIVE", toStatus: "CLOSED_WON", actorType: "SYSTEM", payload: { winningBidCents: 9500 }, createdAt: a4Close },
    { auctionId: a4.id, type: "ORDER_CREATED", fromStatus: "CLOSED_WON", toStatus: "PAYMENT_PENDING", actorType: "SYSTEM", payload: { orderId: order4.id }, createdAt: a4Close },
    { auctionId: a4.id, type: "CHARGE_SUCCEEDED", fromStatus: "PAYMENT_PENDING", toStatus: "PAID", actorType: "STRIPE", payload: { paymentIntentId: "pi_seed_nocturne", totalCents: 10640 }, createdAt: new Date(a4Close.getTime() + 45_000) },
    { auctionId: a4.id, type: "DELIVERY_SCHEDULED", fromStatus: "PAID", toStatus: "DELIVERY_SCHEDULED", actorType: "USER", actorId: alice.id, createdAt: a4Sched },
    { auctionId: a4.id, type: "ROUTE_STARTED", fromStatus: "DELIVERY_SCHEDULED", toStatus: "OUT_FOR_DELIVERY", actorType: "ADMIN", actorId: owner.id, createdAt: new Date(day(-1).getTime() + 12 * 3_600_000) },
    { auctionId: a4.id, type: "DELIVERED", fromStatus: "OUT_FOR_DELIVERY", toStatus: "DELIVERED", actorType: "ADMIN", actorId: owner.id, payload: { photoUrl: photo("nocturne-delivered", 9), gps: { lat: 53.9143, lng: -122.7461 } }, createdAt: new Date(day(-1).getTime() + 13.5 * 3_600_000) },
  );

  // --- 5. Wild Lupine — closed unsold, LAST_CHANCE open --------------------
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 0, 0);
  const a5 = await createAuction({
    id: "auc_lupine",
    slug: "wild-lupine",
    title: "Wild Lupine",
    description:
      "A loose, meadow-style bundle of lupine, yarrow, and grasses. Understated — for the minimalist who still deserves flowers.",
    status: "LAST_CHANCE",
    startPriceCents: 4000,
    scheduledStartAt: hr(-8),
    scheduledEndAt: hr(-1),
    lastChanceExpiresAt: endOfDay,
  });
  events.push(
    { auctionId: a5.id, type: "CLOSED_NO_BIDS", fromStatus: "LIVE", toStatus: "CLOSED_UNSOLD", actorType: "SYSTEM", createdAt: hr(-1) },
    { auctionId: a5.id, type: "LAST_CHANCE_OPENED", fromStatus: "CLOSED_UNSOLD", toStatus: "LAST_CHANCE", actorType: "SYSTEM", payload: { buyNowCents: 4000, expiresAt: endOfDay.toISOString() }, createdAt: hr(-1) },
  );

  // --- Flush the audit trail ----------------------------------------------
  events.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  await prisma.auctionEvent.createMany({ data: events });

  const counts = {
    users: await prisma.user.count(),
    auctions: await prisma.auction.count(),
    bids: await prisma.bid.count(),
    events: await prisma.auctionEvent.count(),
    orders: await prisma.order.count(),
  };
  console.log("Seeded:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
