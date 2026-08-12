import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Countdown } from "@/components/countdown";
import { formatCad } from "@/lib/utils";

export interface AuctionCardData {
  slug: string;
  title: string;
  status: string;
  photoUrl: string | null;
  priceCents: number | null;
  startPriceCents: number;
  endAt: string | null;
  bidCount: number;
}

/** Grid card: edge-to-edge 4:5 photo, price, live countdown. */
export function AuctionCard({ auction }: { auction: AuctionCardData }) {
  const live = auction.status === "LIVE" || auction.status === "CLOSING_EXTENDED";
  const lastChance = auction.status === "LAST_CHANCE";

  return (
    <Link
      href={`/auctions/${auction.slug}`}
      className="group block overflow-hidden rounded-card bg-white shadow-lift transition-transform hover:-translate-y-0.5"
    >
      <div className="relative aspect-[4/5] overflow-hidden bg-rose-wash">
        {auction.photoUrl && (
          <Image
            src={auction.photoUrl}
            alt={auction.title}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          />
        )}
        {lastChance && (
          <div className="absolute left-3 top-3">
            <Badge variant="rose">Last chance — buy now</Badge>
          </div>
        )}
        {auction.status === "SCHEDULED" && (
          <div className="absolute left-3 top-3">
            <Badge variant="neutral">Opens soon</Badge>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between p-4">
        <div>
          <h3 className="font-display text-lg text-forest">{auction.title}</h3>
          <p className="nums mt-0.5 font-display text-2xl text-charcoal">
            {formatCad(auction.priceCents ?? auction.startPriceCents)}
            {live && auction.bidCount > 0 && (
              <span className="ml-2 font-sans text-sm text-charcoal/50">{auction.bidCount} bids</span>
            )}
          </p>
        </div>
        {live && <Countdown endAt={auction.endAt} compact className="text-lg text-charcoal/80" />}
      </div>
    </Link>
  );
}
