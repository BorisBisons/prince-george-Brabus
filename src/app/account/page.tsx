import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getEligibility } from "@/lib/bidding-eligibility";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteCard, makeCardDefault, updateProfile } from "./actions";

export const metadata = { title: "Account" };

const CARD_STATUS_LABEL: Record<string, string> = {
  VALID: "",
  EXPIRING_SOON: "expiring soon",
  EXPIRED: "expired",
  INVALID: "needs replacing",
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: { card?: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const [user, eligibility] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.user.id },
      include: { paymentMethods: { orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] } },
    }),
    getEligibility(session.user.id),
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="font-display text-4xl text-forest">Your account</h1>

      {searchParams.card === "saved" && (
        <div role="status" className="rounded bg-rose-wash px-4 py-3 text-[15px]">
          Card saved — you&apos;re one step closer to the good stuff. 🌷
        </div>
      )}

      {/* Bidding readiness */}
      <Card>
        <CardHeader>
          <CardTitle>Ready to bid?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ChecklistRow done={eligibility.emailVerified} label="Email verified" doneNote={user.email} />
          <ChecklistRow
            done={eligibility.hasUsableCard}
            label="A valid card on file"
            doneNote="charged only if you win"
          />
          {eligibility.suspended && (
            <p className="rounded bg-rose-wash px-4 py-3 text-sm">
              Bidding is paused on your account after repeated payment issues.
              Save a fresh card and we&apos;ll take another look.
            </p>
          )}
          {eligibility.ok ? (
            <p className="pt-1 text-[15px] text-forest">
              All set. When the next drop lands, you can bid the moment you see it.
            </p>
          ) : (
            !eligibility.hasUsableCard && (
              <p className="pt-1 text-[15px] text-charcoal/70">
                Bids are binding, so we ask for a card up front — it&apos;s only
                ever charged when you win.
              </p>
            )
          )}
        </CardContent>
      </Card>

      {/* Payment methods */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Payment methods</CardTitle>
          <Link href="/account/payment/new">
            <Button size="sm" variant="cta">
              Add a card
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          {user.paymentMethods.length === 0 ? (
            <p className="py-4 text-[15px] text-charcoal/60">
              No cards yet. Add one and you&apos;re bid-ready in under a minute.
            </p>
          ) : (
            <ul className="divide-y divide-forest/10">
              {user.paymentMethods.map((pm) => (
                <li key={pm.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex items-center gap-3">
                    <span className="font-medium capitalize">{pm.brand}</span>
                    <span className="nums text-charcoal/70">•••• {pm.last4}</span>
                    <span className="nums text-sm text-charcoal/50">
                      {String(pm.expMonth).padStart(2, "0")}/{pm.expYear % 100}
                    </span>
                    {pm.isDefault && <Badge variant="forest">default</Badge>}
                    {CARD_STATUS_LABEL[pm.status] && (
                      <Badge variant="rose">{CARD_STATUS_LABEL[pm.status]}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!pm.isDefault && (
                      <form action={makeCardDefault}>
                        <input type="hidden" name="paymentMethodId" value={pm.id} />
                        <Button size="sm" variant="ghost">
                          Make default
                        </Button>
                      </form>
                    )}
                    <form action={deleteCard}>
                      <input type="hidden" name="paymentMethodId" value={pm.id} />
                      <Button size="sm" variant="destructive">
                        Remove
                      </Button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updateProfile} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" defaultValue={user.name ?? ""} placeholder="Your name" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Mobile (for delivery-day texts, optional)</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                defaultValue={user.phone ?? ""}
                placeholder="+12505551234"
              />
            </div>
            <Button type="submit">Save changes</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function ChecklistRow({ done, label, doneNote }: { done: boolean; label: string; doneNote?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className={`grid h-6 w-6 place-items-center rounded-full text-sm ${
          done ? "bg-forest text-cream" : "bg-charcoal/10 text-charcoal/40"
        }`}
      >
        {done ? "✓" : "·"}
      </span>
      <span className="text-[15px]">
        {label}
        {done && doneNote && <span className="ml-2 text-sm text-charcoal/50">{doneNote}</span>}
      </span>
    </div>
  );
}
