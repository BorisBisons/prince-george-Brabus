import { requireAdmin } from "@/lib/admin";
import { moneyStats } from "@/lib/admin-ops";
import { vancouverDayRange, vancouverParts, zonedTimeInVancouver } from "@/lib/time";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCad } from "@/lib/utils";

export const metadata = { title: "Money" };
export const dynamic = "force-dynamic";

export default async function MoneyPage() {
  await requireAdmin();
  const now = new Date();
  const { y, m, d } = vancouverParts(now);

  const today = vancouverDayRange(now);
  const weekStart = zonedTimeInVancouver(y, m, d - 6, 0, 0);
  const monthStart = zonedTimeInVancouver(y, m, 1, 0, 0);

  const [todayStats, weekStats, monthStats] = await Promise.all([
    moneyStats(today.start, today.end),
    moneyStats(weekStart, today.end),
    moneyStats(monthStart, today.end),
  ]);

  const blocks = [
    ["Today", todayStats],
    ["Last 7 days", weekStats],
    ["This month", monthStats],
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl text-forest">Money</h1>
        <a href="/api/admin/money/export">
          <Button variant="outline">Export CSV (this month)</Button>
        </a>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {blocks.map(([label, s]) => (
          <Card key={label}>
            <CardHeader>
              <CardTitle className="text-base">{label}</CardTitle>
            </CardHeader>
            <CardContent className="nums space-y-1.5 text-[15px]">
              <Row label="Gross" value={formatCad(s.grossCents)} strong />
              <Row label="Refunds" value={`−${formatCad(s.refundedCents)}`} />
              <Row label="Net" value={formatCad(s.netCents)} strong />
              <Row label="GST collected" value={formatCad(s.gstCents)} />
              <Row label="PST collected" value={formatCad(s.pstCents)} />
              <Row label="Paid orders" value={String(s.paidOrders)} />
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-sm text-charcoal/50">
        Figures are order-date based; Stripe processing fees reconcile from the Stripe dashboard export.
      </p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className="flex justify-between">
      <span className="font-sans text-charcoal/60">{label}</span>
      <span className={strong ? "font-semibold text-forest" : ""}>{value}</span>
    </p>
  );
}
