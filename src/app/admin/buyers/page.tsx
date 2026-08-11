import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";
import { buyerStats } from "@/lib/admin-ops";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatCad } from "@/lib/utils";

export const metadata = { title: "Buyers" };
export const dynamic = "force-dynamic";

/** Buyer CRM lite: bid history, win rate, LTV, suspend/unsuspend. */
export default async function BuyersPage() {
  await requireAdmin();
  const buyers = await buyerStats();

  async function toggleSuspend(formData: FormData) {
    "use server";
    await requireAdmin();
    const userId = String(formData.get("userId") ?? "");
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { biddingSuspendedAt: true } });
    if (!user) return;
    await prisma.user.update({
      where: { id: userId },
      data: user.biddingSuspendedAt
        ? { biddingSuspendedAt: null, suspensionReason: null }
        : { biddingSuspendedAt: new Date(), suspensionReason: "admin_manual" },
    });
    revalidatePath("/admin/buyers");
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl text-forest">Buyers</h1>
      <Card>
        <CardContent className="pt-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-forest/10 text-left text-forest">
                  <th className="py-2 pr-3 font-medium">Buyer</th>
                  <th className="px-3 py-2 text-right font-medium">Bids</th>
                  <th className="px-3 py-2 text-right font-medium">Auctions</th>
                  <th className="px-3 py-2 text-right font-medium">Wins</th>
                  <th className="px-3 py-2 text-right font-medium">Win rate</th>
                  <th className="px-3 py-2 text-right font-medium">LTV</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-forest/5">
                {buyers.map((b) => (
                  <tr key={b.id}>
                    <td className="py-2.5 pr-3">
                      <p className="font-medium">{b.name ?? "—"}</p>
                      <p className="text-xs text-charcoal/50">{b.email}</p>
                    </td>
                    <td className="nums px-3 py-2.5 text-right">{b.bids}</td>
                    <td className="nums px-3 py-2.5 text-right">{b.auctionsEntered}</td>
                    <td className="nums px-3 py-2.5 text-right">{b.wins}</td>
                    <td className="nums px-3 py-2.5 text-right">{Math.round(b.winRate * 100)}%</td>
                    <td className="nums px-3 py-2.5 text-right font-semibold">{formatCad(b.ltvCents)}</td>
                    <td className="px-3 py-2.5">
                      {b.suspended ? (
                        <Badge variant="rose">suspended</Badge>
                      ) : b.paymentFailureCount > 0 ? (
                        <Badge variant="neutral">{b.paymentFailureCount} pay fail</Badge>
                      ) : (
                        <Badge variant="forest">good</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <form action={toggleSuspend}>
                        <input type="hidden" name="userId" value={b.id} />
                        <Button size="sm" variant={b.suspended ? "outline" : "destructive"}>
                          {b.suspended ? "Unsuspend" : "Suspend"}
                        </Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
