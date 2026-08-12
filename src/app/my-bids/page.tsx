import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { Countdown } from "@/components/countdown";
import { formatCad } from "@/lib/utils";

export const metadata = { title: "My bids" };
export const dynamic = "force-dynamic";

export default async function MyBidsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/signin");
  const userId = session.user.id;

  const participations = await prisma.auctionParticipant.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      auction: {
        include: {
          currentBid: { select: { userId: true, amountCents: true } },
          orders: { where: { userId }, select: { id: true, status: true } },
        },
      },
    },
  });
  const proxies = await prisma.proxyBid.findMany({
    where: { userId },
    select: { auctionId: true, ceilingCents: true, status: true },
  });
  const proxyByAuction = new Map(proxies.map((p) => [p.auctionId, p]));

  const active = participations.filter((p) =>
    ["LIVE", "CLOSING_EXTENDED"].includes(p.auction.status),
  );
  const done = participations.filter(
    (p) => !["LIVE", "CLOSING_EXTENDED"].includes(p.auction.status),
  );

  return (
    <div className="mx-auto max-w-2xl space-y-10">
      <h1 className="font-display text-4xl text-forest">My bids</h1>

      <section>
        <h2 className="mb-3 font-display text-xl text-forest">In play</h2>
        {active.length === 0 ? (
          <p className="text-charcoal/60">
            Nothing in play. <Link href="/" className="underline">Today&apos;s drop</Link> won&apos;t
            bid on itself.
          </p>
        ) : (
          <ul className="space-y-3">
            {active.map((p) => {
              const a = p.auction;
              const leading = a.currentBid?.userId === userId;
              const proxy = proxyByAuction.get(a.id);
              return (
                <li key={a.id}>
                  <Link
                    href={`/auctions/${a.slug}`}
                    className="flex items-center justify-between gap-3 rounded-card bg-white p-4 shadow-lift"
                  >
                    <div>
                      <p className="font-display text-lg text-forest">{a.title}</p>
                      <p className="mt-0.5 text-sm text-charcoal/60">
                        <span className="nums font-semibold text-charcoal">
                          {formatCad(a.currentBid?.amountCents ?? a.startPriceCents)}
                        </span>
                        {proxy?.status === "ACTIVE" && (
                          <span className="nums"> · your max {formatCad(proxy.ceilingCents)}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {leading ? (
                        <Badge variant="winning">Winning</Badge>
                      ) : (
                        <Badge variant="rose">Outbid</Badge>
                      )}
                      <Countdown
                        endAt={a.currentEndAt?.toISOString() ?? null}
                        compact
                        className="text-sm text-charcoal/70"
                      />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-display text-xl text-forest">Settled</h2>
        {done.length === 0 ? (
          <p className="text-charcoal/60">Your past auctions will live here.</p>
        ) : (
          <ul className="space-y-3">
            {done.map((p) => {
              const a = p.auction;
              const won = a.currentBid?.userId === userId && a.orders.length > 0;
              return (
                <li key={a.id}>
                  <Link
                    href={`/auctions/${a.slug}`}
                    className="flex items-center justify-between gap-3 rounded-card bg-white p-4 shadow-lift"
                  >
                    <div>
                      <p className="font-display text-lg text-forest">{a.title}</p>
                      <p className="nums mt-0.5 text-sm text-charcoal/60">
                        {a.currentBid ? formatCad(a.currentBid.amountCents) : "No bids"}
                      </p>
                    </div>
                    {won ? (
                      <Badge variant="winning">Won</Badge>
                    ) : a.status === "LAST_CHANCE" ? (
                      <Badge variant="rose">Last chance open</Badge>
                    ) : (
                      <Badge variant="neutral">
                        {a.currentBid ? "Outbid at the end" : "Didn't sell"}
                      </Badge>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
