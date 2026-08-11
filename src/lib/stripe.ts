import Stripe from "stripe";
import { prisma } from "@/lib/db";

let _stripe: Stripe | null = null;

/** Lazy so builds/tests don't need a key at module-eval time. */
export function stripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    _stripe = new Stripe(key, { typescript: true });
  }
  return _stripe;
}

/** Get-or-create the Stripe customer for a user, persisting the id. */
export async function ensureStripeCustomer(userId: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, email: true, name: true, stripeCustomerId: true },
  });
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe().customers.create({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { bloombidUserId: user.id },
  });

  // Guard against a concurrent create: keep whichever id won the DB race.
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customer.id },
    select: { stripeCustomerId: true },
  });
  return updated.stripeCustomerId ?? customer.id;
}
