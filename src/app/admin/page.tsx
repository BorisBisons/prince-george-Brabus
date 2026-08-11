import Link from "next/link";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { getKillSwitch, pauseAll, resumeAll } from "@/lib/kill-switch";
import { moneyStats } from "@/lib/admin-ops";
import { vancouverDayRange } from "@/lib/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatCad } from "@/lib/utils";

export const metadata = { title: "Admin" };
export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<string, { label: string; variant: "forest" | "rose" | "neutral" | "winning" }> = {
  DRAFT: { label: "Draft", variant: "neutral" },
  SCHEDULED: { label: "Scheduled", variant: "neutral" },
  LIVE: { label: "Live", variant: "forest" },
  CLOSING_EXTENDED: { label: "Extended", variant: "rose" },
  PAYMENT_PENDING: { label: "Payment pending", variant: "rose" },
  PAID: { label: "Paid", variant: "winning" },
  LAST_CHANCE: { label: "Last chance", variant: "rose" },
};

export default async function AdminHomePage() {
  await requireAdmin();
  const { start, end } = vancouverDayRange(new Date());

  const [auctions, todayMoney, killSwitch] = await Promise.all([
    prisma.auction.findMany({
      where: {
        OR: [
          { status: { in: ["DRAFT", "SCHEDULED", "LIVE", "CLOSING_EXTENDED", "PAYMENT_PENDING", "LAST_CHANCE"] } },
          { updatedAt: { gte: start, lt: end } },
        ],
      },
      orderBy: [{ status: "asc" }, { currentEndAt: "asc" }],
      include: {
        currentBid: { select: { amountCents: true } },
        _count: { select: { bids: true, participants: true } },
      },
      take: 30,
    }),
    moneyStats(start, end),
    getKillSwitch(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl text-forest">Live day</h1>
        <p className="nums font-display text-2xl text-forest">
          {formatCad(todayMoney.netCents)} <span className="font-sans text-sm text-charcoal/50">today</span>
        </p>
      </div>

      {/* Kill switch */}
      <Card>
        <CardHeader>
          <CardTitle>{killSwitch.active ? "⏸ Auctions paused" : "Kill switch"}</CardTitle>
        </CardHeader>
        <CardContent>
          {killSwitch.active ? (
            <form
              action={async () => {
                "use server";
                const admin = await requireAdmin();
                await resumeAll(admin.id);
                revalidatePath("/admin");
              }}
              className="flex items-center gap-3"
            >
              <p className="flex-1 text-sm text-charcoal/70">
                Banner: &ldquo;{killSwitch.banner}&rdquo; — clocks are frozen and will shift forward on resume.
              </p>
              <Button variant="cta">Resume auctions</Button>
            </form>
          ) : (
            <form
              action={async (formData: FormData) => {
                "use server";
                const admin = await requireAdmin();
                const banner = String(formData.get("banner") ?? "").trim() ||
                  "Snow day — auctions paused, bids preserved.";
                await pauseAll(admin.id, banner);
                revalidatePath("/admin");
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <Input
                name="banner"
                placeholder="Snow day — auctions paused, bids preserved."
                className="flex-1 min-w-56"
              />
              <Button variant="destructive">Pause everything</Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Auction table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Auctions</CardTitle>
          <Link href="/admin/drops">
            <Button size="sm" variant="cta">
              Morning flow →
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-forest/10">
            {auctions.map((a) => {
              const badge = STATUS_BADGE[a.status] ?? { label: a.status, variant: "neutral" as const };
              return (
                <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link href={`/auctions/${a.slug}`} className="font-medium text-forest hover:underline">
                      {a.title}
                    </Link>
                    <p className="nums text-sm text-charcoal/60">
                      {a.currentBid ? formatCad(a.currentBid.amountCents) : formatCad(a.startPriceCents)} ·{" "}
                      {a._count.bids} bids · {a._count.participants} bidders
                      {a.extensionCount > 0 && ` · extended ×${a.extensionCount}`}
                    </p>
                  </div>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["/admin/orders", "Orders board"],
          ["/admin/money", "Money"],
          ["/admin/buyers", "Buyers"],
          ["/admin/run-sheet", "Run sheet"],
        ].map(([href, label]) => (
          <Link key={href} href={href!} className="rounded-card bg-white p-4 text-center font-medium text-forest shadow-lift hover:bg-forest/5">
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}
