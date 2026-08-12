import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { transition } from "@/lib/auction/state-machine";
import { adminRefund, goodwillCredit, ourFaultRefund } from "@/lib/payments";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCad } from "@/lib/utils";

export const metadata = { title: "Orders board" };
export const dynamic = "force-dynamic";

const COLUMNS: Array<{ status: string; title: string }> = [
  { status: "PAID", title: "Paid — awaiting details" },
  { status: "DELIVERY_SCHEDULED", title: "Scheduled" },
  { status: "OUT_FOR_DELIVERY", title: "Out for delivery" },
  { status: "DELIVERY_FAILED", title: "Failed / resolving" },
  { status: "DELIVERED", title: "Delivered" },
];

/** Kanban by delivery state; tap to advance (drag is a flourish, taps work in gloves). */
export default async function OrdersBoardPage() {
  await requireAdmin();
  const orders = await prisma.order.findMany({
    where: {
      status: { in: ["PAID", "PARTIALLY_REFUNDED"] },
      auction: { status: { in: COLUMNS.map((c) => c.status) as never } },
    },
    orderBy: { createdAt: "desc" },
    include: {
      auction: { select: { id: true, title: true, status: true } },
      user: { select: { name: true, email: true } },
      delivery: { select: { window: true, recipientName: true, resolution: true, scheduledDate: true } },
      refunds: { select: { amountCents: true } },
    },
    take: 100,
  });

  async function advance(formData: FormData) {
    "use server";
    const admin = await requireAdmin();
    const auctionId = String(formData.get("auctionId") ?? "");
    const to = String(formData.get("to") ?? "");
    if (!["OUT_FOR_DELIVERY"].includes(to)) return; // photo-gated moves happen on the run sheet
    await prisma.$transaction((tx) =>
      transition(tx, { auctionId, to: to as "OUT_FOR_DELIVERY", actorType: "ADMIN", actorId: admin.id }),
    );
    revalidatePath("/admin/orders");
  }

  async function goodwill(formData: FormData) {
    "use server";
    const admin = await requireAdmin();
    await goodwillCredit(String(formData.get("orderId") ?? ""), admin.id);
    revalidatePath("/admin/orders");
  }

  async function ourFault(formData: FormData) {
    "use server";
    const admin = await requireAdmin();
    const orderId = String(formData.get("orderId") ?? "");
    const auctionId = String(formData.get("auctionId") ?? "");
    await ourFaultRefund(orderId, admin.id);
    await prisma.$transaction((tx) =>
      transition(tx, { auctionId, to: "RESOLVED_REFUND", actorType: "ADMIN", actorId: admin.id, payload: { orderId } }),
    );
    revalidatePath("/admin/orders");
  }

  async function partialRefund(formData: FormData) {
    "use server";
    const admin = await requireAdmin();
    const orderId = String(formData.get("orderId") ?? "");
    const dollars = Number.parseFloat(String(formData.get("amount") ?? "0"));
    if (!Number.isFinite(dollars) || dollars <= 0) return;
    await adminRefund({
      orderId,
      adminId: admin.id,
      amountCents: Math.round(dollars * 100),
      reasonCode: "ADMIN_PARTIAL",
      note: String(formData.get("note") ?? "") || undefined,
    });
    revalidatePath("/admin/orders");
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl text-forest">Orders board</h1>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((col) => {
          const cards = orders.filter((o) => o.auction.status === col.status);
          return (
            <div key={col.status} className="w-72 shrink-0 space-y-3">
              <p className="font-display text-forest">
                {col.title} <span className="nums text-sm text-charcoal/50">({cards.length})</span>
              </p>
              {cards.map((o) => (
                <div key={o.id} className="rounded-card bg-white p-4 shadow-lift">
                  <p className="font-medium text-forest">{o.auction.title}</p>
                  <p className="text-sm text-charcoal/60">{o.user.name ?? o.user.email}</p>
                  <p className="nums mt-1 text-sm">
                    {formatCad(o.totalCents)}
                    {o.refunds.length > 0 && (
                      <span className="text-charcoal/50">
                        {" "}
                        · {formatCad(o.refunds.reduce((s, r) => s + r.amountCents, 0))} refunded
                      </span>
                    )}
                  </p>
                  {o.delivery && (
                    <p className="mt-1 text-xs text-charcoal/50">
                      → {o.delivery.recipientName}
                      {o.delivery.resolution && <Badge variant="rose">{o.delivery.resolution.toLowerCase()}</Badge>}
                    </p>
                  )}

                  <div className="mt-3 space-y-2">
                    {col.status === "DELIVERY_SCHEDULED" && (
                      <form action={advance}>
                        <input type="hidden" name="auctionId" value={o.auction.id} />
                        <input type="hidden" name="to" value="OUT_FOR_DELIVERY" />
                        <Button size="sm" variant="outline" className="w-full">
                          Advance → out for delivery
                        </Button>
                      </form>
                    )}
                    {col.status === "DELIVERY_FAILED" && (
                      <form action={ourFault}>
                        <input type="hidden" name="orderId" value={o.id} />
                        <input type="hidden" name="auctionId" value={o.auction.id} />
                        <Button size="sm" variant="destructive" className="w-full">
                          Our fault: refund + $10 credit
                        </Button>
                      </form>
                    )}
                    {["DELIVERY_SCHEDULED", "OUT_FOR_DELIVERY", "DELIVERY_FAILED"].includes(col.status) && (
                      <form action={goodwill}>
                        <input type="hidden" name="orderId" value={o.id} />
                        <Button size="sm" variant="ghost" className="w-full">
                          Goodwill 50% credit
                        </Button>
                      </form>
                    )}
                    <details className="text-xs">
                      <summary className="cursor-pointer text-charcoal/50">Refund…</summary>
                      <form action={partialRefund} className="mt-2 space-y-1.5">
                        <input type="hidden" name="orderId" value={o.id} />
                        <input
                          name="amount"
                          inputMode="decimal"
                          placeholder="Amount (CAD)"
                          className="h-9 w-full rounded border border-forest/20 px-2.5"
                        />
                        <input
                          name="note"
                          placeholder="Reason note"
                          className="h-9 w-full rounded border border-forest/20 px-2.5"
                        />
                        <Button size="sm" variant="outline" className="w-full">
                          Issue refund
                        </Button>
                      </form>
                    </details>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
