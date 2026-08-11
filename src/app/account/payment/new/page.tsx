import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddCardForm } from "@/components/add-card-form";

export const metadata = { title: "Add a card" };

export default async function AddCardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Add a card</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-6 text-[15px] text-charcoal/70">
            Saved securely with Stripe — we never see the number. You&apos;re
            only charged when you win an auction.
          </p>
          <AddCardForm />
        </CardContent>
      </Card>
    </div>
  );
}
