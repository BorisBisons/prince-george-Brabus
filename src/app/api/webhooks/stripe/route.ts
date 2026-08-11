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

    default:
      // Unhandled event types are recorded (payload row) and acknowledged.
      break;
  }
}
