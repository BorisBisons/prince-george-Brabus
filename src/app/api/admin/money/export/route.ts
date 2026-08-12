import { adminIdOrNull } from "@/lib/admin";
import { prisma } from "@/lib/db";
import { vancouverParts, zonedTimeInVancouver } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Bookkeeping CSV: one row per charged order, refunds folded in. */
export async function GET() {
  const adminId = await adminIdOrNull();
  if (!adminId) return new Response("Admin only", { status: 403 });

  const now = new Date();
  const { y, m } = vancouverParts(now);
  const start = zonedTimeInVancouver(y, m, 1, 0, 0);

  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: start }, stripePaymentIntentId: { not: null } },
    orderBy: { createdAt: "asc" },
    include: {
      auction: { select: { title: true } },
      user: { select: { email: true } },
      refunds: { select: { amountCents: true, reasonCode: true } },
    },
  });

  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = [
    "date,order_id,auction,buyer,kind,status,subtotal,gst,pst,total,refunded,refund_reasons,payment_intent",
    ...orders.map((o) => {
      const refunded = o.refunds.reduce((s, r) => s + r.amountCents, 0);
      return [
        o.createdAt.toISOString().slice(0, 10),
        o.id,
        esc(o.auction.title),
        esc(o.user.email),
        o.kind,
        o.status,
        (o.subtotalCents / 100).toFixed(2),
        (o.gstCents / 100).toFixed(2),
        (o.pstCents / 100).toFixed(2),
        (o.totalCents / 100).toFixed(2),
        (refunded / 100).toFixed(2),
        esc(o.refunds.map((r) => r.reasonCode).join(";")),
        o.stripePaymentIntentId ?? "",
      ].join(",");
    }),
  ].join("\n");

  return new Response(rows, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bloombid-money-${y}-${String(m).padStart(2, "0")}.csv"`,
    },
  });
}
