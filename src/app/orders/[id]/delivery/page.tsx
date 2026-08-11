import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { scheduleDelivery, DeliveryError } from "@/lib/delivery";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCad } from "@/lib/utils";

export const metadata = { title: "Delivery details" };
export const dynamic = "force-dynamic";

const WINDOWS = [
  ["W10_12", "10 AM – 12 PM"],
  ["W12_15", "12 PM – 3 PM"],
  ["W15_17", "3 PM – 5 PM"],
] as const;

export default async function DeliveryFormPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { error?: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    include: { auction: { select: { title: true, status: true } }, delivery: true },
  });
  if (!order || order.userId !== session.user.id) notFound();
  if (order.delivery) redirect("/my-orders");

  async function submit(formData: FormData) {
    "use server";
    const s = await auth();
    if (!s?.user?.id) redirect("/signin");
    try {
      await scheduleDelivery(params.id, s.user.id, {
        recipientName: String(formData.get("recipientName") ?? ""),
        businessName: String(formData.get("businessName") ?? ""),
        addressLine1: String(formData.get("addressLine1") ?? ""),
        postalCode: String(formData.get("postalCode") ?? ""),
        window: (formData.get("window") ?? "W10_12") as "W10_12" | "W12_15" | "W15_17",
        giftNote: String(formData.get("giftNote") ?? ""),
        anonymousSender: formData.get("anonymousSender") === "on",
        buyerPhone: String(formData.get("buyerPhone") ?? ""),
      });
    } catch (e) {
      if (e instanceof DeliveryError) {
        redirect(`/orders/${params.id}/delivery?error=${encodeURIComponent(e.message)}`);
      }
      throw e;
    }
    redirect("/my-orders?scheduled=1");
  }

  return (
    <div className="mx-auto max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Where do they work?</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-6 text-[15px] text-charcoal/70">
            <span className="font-semibold">{order.auction.title}</span> ({formatCad(order.totalCents)},
            paid) is prepped and ready. Tell us where to take it — next business day, hand-delivered.
          </p>
          {searchParams.error && (
            <p role="alert" className="mb-4 rounded bg-rose-wash px-4 py-3 text-sm">
              {searchParams.error}
            </p>
          )}
          <form action={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="recipientName">Recipient&apos;s name</Label>
              <Input id="recipientName" name="recipientName" required maxLength={80} placeholder="Priya Okafor" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="businessName">Workplace / business name</Label>
              <Input id="businessName" name="businessName" required maxLength={120} placeholder="Northern Health — Suite 300" />
            </div>
            <div className="grid grid-cols-[2fr_1fr] gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="addressLine1">Street address (Prince George)</Label>
                <Input id="addressLine1" name="addressLine1" required maxLength={120} placeholder="1488 4th Ave" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="postalCode">Postal code</Label>
                <Input id="postalCode" name="postalCode" required placeholder="V2L 4Y2" />
              </div>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-forest">Delivery window</legend>
              <div className="flex gap-2">
                {WINDOWS.map(([value, label], i) => (
                  <label
                    key={value}
                    className="flex-1 cursor-pointer rounded border border-forest/20 px-3 py-2.5 text-center text-sm has-[:checked]:border-forest has-[:checked]:bg-forest has-[:checked]:text-cream"
                  >
                    <input type="radio" name="window" value={value} defaultChecked={i === 0} className="sr-only" />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="space-y-1.5">
              <Label htmlFor="giftNote">Gift note (printed on a card, 240 chars)</Label>
              <textarea
                id="giftNote"
                name="giftNote"
                maxLength={240}
                rows={3}
                placeholder="Say the thing you'd never say out loud."
                className="flex w-full rounded border border-forest/20 bg-white px-4 py-2.5 text-[15px] placeholder:text-charcoal/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest"
              />
            </div>
            <label className="flex items-center gap-2.5 text-[15px]">
              <input type="checkbox" name="anonymousSender" className="h-4 w-4 accent-[#1E3A2F]" />
              Keep me anonymous (no &ldquo;sent via BloomBid&rdquo; on the card)
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="buyerPhone">Your mobile (driver-only, for delivery hiccups)</Label>
              <Input id="buyerPhone" name="buyerPhone" type="tel" required placeholder="+12505551234" />
            </div>
            <Button type="submit" variant="cta" size="lg" className="w-full">
              Schedule delivery
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
