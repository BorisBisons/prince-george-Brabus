import { DeliveryFailureReason, DeliveryWindow, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { transition, REDELIVERY_FEE_CENTS } from "@/lib/auction/state-machine";
import { queueNotification } from "@/lib/notifications";
import { vancouverParts } from "@/lib/time";
import { chargeRedeliveryFee } from "@/lib/payments";

/**
 * Delivery ops (spec §8). The owner is the driver; everything here is built
 * to be tapped from a phone between stops.
 */

// --- Address validation -----------------------------------------------------

/** Prince George delivery zone: V2K / V2L / V2M / V2N / V2P. Admin can override. */
export const PG_POSTAL_RE = /^V2[KLMNP]\s?\d[A-Z]\d$/i;

export function normalizePostal(raw: string): string {
  const compact = raw.toUpperCase().replace(/\s+/g, "");
  return `${compact.slice(0, 3)} ${compact.slice(3)}`.trim();
}

export function isDeliverablePostal(raw: string): boolean {
  return PG_POSTAL_RE.test(raw.trim());
}

/** Next business day (Mon–Fri) after `now`, Vancouver wall clock. */
export function nextBusinessDay(now: Date): Date {
  const { y, m, d } = vancouverParts(now);
  // Noon UTC keeps the calendar date stable across the UTC/PT offset.
  let candidate = new Date(Date.UTC(y, m - 1, d, 12));
  do {
    candidate = new Date(candidate.getTime() + 24 * 3600_000);
  } while ([0, 6].includes(candidate.getUTCDay()));
  return new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth(), candidate.getUTCDate()));
}

// --- Buyer form -------------------------------------------------------------

export interface DeliveryFormInput {
  recipientName: string;
  businessName: string;
  addressLine1: string;
  postalCode: string;
  window: DeliveryWindow;
  giftNote?: string;
  anonymousSender: boolean;
  buyerPhone: string;
}

export class DeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryError";
  }
}

/** Buyer submits the delivery form on a PAID order → DELIVERY_SCHEDULED. */
export async function scheduleDelivery(orderId: string, userId: string, form: DeliveryFormInput) {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { delivery: true, auction: { select: { id: true, status: true, title: true } } },
  });
  if (order.userId !== userId) throw new DeliveryError("Not your order.");
  if (order.status !== "PAID" || order.auction.status !== "PAID") {
    throw new DeliveryError("This order isn't ready for delivery details.");
  }
  if (order.delivery) throw new DeliveryError("Delivery details are already in.");

  if (!form.recipientName.trim() || !form.businessName.trim() || !form.addressLine1.trim()) {
    throw new DeliveryError("Recipient, workplace, and address are all needed.");
  }
  if (!isDeliverablePostal(form.postalCode)) {
    throw new DeliveryError(
      "That postal code is outside our Prince George delivery zone (V2K–V2P). If you think that's wrong, reply to your win email and we'll sort it.",
    );
  }
  if ((form.giftNote ?? "").length > 240) throw new DeliveryError("Gift notes max out at 240 characters.");
  if (!/^\+1\d{10}$/.test(form.buyerPhone.trim())) {
    throw new DeliveryError("We need a mobile number (+1 followed by 10 digits) for delivery-day hiccups.");
  }

  const scheduledDate = nextBusinessDay(new Date());
  await prisma.$transaction(async (tx) => {
    await tx.delivery.create({
      data: {
        orderId,
        recipientName: form.recipientName.trim(),
        businessName: form.businessName.trim(),
        addressLine1: form.addressLine1.trim(),
        postalCode: normalizePostal(form.postalCode),
        window: form.window,
        giftNote: form.giftNote?.trim() || null,
        anonymousSender: form.anonymousSender,
        buyerPhone: form.buyerPhone.trim(),
        scheduledDate,
      },
    });
    await transition(tx, {
      auctionId: order.auctionId,
      to: "DELIVERY_SCHEDULED",
      actorType: "USER",
      actorId: userId,
      payload: { orderId, scheduledDate: scheduledDate.toISOString(), window: form.window },
    });
  });

  await queueNotification({
    userId,
    event: "DELIVERY_SCHEDULED",
    dedupeKey: `DELIVERY_SCHEDULED:${orderId}`,
    payload: { orderId, title: order.auction.title },
  });
  return { scheduledDate };
}

// --- Run-sheet route ordering ----------------------------------------------

/**
 * Route order without a geocoder: nearest-neighbor over FSA centroids,
 * inside delivery-window groups (morning window first — windows beat
 * geometry, per how the day actually runs).
 */
const FSA_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  V2K: { lat: 53.958, lng: -122.768 }, // Hart / north
  V2L: { lat: 53.916, lng: -122.73 }, // downtown / east
  V2M: { lat: 53.912, lng: -122.79 }, // central-west
  V2N: { lat: 53.871, lng: -122.802 }, // south / university
  V2P: { lat: 53.9, lng: -122.76 },
};
const SHOP = { lat: 53.9171, lng: -122.7497 }; // downtown PG start point
const WINDOW_ORDER: DeliveryWindow[] = ["W10_12", "W12_15", "W15_17"];

