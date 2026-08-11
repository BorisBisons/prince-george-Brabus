import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { upsertCardSnapshot } from "@/lib/payment-methods";

export const dynamic = "force-dynamic";

/**
 * Stripe webhook receiver. Signature-verified, and idempotent via the
 * StripeWebhookEvent table: the unique insert on stripeEventId is the lock —
 * duplicates and out-of-order retries become no-ops (spec §11).
 *
 * Payment-side events (payment_intent.*) get their handlers in step 4;
 * this step covers card lifecycle.
 */
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });

  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(await req.text(), signature, secret);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Idempotency gate
  let row;
  try {
    row = await prisma.stripeWebhookEvent.create({
      data: { stripeEventId: event.id, type: event.type, payload: event as unknown as Prisma.InputJsonValue },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    throw e;
  }

  try {
    await handleEvent(event);
    await prisma.stripeWebhookEvent.update({
      where: { id: row.id },
      data: { processedAt: new Date() },
    });
  } catch (e) {
    await prisma.stripeWebhookEvent.update({
      where: { id: row.id },
      data: { error: e instanceof Error ? e.message : String(e) },
    });
    // 500 so Stripe retries; the dedupe row has no processedAt, and the
    // retry path below re-processes unfinished rows.
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function handleEvent(event: Stripe.Event) {
  switch (event.type) {
    case "setup_intent.succeeded": {
      const intent = event.data.object;
      const userId = intent.metadata?.bloombidUserId;
      if (!userId) return;
      const pmId = typeof intent.payment_method === "string" ? intent.payment_method : intent.payment_method?.id;
      if (!pmId) return;
      const pm = await stripe().paymentMethods.retrieve(pmId);
      // First saved card becomes the default automatically.
      const hasDefault = await prisma.paymentMethod.count({ where: { userId, isDefault: true } });
      await upsertCardSnapshot(userId, pm, { makeDefault: hasDefault === 0 });
      break;
    }

    case "payment_method.updated":
    case "payment_method.automatically_updated": {
      // Card networks push expiry/number refreshes — resync the snapshot and
      // recompute status (this is how "card expires before close" is detected).
      const pm = event.data.object;
      const existing = await prisma.paymentMethod.findUnique({
        where: { stripePaymentMethodId: pm.id },
        select: { userId: true },
      });
      if (existing) await upsertCardSnapshot(existing.userId, pm);
      break;
    }

    case "payment_method.detached": {
      const pm = event.data.object;
      await prisma.paymentMethod.deleteMany({ where: { stripePaymentMethodId: pm.id } });
      break;
    }

    // Belt-and-braces for async charge outcomes: the synchronous path in
    // lib/payments handles most; these settle webhook-delivered results.
    case "payment_intent.succeeded": {
      const intent = event.data.object;
      const orderId = intent.metadata?.orderId;
      if (!orderId) return;
      const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
      if (order?.status === "PENDING_CHARGE") {
        const { markOrderPaidFromWebhook } = await import("@/lib/payments");
        await markOrderPaidFromWebhook(orderId, intent.id);
      }
      break;
    }

    // Dispute: attach delivery photo + timestamp + GPS as evidence (spec §6).
    case "charge.dispute.created": {
      const dispute = event.data.object;
      const piId = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id;
      if (!piId) return;
      const order = await prisma.order.findUnique({
        where: { stripePaymentIntentId: piId },
        include: { delivery: true, auction: { select: { title: true } } },
      });
      if (!order) return;
      const d = order.delivery;
      const evidenceText = d?.deliveredAt
        ? `Hand-delivered "${order.auction.title}" to ${d.recipientName} at ${d.businessName}, ${d.addressLine1}, ${d.city} ${d.postalCode} on ${d.deliveredAt.toISOString()}. GPS at handoff: ${d.gpsLat}, ${d.gpsLng}. Delivery photo: ${d.deliveryPhotoUrl}. Buyer placed winning bid; bids are binding per Terms.`
        : `Order ${order.id} for auction "${order.auction.title}". Bids are binding per Terms.`;
      await stripe().disputes.update(dispute.id, {
        evidence: { uncategorized_text: evidenceText, product_description: order.auction.title },
      });
      break;
    }

    default:
      // Unhandled event types are recorded (payload row) and acknowledged.
      break;
  }
}
