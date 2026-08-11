import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensureStripeCustomer, stripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/** Create a SetupIntent so the client can save a card for off-session charges. */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const customerId = await ensureStripeCustomer(session.user.id);
  const intent = await stripe().setupIntents.create({
    customer: customerId,
    usage: "off_session", // we charge the winner's saved card at close
    payment_method_types: ["card"],
    metadata: { bloombidUserId: session.user.id },
  });

  return NextResponse.json({ clientSecret: intent.client_secret });
}
