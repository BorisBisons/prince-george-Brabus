import { prisma } from "@/lib/db";
import { AuctionCard, type AuctionCardData } from "@/components/auction-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: { subscribed?: string };
}) {
  const auctions = await prisma.auction.findMany({
    where: { status: { in: ["SCHEDULED", "LIVE", "CLOSING_EXTENDED", "LAST_CHANCE"] } },
    orderBy: [{ currentEndAt: "asc" }],
    include: {
      photos: { orderBy: { position: "asc" }, take: 1 },
      currentBid: { select: { amountCents: true } },
      _count: { select: { bids: true } },
    },
  });

  const cards: AuctionCardData[] = auctions.map((a) => ({
    slug: a.slug,
    title: a.title,
    status: a.status,
    photoUrl: a.photos[0]?.url ?? null,
    priceCents: a.currentBid?.amountCents ?? null,
    startPriceCents: a.startPriceCents,
    endAt: a.currentEndAt?.toISOString() ?? null,
    bidCount: a._count.bids,
  }));

  return (
    <div className="space-y-16">
      <section>
        <h1 className="font-display text-4xl leading-tight text-forest sm:text-5xl">
          Today&apos;s drop
        </h1>
        <p className="mt-2 max-w-xl text-charcoal/70">
          One small batch a day. Highest bid takes it — hand-delivered to their
          workplace, right here in Prince George.
        </p>
        {cards.length === 0 ? (
          <div className="mt-10 rounded-card bg-white p-10 text-center shadow-lift">
            <p className="font-display text-2xl text-forest">Today&apos;s blooms are gone.</p>
            <p className="mt-2 text-charcoal/70">
              Tomorrow&apos;s drop lands at 9 AM — set an alert below and we&apos;ll nudge you.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((a) => (
              <AuctionCard key={a.slug} auction={a} />
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-6 rounded-card bg-forest p-8 text-cream sm:grid-cols-3">
        {[
          ["1 · Bid all day", "A fresh batch drops at 9 AM. Bid outright, or set a max and let us bid the minimum for you."],
          ["2 · Win at close", "Auctions close in the evening. Sniping just extends the clock — the flowers wait for no one else."],
          ["3 · We deliver", "Your card is charged, you tell us where they work, and the arrangement lands on their desk."],
        ].map(([title, body]) => (
          <div key={title}>
            <h3 className="font-display text-xl text-gold">{title}</h3>
            <p className="mt-2 text-sm text-cream/85">{body}</p>
          </div>
        ))}
      </section>

      <section className="mx-auto max-w-md text-center">
        <h2 className="font-display text-2xl text-forest">Never miss a drop</h2>
        <p className="mt-1 text-sm text-charcoal/70">
          One email at 9 AM when the blooms go live. That&apos;s it — promise.
        </p>
        {searchParams.subscribed === "1" ? (
          <p role="status" className="mt-4 rounded bg-rose-wash px-4 py-3 text-[15px]">
            Check your inbox to confirm — then you&apos;re on the list. 🌷
          </p>
        ) : (
          <form
            action={async (formData: FormData) => {
              "use server";
              const email = String(formData.get("email") ?? "")
                .trim()
                .toLowerCase();
              if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
              const { prisma } = await import("@/lib/db");
              const { redirect } = await import("next/navigation");
              await prisma.emailSubscriber.upsert({
                where: { email },
                create: { email }, // confirmation email (CASL double opt-in) sends in step 5
                update: { unsubscribedAt: null },
              });
              redirect("/?subscribed=1");
            }}
            className="mt-4 flex gap-2"
          >
            <Input name="email" type="email" required placeholder="you@example.com" aria-label="Email address" />
            <Button type="submit" variant="cta">
              Alert me
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
