export const metadata = { title: "FAQ" };

const FAQS: Array<[string, string]> = [
  [
    "How does the auction work?",
    "A fresh batch of arrangements drops at 9 AM and bidding runs until early evening. Minimum raise is $5. Bid outright, or set a max bid and the system bids the minimum needed for you, up to your ceiling — eBay style.",
  ],
  [
    "What happens if someone bids at the last second?",
    "Any bid in the final 5 minutes extends the close by 5 minutes, as many times as it takes. Sniping doesn't win here — wanting it more does.",
  ],
  [
    "When do I pay?",
    "Your card is saved securely with Stripe when you sign up, and it's only charged if you win — the winning bid plus GST/PST. You'll get a receipt and a delivery form right away.",
  ],
  [
    "Are bids binding?",
    "Yes. A bid is a commitment to buy at that price — that's what keeps the auction fair for everyone. You can cancel within 1 hour of winning (before delivery details are submitted) for a 15% restocking fee.",
  ],
  [
    "Where do you deliver?",
    "Workplaces in Prince George (postal codes V2K through V2P), the next business day, in your pick of three windows: 10–12, 12–3, or 3–5. We photograph the handoff so you see the moment land.",
  ],
  [
    "Can I stay anonymous?",
    "Completely. Tick the box on the delivery form and the card carries only your note — no names, no 'sent via BloomBid'.",
  ],
  [
    "What if nobody's at the desk?",
    "We call you. If it still can't land, you choose: re-delivery the next business day (+$10) or same-day pickup. If the miss is our fault, it's a full refund plus a $10 credit — no questions.",
  ],
  [
    "What if I miss the auction?",
    "Unsold arrangements open for buy-now at the starting price until 11:59 PM the same day. First tap takes it.",
  ],
];

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="font-display text-4xl text-forest">Fair questions</h1>
      <dl className="space-y-4">
        {FAQS.map(([q, a]) => (
          <div key={q} className="rounded-card bg-white p-6 shadow-lift">
            <dt className="font-display text-lg text-forest">{q}</dt>
            <dd className="mt-2 text-[15px] leading-relaxed text-charcoal/80">{a}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
