import { prisma } from "@/lib/db";
import { todayInVancouver } from "@/lib/delivery";
import { RunSheetView } from "@/components/run-sheet-view";
import type { StopData } from "@/components/run-sheet-card";

export const metadata = { title: "Run sheet" };
export const dynamic = "force-dynamic";

export default async function RunSheetPage() {
  const today = todayInVancouver();
  const deliveries = await prisma.delivery.findMany({
    where: { scheduledDate: today, deliveredAt: null },
    orderBy: [{ routePosition: "asc" }, { window: "asc" }],
    include: { order: { include: { auction: { select: { status: true, title: true } } } } },
  });

  // Failed stops waiting on the buyer's choice aren't drivable — hide them;
  // pickup-resolved ones stay visible (handoff happens at the shop).
  const drivable = deliveries.filter(
    (d) => d.order.auction.status !== "DELIVERY_FAILED" || d.resolution === "PICKUP",
  );

  const stops: StopData[] = drivable.map((d) => ({
    deliveryId: d.id,
    routePosition: d.routePosition,
    recipientName: d.recipientName,
    businessName: d.businessName,
    addressLine1: d.addressLine1,
    postalCode: d.postalCode,
    window: d.window,
    giftNote: d.giftNote,
    buyerPhone: d.buyerPhone,
    attemptCount: d.attemptCount,
    isPickup: d.resolution === "PICKUP",
    outForDelivery: d.order.auction.status === "OUT_FOR_DELIVERY",
  }));

  const routeStarted = stops.some((s) => s.outForDelivery);

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="font-display text-3xl text-forest">
        Run sheet ·{" "}
        <span className="nums">
          {today.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" })}
        </span>
      </h1>
      <RunSheetView stops={stops} routeStarted={routeStarted} />
    </div>
  );
}
