import { prisma } from "@/lib/db";
import { todayInVancouver } from "@/lib/delivery";
import { PrintButton } from "@/components/print-button";

export const metadata = { title: "Gift notes" };
export const dynamic = "force-dynamic";

/**
 * Printable gift-note cards (spec §8): card-sized, elegant typography,
 * "sent via BloomBid" only when the sender isn't anonymous. One tap =
 * browser print → PDF; @media print rules strip the chrome.
 */
export default async function GiftNotesPage() {
  const today = todayInVancouver();
  const deliveries = await prisma.delivery.findMany({
    where: { scheduledDate: today, deliveredAt: null, giftNote: { not: null } },
    orderBy: { routePosition: "asc" },
    select: { id: true, recipientName: true, giftNote: true, anonymousSender: true },
  });

  return (
    <div className="space-y-6">
      <div className="no-print flex items-center justify-between">
        <h1 className="font-display text-3xl text-forest">Gift notes · today</h1>
        <PrintButton disabled={deliveries.length === 0} />
      </div>

      {deliveries.length === 0 ? (
        <p className="no-print rounded-card bg-white p-8 text-center text-charcoal/60 shadow-lift">
          No notes to print today.
        </p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 print:block">
          {deliveries.map((d) => (
            <div
              key={d.id}
              className="gift-card mx-auto flex aspect-[7/5] w-full max-w-sm flex-col justify-between rounded-card border border-forest/15 bg-cream p-8 shadow-lift print:mb-[0.4in] print:break-inside-avoid print:shadow-none"
            >
              <p className="font-display text-sm uppercase tracking-[0.2em] text-forest/60">
                For {d.recipientName}
              </p>
              <p className="font-display text-lg italic leading-relaxed text-charcoal">
                {d.giftNote}
              </p>
              <p className="text-right font-display text-xs tracking-wide text-gold-deep">
                {d.anonymousSender ? " " : "sent via BloomBid"}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
