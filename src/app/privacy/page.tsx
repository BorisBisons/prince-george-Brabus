export const metadata = { title: "Privacy Policy" };

/** Placeholder privacy policy per spec §10 (PIPEDA), pending legal review. */
export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-xl space-y-5 leading-relaxed text-charcoal/80">
      <h1 className="font-display text-4xl text-forest">Privacy Policy</h1>
      <p className="text-sm text-charcoal/50">
        Placeholder pending legal review. Last updated: August 2026. BloomBid complies with the
        Personal Information Protection and Electronic Documents Act (PIPEDA) and BC&apos;s PIPA.
      </p>

      <Section title="What we collect">
        Account details (email, name, optional phone), bidding activity, delivery details you
        provide (recipient name, workplace address, gift note), delivery proof (photo, timestamp,
        GPS at handoff), and notification preferences. Payment cards are stored by Stripe — we
        never see the number.
      </Section>
      <Section title="Why we collect it">
        To run auctions, charge winning bids, deliver arrangements, resolve disputes (delivery
        proof doubles as payment-dispute evidence), and send the messages you&apos;ve opted into.
      </Section>
      <Section title="Recipients' information">
        Delivery details identify a recipient who may not be a BloomBid user. We use this
        information only to complete the delivery and retain it only as long as needed for records
        and dispute resolution.
      </Section>
      <Section title="Public identity">
        Other bidders see you only as an anonymized alias (e.g. &ldquo;Bidder #4&rdquo;), stable
        within a single auction and never linkable across auctions.
      </Section>
      <Section title="Deleting your account">
        You can request deletion at any time. Accounts with unsettled obligations (an unpaid win or
        a delivery in progress) are deleted once those settle; bids stand per the Terms. Personal
        information is then removed while anonymized transaction records are retained for tax and
        bookkeeping requirements.
      </Section>
      <Section title="Contact">
        Placeholder: privacy officer contact details and complaint process (including escalation to
        the Office of the Privacy Commissioner of Canada) to be finalized.
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
