export const metadata = { title: "Terms of Service" };

/**
 * Placeholder terms per spec §10 — structure and key clauses present
 * (bids-are-binding, cancellation matrix, CASL), pending legal review.
 */
export default function TermsPage() {
  return (
    <article className="prose-sm mx-auto max-w-xl space-y-5 leading-relaxed text-charcoal/80">
      <h1 className="font-display text-4xl text-forest">Terms of Service</h1>
      <p className="text-sm text-charcoal/50">
        Placeholder pending legal review. Last updated: August 2026.
      </p>

      <Section title="1. The service">
        BloomBid operates daily auctions for floral arrangements delivered within Prince George,
        BC. An account with a verified email address and a valid saved payment card is required to
        bid.
      </Section>
      <Section title="2. Bids are binding">
        Placing a bid is a binding offer to purchase the arrangement at that price, plus applicable
        GST and PST. If you are the highest bidder at close, your saved card is charged
        automatically. Repeated failed payments result in suspension of bidding privileges.
      </Section>
      <Section title="3. Anti-sniping">
        Bids placed within the final five minutes extend the auction by five minutes, without
        limit. All bids and extensions are recorded in an audit log.
      </Section>
      <Section title="4. Cancellations and refunds">
        A winning buyer may cancel within one (1) hour of auction close, before submitting delivery
        details, subject to a 15% restocking fee. After delivery is scheduled, orders cannot be
        cancelled — arrangements are cut and prepared to order. Failed deliveries caused by the
        buyer (unreachable recipient, incorrect address, refusal) are not refundable; re-delivery is
        available for a $10 fee. Failed deliveries caused by BloomBid are refunded in full with a
        $10 credit.
      </Section>
      <Section title="5. Delivery">
        Delivery is to workplaces within Prince George postal zones V2K–V2P, next business day,
        within the selected window. Proof of delivery (photograph, timestamp, and location) is
        retained.
      </Section>
      <Section title="6. Electronic messages (CASL)">
        We send transactional messages about your bids, payments, and deliveries. Marketing
        messages (such as the daily drop alert) are sent only with your consent and every email
        includes a one-click unsubscribe, in accordance with Canada&apos;s Anti-Spam Legislation.
      </Section>
      <Section title="7. Liability">
        Placeholder: limitation-of-liability, force-majeure (snow days pause auctions with bids
        preserved), and governing-law (British Columbia) clauses to be finalized with counsel.
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 font-display text-xl text-forest">{title}</h2>
      <p>{children}</p>
    </section>
  );
}