interface Stop {
  id: string;
  postalCode: string;
  window: DeliveryWindow;
  addressLine1: string;
}

export function orderStops(stops: Stop[]): string[] {
  const ordered: string[] = [];
  let position = SHOP;
  for (const window of WINDOW_ORDER) {
    const group = stops.filter((s) => s.window === window);
    const remaining = [...group].sort((a, b) => a.addressLine1.localeCompare(b.addressLine1));
    while (remaining.length > 0) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const c = FSA_CENTROIDS[remaining[i]!.postalCode.slice(0, 3)] ?? SHOP;
        const dist = (c.lat - position.lat) ** 2 + (c.lng - position.lng) ** 2;
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = i;
        }
      }
      const [next] = remaining.splice(bestIdx, 1);
      ordered.push(next!.id);
      position = FSA_CENTROIDS[next!.postalCode.slice(0, 3)] ?? SHOP;
    }
  }
  return ordered;
}

/** Recompute + persist routePosition for a given local date. */
export async function assignRoute(date: Date): Promise<number> {
  const deliveries = await prisma.delivery.findMany({
    where: { scheduledDate: date, deliveredAt: null, failureReason: null },
    select: { id: true, postalCode: true, window: true, addressLine1: true },
  });
  const ordered = orderStops(deliveries);
  for (let i = 0; i < ordered.length; i++) {
    await prisma.delivery.update({ where: { id: ordered[i]! }, data: { routePosition: i + 1 } });
  }
  return ordered.length;
}

// --- Driver ops -------------------------------------------------------------

async function deliveryWithOrder(deliveryId: string) {
  return prisma.delivery.findUniqueOrThrow({
    where: { id: deliveryId },
    include: { order: { include: { auction: { select: { id: true, title: true, status: true } } } } },
  });
}

/** Driver taps "start route": every scheduled stop today → OUT_FOR_DELIVERY. */
export async function startRoute(adminId: string, date: Date): Promise<number> {
  const deliveries = await prisma.delivery.findMany({
    where: { scheduledDate: date, deliveredAt: null },
    include: { order: { select: { userId: true, auctionId: true, auction: { select: { status: true, title: true } } } } },
  });
  let started = 0;
  for (const d of deliveries) {
    if (d.order.auction.status !== "DELIVERY_SCHEDULED") continue;
    await prisma.$transaction((tx) =>
      transition(tx, {
        auctionId: d.order.auctionId,
        to: "OUT_FOR_DELIVERY",
        actorType: "ADMIN",
        actorId: adminId,
        payload: { deliveryId: d.id },
      }),
    );
    await queueNotification({
      userId: d.order.userId,
      event: "OUT_FOR_DELIVERY",
      dedupeKey: `OUT_FOR_DELIVERY:${d.orderId}:${d.attemptCount}`,
      payload: { orderId: d.orderId, title: d.order.auction.title },
    });
    started++;
  }
  return started;
}

/** Delivered: photo is mandatory (dispute evidence: photo + timestamp + GPS). */
export async function completeDelivery(
  deliveryId: string,
  adminId: string,
  proof: { photoUrl: string; gpsLat?: number; gpsLng?: number },
) {
  if (!proof.photoUrl) throw new DeliveryError("Photo required — it's the proof and the dispute evidence.");
  const d = await deliveryWithOrder(deliveryId);
  const deliveredAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.delivery.update({
      where: { id: deliveryId },
      data: {
        deliveredAt,
        deliveryPhotoUrl: proof.photoUrl,
        gpsLat: proof.gpsLat,
        gpsLng: proof.gpsLng,
        attemptCount: { increment: 1 },
      },
    });
    await transition(tx, {
      auctionId: d.order.auctionId,
      to: "DELIVERED",
      actorType: "ADMIN",
      actorId: adminId,
      payload: { deliveryId, photoUrl: proof.photoUrl, gps: { lat: proof.gpsLat, lng: proof.gpsLng }, deliveredAt: deliveredAt.toISOString() },
    });
  });

  await queueNotification({
    userId: d.order.userId,
    event: "DELIVERED",
    dedupeKey: `DELIVERED:${d.orderId}`,
    payload: { orderId: d.orderId, title: d.order.auction.title, photoUrl: proof.photoUrl },
  });
}

