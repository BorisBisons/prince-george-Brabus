import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CANCEL_WINDOW_MS } from "@/lib/auction/state-machine";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCad } from "@/lib/utils";
import { answerOffer, cancelOrder } from "./actions";

export const metadata = { title: "My orders" };
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, { label: string; variant: "forest" | "rose" | "neutral" | "winning" }> = {
  PENDING_CHARGE: { label: "Payment processing", variant: "neutral" },
  OFFERED: { label: "Offer for you!", variant: "winning" },
  PAID: { label: "Paid", variant: "forest" },
  FAILED: { label: "Payment failed", variant: "rose" },
  CANCELLED: { label: "Cancelled", variant: "neutral" },
  REFUNDED: { label: "Refunded", variant: "neutral" },
  PARTIALLY_REFUNDED: { label: "Partially refunded", variant: "neutral" },
};

const AUCTION_STATUS_LINE: Record<string, string> = {
  PAID: "Next: tell us where they work — delivery form arrives with the delivery flow.",
  DELIVERY_SCHEDULED: "Delivery scheduled.",
  OUT_FOR_DELIVERY: "Out for delivery — flowers in motion.",
  DELIVERED: "Delivered. 🌸",
  DELIVERY_FAILED: "Delivery hit a snag — check your email for options.",
};

export default async function MyOrdersPage({
  searchParams,
}: {
  searchParams: { bought?: string };
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");

  const orders = await prisma.order.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      auction: {
        select: { slug: true, title: true, status: true, photos: { orderBy: { position: "asc" }, take: 1 } },
      },
      delivery: { select: { id: true } },
      refunds: { select: { amountCents: true } },
    },
  });

  const credits = await prisma.credit.findMany({
    where: { userId: session.user.id, consumedByOrderId: null },
    select: { amountCents: true, reason: true },
  });
  const creditTotal = credits.reduce((sum, c) => sum + c.amountCents, 0);

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="font-display text-4xl text-forest">My orders</h1>

      {searchParams.bought === "1" && (
        <p role="status" className="rounded bg-rose-wash px-4 py-3 text-[15px]">
          It&apos;s yours! Receipt is on its way — delivery details come next. 🌷
        </p>
      )}
      {creditTotal > 0 && (
        <p className="rounded bg-forest/5 px-4 py-3 text-[15px]">
          You have <span className="nums font-semibold">{formatCad(creditTotal)}</span> in credit —
          it&apos;ll apply to a future win automatically.
        </p>
      )}

      {orders.length === 0 ? (
        <p className="text-charcoal/60">
          No orders yet — <Link href="/" className="underline">today&apos;s drop</Link> is the fastest fix for that.
        </p>
      ) : (
        <ul className="space-y-4">
          {orders.map((o) => {
            const badge = STATUS_LABEL[o.status] ?? { label: o.status, variant: "neutral" as const };
            const cancellable =
              o.status === "PAID" &&
              !o.delivery &&
              Date.now() - o.createdAt.getTime() <= CANCEL_WINDOW_MS;
            const refunded = o.refunds.reduce((s, r) => s + r.amountCents, 0);
            return (
              <li key={o.id} className="rounded-card bg-white p-5 shadow-lift">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Link href={`/auctions/${o.auction.slug}`} className="font-display text-xl text-forest hover:underline">
                      {o.auction.title}
                    </Link>
                    <p className="nums mt-1 text-sm text-charcoal/70">
                      {formatCad(o.subtotalCents)} + {formatCad(o.gstCents + o.pstCents)} tax ={" "}
                      <span className="font-semibold">{formatCad(o.totalCents)}</span>
                      {refunded > 0 && <span className="text-charcoal/50"> · {formatCad(refunded)} refunded</span>}
                    </p>
                  </div>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </div>

                {o.status === "PAID" && AUCTION_STATUS_LINE[o.auction.status] && (
                  <p className="mt-3 text-sm text-charcoal/70">{AUCTION_STATUS_LINE[o.auction.status]}</p>
                )}

                {o.status === "OFFERED" && o.offerExpiresAt && (
                  <div className="mt-4 space-y-3 rounded bg-rose-wash p-4">
                    <p className="text-sm">
                      The winner&apos;s payment fell through, so this one&apos;s yours at your top bid of{" "}
                      <span className="nums font-semibold">{formatCad(o.subtotalCents)}</span> if you want it.
                      Offer&apos;s good until{" "}
                      {o.offerExpiresAt.toLocaleTimeString("en-CA", {
                        hour: "numeric",
                        minute: "2-digit",
                        timeZone: "America/Vancouver",
                      })}
                      .
                    </p>
                    <div className="flex gap-2">
                      <form action={answerOffer}>
                        <input type="hidden" name="orderId" value={o.id} />
                        <input type="hidden" name="response" value="accept" />
                        <Button size="sm" variant="cta">
                          Take it — {formatCad(o.totalCents)} total
                        </Button>
                      </form>
                      <form action={answerOffer}>
                        <input type="hidden" name="orderId" value={o.id} />
                        <input type="hidden" name="response" value="decline" />
                        <Button size="sm" variant="ghost">
                          Pass
                        </Button>
                      </form>
                    </div>
                  </div>
                )}

                {o.status === "PENDING_CHARGE" && o.fixCardDeadlineAt && (
                  <p className="mt-3 text-sm text-charcoal/80">
                    We couldn&apos;t charge your card.{" "}
                    <Link href="/account/payment/new" className="font-semibold underline">
                      Update it
                    </Link>{" "}
                    and we&apos;ll retry automatically.
                  </p>
                )}

                {cancellable && (
                  <form action={cancelOrder} className="mt-4">
                    <input type="hidden" name="orderId" value={o.id} />
                    <Button size="sm" variant="destructive">
                      Cancel order (15% restocking fee)
                    </Button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
