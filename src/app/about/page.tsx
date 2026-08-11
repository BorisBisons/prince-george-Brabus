export const metadata = { title: "About" };

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-xl space-y-6">
      <h1 className="font-display text-4xl text-forest">One drop a day. That&apos;s the whole idea.</h1>
      <div className="space-y-4 leading-relaxed text-charcoal/80">
        <p>
          BloomBid is a one-person flower shop in Prince George that works like no other flower
          shop: every morning at 9, a small batch of arrangements goes up for auction. People bid
          all day. When the clock runs out, the highest bidder wins — and we hand-deliver the
          arrangement to their partner&apos;s workplace, gift note and all.
        </p>
        <p>
          Why auctions? Because flowers should feel like an occasion. A limited batch means every
          arrangement is the only one of its kind that day. A closing timer means deciding you want
          something — and going for it. And a hand delivery to their desk at 2 PM on a Tuesday
          means the whole office knows somebody&apos;s doing romance right.
        </p>
        <p>
          Everything is designed, built, arranged, and driven by one person. If your delivery is
          perfect, that&apos;s them. If something goes sideways, it&apos;s also them — and they&apos;ll
          make it right.
        </p>
        <p className="font-display text-lg italic text-forest">
          Grown-up romance, delivered. See you at the 9 AM drop.
        </p>
      </div>
    </article>
  );
}