/** Failed: reason + photo + note; buyer gets the two-option resolution link. */
export async function failDelivery(
  deliveryId: string,
  adminId: string,
  details: { reason: DeliveryFailureReason; note: string; photoUrl?: string },
) {
  const d = await deliveryWithOrder(deliveryId);
  await prisma.$transaction(async (tx) => {
    await tx.delivery.update({
      where: { id: deliveryId },
      data: {
        failureReason: details.reason,
        failureNote: details.note,
        failurePhotoUrl: details.photoUrl,
        attemptCount: { increment: 1 },
        ...(details.reason === "RECIPIENT_REFUSED" ? { resolution: "RETURNED_DONATED" } : {}),
      },
    });
    await transition(tx, {
      auctionId: d.order.auctionId,
      to: "DELIVERY_FAILED",
      actorType: "ADMIN",
      actorId: adminId,
      payload: { deliveryId, reason: details.reason, note: details.note, photoUrl: details.photoUrl },
    });
  });
  await queueNotification({
    userId: d.order.userId,
    event: "DELIVERY_FAILED",
    dedupeKey: `DELIVERY_FAILED:${d.orderId}:${d.attemptCount + 1}`,
    payload: { orderId: d.orderId, title: d.order.auction.title, reason: details.reason },
  });
}

/**
 * Buyer resolution after a buyer-fault failure:
 *  - redelivery: +$10 charged to the saved card, next business day
 *  - pickup: same day at the shop; admin marks handoff → DELIVERED
 */
export async function resolveFailedDelivery(
  orderId: string,
  userId: string,
  choice: "redelivery" | "pickup",
): Promise<{ ok: boolean; message: string }> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { delivery: true, auction: { select: { id: true, status: true, title: true } } },
  });
  if (order.userId !== userId) return { ok: false, message: "Not your order." };
  if (order.auction.status !== "DELIVERY_FAILED" || !order.delivery) {
    return { ok: false, message: "There's nothing to resolve on this order." };
  }
  if (order.delivery.resolution) return { ok: false, message: "Already resolved — check your email for details." };

  if (choice === "pickup") {
    await prisma.delivery.update({ where: { id: order.delivery.id }, data: { resolution: "PICKUP" } });
    await prisma.auctionEvent.create({
      data: {
        auctionId: order.auctionId,
        type: "RESOLUTION_PICKUP_CHOSEN",
        actorType: "USER",
        actorId: userId,
        payload: { orderId },
      },
    });
    return { ok: true, message: "Pickup it is — swing by today and we'll hand them over (we'll mark it done then)." };
  }

  // Redelivery: charge the $10 fee first; a decline keeps options open.
  const charged = await chargeRedeliveryFee(orderId);
  if (!charged) {
    return { ok: false, message: "The $10 redelivery fee didn't go through — update your card and try again." };
  }
  const newDate = nextBusinessDay(new Date());
  await prisma.$transaction(async (tx) => {
    await tx.delivery.update({
      where: { id: order.delivery!.id },
      data: {
        resolution: "REDELIVERY",
        redeliveryFeeCents: REDELIVERY_FEE_CENTS,
        scheduledDate: newDate,
        failureReason: null,
        failureNote: null,
        failurePhotoUrl: null,
        routePosition: null,
      },
    });
    await transition(tx, {
      auctionId: order.auctionId,
      to: "RESOLVED_REDELIVERY",
      actorType: "USER",
      actorId: userId,
      payload: { orderId, feeCents: REDELIVERY_FEE_CENTS, newDate: newDate.toISOString() },
    });
    await transition(tx, {
      auctionId: order.auctionId,
      to: "DELIVERY_SCHEDULED",
      actorType: "SYSTEM",
      payload: { orderId, redelivery: true },
    });
  });
  await queueNotification({
    userId,
    event: "DELIVERY_SCHEDULED",
    dedupeKey: `DELIVERY_SCHEDULED:${orderId}:redelivery`,
    payload: { orderId, title: order.auction.title },
  });
  return { ok: true, message: "Rescheduled for the next business day — $10 fee charged to your card." };
}

/** Admin marks a chosen-pickup order as handed over → DELIVERED. */
export async function completePickup(deliveryId: string, adminId: string, photoUrl?: string) {
  const d = await deliveryWithOrder(deliveryId);
  if (d.resolution !== "PICKUP") throw new DeliveryError("This one isn't marked for pickup.");
  const deliveredAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.delivery.update({
      where: { id: deliveryId },
      data: { deliveredAt, deliveryPhotoUrl: photoUrl ?? d.failurePhotoUrl },
    });
    await transition(tx, {
      auctionId: d.order.auctionId,
      to: "DELIVERED",
      actorType: "ADMIN",
      actorId: adminId,
      payload: { deliveryId, pickup: true, deliveredAt: deliveredAt.toISOString() },
    });
  });
  await queueNotification({
    userId: d.order.userId,
    event: "DELIVERED",
    dedupeKey: `DELIVERED:${d.orderId}`,
    payload: { orderId: d.orderId, title: d.order.auction.title, photoUrl },
  });
}

/** Today (local) as the date-only value scheduledDate rows use. */
export function todayInVancouver(now = new Date()): Date {
  const { y, m, d } = vancouverParts(now);
  return new Date(Date.UTC(y, m - 1, d));
}
