"use client";

import * as React from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { AuctionPublicState } from "@/lib/auction/bidding";
import { useAuctionLive } from "@/hooks/use-auction-live";
import { Countdown } from "@/components/countdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatCad } from "@/lib/utils";

interface Photo {
  url: string;
  width: number;
  height: number;
}

/**
 * The live half of the auction page: photo (gold ring while you lead),
 * price with aria-live updates + rose outbid flash, countdown, bid box,
 * max-bid ceiling, history — and the sticky thumb-reach bid bar on mobile.
 */
export function AuctionLiveView({
  initial,
  photos,
  title,
  signedIn,
  eligible,
}: {
  initial: AuctionPublicState;
  photos: Photo[];
  title: string;
  signedIn: boolean;
  eligible: boolean;
}) {
  const router = useRouter();
  const { state, setState, serverNow } = useAuctionLive(initial);
  const [flash, setFlash] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [customAmount, setCustomAmount] = React.useState("");
  const [maxBid, setMaxBid] = React.useState("");
  const [showMaxBid, setShowMaxBid] = React.useState(false);
  const [photoIndex, setPhotoIndex] = React.useState(0);

  const isLeading = state.viewer?.isLeading ?? false;
  const open = state.status === "LIVE" || state.status === "CLOSING_EXTENDED";
  const prevPrice = React.useRef(state.priceCents);

  // Outbid flash: price moved and it wasn't us who moved it into our favor
  React.useEffect(() => {
    if (state.priceCents !== prevPrice.current) {
      prevPrice.current = state.priceCents;
      if (!isLeading) {
        setFlash(true);
        const t = setTimeout(() => setFlash(false), 900);
        return () => clearTimeout(t);
      }
    }
  }, [state.priceCents, isLeading]);

  async function submitBid(body: { amountCents?: number; maxBidCents?: number }) {
    if (!signedIn) {
      router.push("/signin");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/auctions/${state.id}/bids`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "That didn't go through — try again.");
      } else {
        setState(data.state);
        setCustomAmount("");
        setMaxBid("");
      }
    } catch {
      setError("Network hiccup — your bid didn't go through. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const quickBidAmount = state.minNextBidCents;
  const dollars = (v: string) => Math.round(Number.parseFloat(v) * 100);

  return (
    <div className="grid gap-8 lg:grid-cols-[3fr_2fr]">
      {/* Photo with gold winning ring */}
      <div className="space-y-3">
        <div
          className={cn(
            "relative overflow-hidden rounded-card",
            isLeading && "ring-2 ring-gold ring-offset-4 ring-offset-cream",
          )}
        >
          {photos[photoIndex] && (
            <Image
              src={photos[photoIndex]!.url}
              alt={title}
              width={photos[photoIndex]!.width}
              height={photos[photoIndex]!.height}
              priority
              className="aspect-[4/5] w-full object-cover"
            />
          )}
          {isLeading && (
            <div className="absolute left-3 top-3">
              <Badge variant="winning">You&apos;re winning</Badge>
            </div>
          )}
        </div>
        {photos.length > 1 && (
          <div className="flex gap-2">
            {photos.map((p, i) => (
              <button
                key={p.url}
                type="button"
                onClick={() => setPhotoIndex(i)}
                aria-label={`Photo ${i + 1}`}
                className={cn(
                  "w-16 overflow-hidden rounded transition-opacity",
                  i === photoIndex ? "ring-2 ring-forest" : "opacity-60 hover:opacity-100",
                )}
              >
                <Image src={p.url} alt="" width={64} height={80} className="aspect-[4/5] object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-6">
        {/* Price + countdown */}
        <div
          className={cn("rounded-card bg-white p-6 shadow-lift", flash && "animate-price-flash")}
        >
          <div className="flex items-baseline justify-between">
            <div aria-live="polite" aria-atomic="true">
              <p className="text-sm text-charcoal/60">
                {state.priceCents === null ? "Starting at" : `Current bid · ${state.bidCount} bids`}
              </p>
              <p className="nums font-display text-5xl text-forest">
                {formatCad(state.priceCents ?? state.startPriceCents)}
              </p>
              {state.leaderAlias !== null && (
                <p className="mt-1 text-sm text-charcoal/60">
                  {isLeading ? "Held by you" : `Held by Bidder #${state.leaderAlias}`}
                  {state.extensionCount > 0 && ` · extended ×${state.extensionCount}`}
                </p>
              )}
            </div>
            {open && (
              <Countdown endAt={state.endAt} serverNow={serverNow} compact className="text-2xl text-charcoal" />
            )}
          </div>
        </div>

        {/* Bid box (desktop) */}
        {open && (
          <div className="hidden space-y-4 rounded-card bg-white p-6 shadow-lift md:block">
            <BidControls
              quickBidAmount={quickBidAmount}
              customAmount={customAmount}
              setCustomAmount={setCustomAmount}
              maxBid={maxBid}
              setMaxBid={setMaxBid}
              showMaxBid={showMaxBid}
              setShowMaxBid={setShowMaxBid}
              submitting={submitting}
              isLeading={isLeading}
              ceilingCents={state.viewer?.ceilingCents ?? null}
              onQuickBid={() => submitBid({ amountCents: quickBidAmount })}
              onCustom={() => {
                const amountCents = dollars(customAmount);
                const maxBidCents = maxBid ? dollars(maxBid) : undefined;
                if (Number.isFinite(amountCents) && amountCents > 0)
                  void submitBid({ amountCents, maxBidCents });
              }}
              onCeilingOnly={() => {
                const maxBidCents = dollars(maxBid);
                if (Number.isFinite(maxBidCents) && maxBidCents > 0) void submitBid({ maxBidCents });
              }}
            />
            <BidStatusLine error={error} signedIn={signedIn} eligible={eligible} state={state} />
          </div>
        )}

        {/* Bid history */}
        <div className="rounded-card bg-white p-6 shadow-lift">
          <h2 className="mb-3 font-display text-lg text-forest">Bid history</h2>
          {state.history.length === 0 ? (
            <p className="text-sm text-charcoal/60">
              No bids yet. Someone gets to set the tone — why not you?
            </p>
          ) : (
            <ol className="divide-y divide-forest/10 text-sm">
              {state.history.map((b, i) => (
                <li key={`${b.at}-${i}`} className="flex items-center justify-between py-2">
                  <span>
                    Bidder #{b.alias}
                    {b.isProxy && <span className="ml-1.5 text-xs text-charcoal/50">(auto)</span>}
                  </span>
                  <span className="flex items-center gap-4">
                    <span className="nums text-charcoal/50">{timeAgo(b.at, serverNow())}</span>
                    <span className={cn("nums font-semibold", i === 0 && "text-forest")}>
                      {formatCad(b.amountCents)}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      {/* Sticky mobile bid bar — thumb-reachable, countdown always visible */}
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-forest/10 bg-white/95 p-3 backdrop-blur md:hidden">
          <div className="mb-1.5 flex items-center justify-between px-1 text-sm">
            <span className="nums font-display text-xl text-forest">
              {formatCad(state.priceCents ?? state.startPriceCents)}
            </span>
            <Countdown endAt={state.endAt} serverNow={serverNow} compact className="text-lg" />
          </div>
          <Button
            variant="cta"
            size="lg"
            className="w-full"
            disabled={submitting || isLeading}
            onClick={() => submitBid({ amountCents: quickBidAmount })}
          >
            {isLeading ? "You're the high bidder" : `Bid ${formatCad(quickBidAmount)}`}
          </Button>
          {error && (
            <p role="alert" className="mt-1.5 px-1 text-xs text-charcoal/70">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function BidControls(props: {
  quickBidAmount: number;
  customAmount: string;
  setCustomAmount: (v: string) => void;
  maxBid: string;
  setMaxBid: (v: string) => void;
  showMaxBid: boolean;
  setShowMaxBid: (v: boolean) => void;
  submitting: boolean;
  isLeading: boolean;
  ceilingCents: number | null;
  onQuickBid: () => void;
  onCustom: () => void;
  onCeilingOnly: () => void;
}) {
  const p = props;
  return (
    <>
      <div className="flex gap-3">
        <Button
          variant="cta"
          size="lg"
          className="flex-1"
          disabled={p.submitting || p.isLeading}
          onClick={p.onQuickBid}
        >
          {p.isLeading ? "You're the high bidder" : `Bid ${formatCad(p.quickBidAmount)}`}
        </Button>
      </div>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="custom-bid" className="mb-1 block text-sm font-medium text-forest">
            Or your own amount
          </label>
          <Input
            id="custom-bid"
            inputMode="decimal"
            placeholder={`${(p.quickBidAmount / 100).toFixed(0)} or more`}
            value={p.customAmount}
            onChange={(e) => p.setCustomAmount(e.target.value)}
          />
        </div>
        <Button variant="outline" disabled={p.submitting || !p.customAmount} onClick={p.onCustom}>
          Bid
        </Button>
      </div>
      {p.ceilingCents !== null ? (
        <p className="text-sm text-charcoal/70">
          Your max bid is <span className="nums font-semibold">{formatCad(p.ceilingCents)}</span> —
          we&apos;ll bid the minimum needed for you, up to that.
        </p>
      ) : p.showMaxBid ? (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label htmlFor="max-bid" className="mb-1 block text-sm font-medium text-forest">
              Your ceiling
            </label>
            <Input
              id="max-bid"
              inputMode="decimal"
              placeholder="e.g. 120"
              value={p.maxBid}
              onChange={(e) => p.setMaxBid(e.target.value)}
            />
          </div>
          <Button variant="outline" disabled={p.submitting || !p.maxBid} onClick={p.onCeilingOnly}>
            Set max bid
          </Button>
        </div>
      ) : (
        <button
          type="button"
          className="text-sm text-forest underline underline-offset-2 hover:text-forest-soft"
          onClick={() => p.setShowMaxBid(true)}
        >
          Set a max bid and let us do the bidding
        </button>
      )}
    </>
  );
}

function BidStatusLine({
  error,
  signedIn,
  eligible,
  state,
}: {
  error: string | null;
  signedIn: boolean;
  eligible: boolean;
  state: AuctionPublicState;
}) {
  if (error)
    return (
      <p role="alert" className="text-sm text-charcoal/80">
        {error}
      </p>
    );
  if (!signedIn)
    return (
      <p className="text-sm text-charcoal/60">
        <a href="/signin" className="underline">
          Sign in
        </a>{" "}
        to bid — takes under a minute.
      </p>
    );
  if (!eligible)
    return (
      <p className="text-sm text-charcoal/60">
        Almost there —{" "}
        <a href="/account" className="underline">
          finish your bidding checklist
        </a>{" "}
        (verified email + a card on file).
      </p>
    );
  if (state.viewer?.ceilingReached)
    return (
      <p className="text-sm text-charcoal/70">
        Bidding passed your max. Raise your ceiling to get back in it.
      </p>
    );
  return <p className="text-sm text-charcoal/50">Bids are binding — the fun kind of binding.</p>;
}

function timeAgo(iso: string, nowMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
