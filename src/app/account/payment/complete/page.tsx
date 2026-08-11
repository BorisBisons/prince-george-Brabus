import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { upsertCardSnapshot } from "@/lib/payment-methods";

export const dynamic = "force-dynamic";

/**
 * SetupIntent return_url landing. Syncs the card snapshot immediately instead
 * of waiting on the webhook (which also runs — both paths upsert, so the race
 * is harmless), then bounces back to the account page.
 */
export default async function PaymentCompletePage({
  searchParams,
}: {
  searchParams: { setup_intent?: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const intentId = searchParams.setup_intent;
  if (!intentId) redirect("/account");

  const intent = await stripe().setupIntents.retrieve(intentId, {
    expand: ["payment_method"],
  });

  // Only sync a card that belongs to this signed-in user's customer.
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: session.user.id },
    select: { stripeCustomerId: true },
  });
  const intentCustomer = typeof intent.customer === "string" ? intent.customer : intent.customer?.id;

  if (
    intent.status === "succeeded" &&
    intentCustomer &&
    intentCustomer === user.stripeCustomerId &&
    intent.payment_method &&
    typeof intent.payment_method !== "string"
  ) {
    await upsertCardSnapshot(session.user.id, intent.payment_method, { makeDefault: true });
    redirect("/account?card=saved");
  }

  redirect("/account?card=failed");
}
