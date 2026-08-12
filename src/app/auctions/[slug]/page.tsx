import { notFound } from "next/navigation";
import Image from "next/image";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildAuctionState } from "@/lib/auction/bidding";
import { getEligibility } from "@/lib/bidding-eligibility";
import { AuctionLiveView } from "@/components/auction-live-view";
import { BuyNowButton } from "@/components/buy-now-button";
import { Badge } from "@/components/ui/badge";
import { formatCad } from "@/lib/utils";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const auction = await prisma.auction.findUnique({
    where: { slug: params.slug },
    include: { currentBid: true },
  });
  if (!auction) return {};
  const price = formatCad(auction.currentBid?.amountCents ?? auction.startPriceCents);
  return {
    title: auction.title,
    description: `Current bid ${price} — a one-day flower auction in Prince George.`,
  };
}

export default async function AuctionPage({ params }: { params: { slug: string } }) {
  const auction = await prisma.auction.findUnique({
    where: { slug: params.slug },
    include: { photos: { orderBy: { position: "asc" } } },
  });
  if (!auction || auction.status === "DRAFT") notFound();

  const session = await auth();
  const [state, eligibility] = await Promise.all([
    buildAuctionState(prisma, auction.id, session?.user?.id),
    session?.user?.id ? getEligibility(session.user.id) : null,
  ]);

  const settled = ![
    "SCHEDULED",
    "LIVE",
    "CLOSING_EXTENDED",
    "LAST_CHANCE",
  ].includes(auction.status);

  return (
    <article className="space-y-8 pb-28 md:pb-0">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-display text-4xl text-forest">{auction.title}</h1>
        <StatusBadge status={auction.status} />
      </header>

      {auction.status === "SCHEDULED" ? (
        <PreDrop auction={auction} state={state} />
      ) : auction.status === "LAST_CHANCE" ? (
        <LastChance auction={auction} state={state} />
      ) : settled ? (
        <Settled auction={auction} state={state} />
      ) : (
        <AuctionLiveView
          initial={state}
          photos={auction.photos}
          title={auction.title}
          signedIn={Boolean(session?.user)}
          eligible={eligibility?.ok ?? false}
        />
      )}

      <section className="max-w-2xl">
        <h2 className="mb-2 font-display text-xl text-forest">About this arrangement</h2>
        <p className="leading-relaxed text-charcoal/80">{auction.description}</p>
      </section>
    </article>
  );
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "LIVE":
      return <Badge variant="forest">Live now</Badge>;
    case "CLOSING_EXTENDED":
      return <Badge variant="rose">Closing — extended</Badge>;
    case "LAST_CHANCE":
      return <Badge variant="rose">Last chance</Badge>;
    case "SCHEDULED":
      return <Badge variant="neutral">Opens soon</Badge>;
    default:
      return <Badge variant="neutral">Ended</Badge>;
  }
}

type AuctionWithPhotos = NonNullable<
  Awaited<ReturnType<typeof prisma.auction.findUnique<{ where: { slug: string }; include: { photos: true } }>>>
>;
type State = Awaited<ReturnType<typeof buildAuctionState>>;

function Photo({ auction }: { auction: AuctionWithPhotos }) {
  const photo = auction.photos[0];
  if (!photo) return null;
  return (
    <div className="overflow-hidden rounded-card">
      <Image
        src={photo.url}
        alt={auction.title}
        width={photo.width}
        height={photo.height}
        priority
        className="aspect-[4/5] w-full max-w-xl object-cover"
      />
    </div>
  );
}

function PreDrop({ auction, state }: { auction: AuctionWithPhotos; state: State }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
      <Photo auction={auction} />
      <div className="rounded-card bg-white p-6 shadow-lift">
        <p className="text-sm text-charcoal/60">Starting at</p>
        <p className="nums font-display text-5xl text-forest">{formatCad(state.startPriceCents)}</p>
        <p className="mt-3 text-charcoal/70">
          Doors open at 9 AM. Come back then — or set a max bid the moment it&apos;s live and let us
          bid for you.
        </p>
      </div>
    </div>
  );
}

function LastChance({ auction, state }: { auction: AuctionWithPhotos; state: State }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
      <Photo auction={auction} />
      <div className="space-y-4 rounded-card bg-white p-6 shadow-lift">
        <div>
          <p className="text-sm text-charcoal/60">Didn&apos;t sell at auction — yours tonight for</p>
          <p className="nums font-display text-5xl text-forest">{formatCad(state.startPriceCents)}</p>
          <p className="mt-2 text-sm text-charcoal/60">Open until 11:59 PM. First tap takes it.</p>
        </div>
        <BuyNowButton auctionId={auction.id} priceCents={state.startPriceCents} />
      </div>
    </div>
  );
}

function Settled({ auction, state }: { auction: AuctionWithPhotos; state: State }) {
  return (
    <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
      <Photo auction={auction} />
      <div className="rounded-card bg-white p-6 shadow-lift">
        {state.priceCents !== null ? (
          <>
            <p className="text-sm text-charcoal/60">Went home for</p>
            <p className="nums font-display text-5xl text-forest">{formatCad(state.priceCents)}</p>
            <p className="mt-3 text-charcoal/70">
              Bidder #{state.leaderAlias} took this one. Tomorrow&apos;s drop lands at 9 AM — set an
              alert.
            </p>
          </>
        ) : (
          <p className="text-charcoal/70">
            This one&apos;s gone. Tomorrow&apos;s drop lands at 9 AM — set an alert.
          </p>
        )}
      </div>
    </div>
  );
}
