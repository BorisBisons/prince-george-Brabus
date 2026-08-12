import { NotificationEvent } from "@prisma/client";

/**
 * One content builder per event (spec §7). Voice: warm, a little playful,
 * never corporate. Every template deep-links to the exact next action.
 */

export interface NotificationContent {
  subject: string;
  heading: string;
  body: string;
  ctaLabel: string;
  ctaPath: string;
  pushTitle: string;
  pushBody: string;
  smsText: string;
}

type Payload = Record<string, unknown>;

const cad = (cents: unknown) =>
  typeof cents === "number" ? `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}` : "$—";
const str = (v: unknown, fallback = "your arrangement") => (typeof v === "string" && v ? v : fallback);

export function buildContent(event: NotificationEvent, p: Payload): NotificationContent {
  const title = str(p.title);
  const auctionPath = typeof p.slug === "string" ? `/auctions/${p.slug}` : "/my-bids";

  switch (event) {
    case "DROP_LIVE":
      return {
        subject: "Today's blooms just dropped 🌸",
        heading: "The 9 AM drop is live.",
        body: "A fresh batch of arrangements is up for auction. First look goes to the early birds — bidding's open all day.",
        ctaLabel: "See today's drop",
        ctaPath: "/",
        pushTitle: "Today's drop is live 🌸",
        pushBody: "Fresh arrangements, open for bids until this evening.",
        smsText: "BloomBid: today's drop is live. Bid all day at",
      };
    case "OUTBID":
      return {
        subject: `Outbid on ${title} — it stings, we know`,
        heading: `Someone topped you at ${cad(p.priceCents)}.`,
        body: `${title} has a new high bidder. One tap puts you back on top — or set a max bid and let us do the fighting.`,
        ctaLabel: "Reclaim the lead",
        ctaPath: auctionPath,
        pushTitle: `Outbid — ${title}`,
        pushBody: `Now at ${cad(p.priceCents)}. Tap to bid back.`,
        smsText: `BloomBid: outbid on ${title} at ${cad(p.priceCents)}. Bid back:`,
      };
    case "MAX_BID_REACHED":
      return {
        subject: `Your max bid on ${title} was passed`,
        heading: "Bidding sailed past your ceiling.",
        body: `${title} is now above your max bid of ${cad(p.priceCents)}. Raise it if you're still in — flowers wait for no one.`,
        ctaLabel: "Raise my max",
        ctaPath: auctionPath,
        pushTitle: `Max bid passed — ${title}`,
        pushBody: `Now above your ceiling. Tap to raise it.`,
        smsText: `BloomBid: bidding on ${title} passed your max.`,
      };
    case "CLOSING_SOON":
      return {
        subject: `30 minutes left on ${title}`,
        heading: "Half an hour to close.",
        body: `${title} closes soon and you're in the mix. A late bid extends the clock — but why cut it close?`,
        ctaLabel: "Check the auction",
        ctaPath: auctionPath,
        pushTitle: `30 min left — ${title}`,
        pushBody: "Closing soon. You're in this one.",
        smsText: `BloomBid: 30 min left on ${title}.`,
      };
    case "WON": {
      const total = cad(p.totalCents);
      return {
        subject: `You won ${title} 🎉 — now, where do they work?`,
        heading: "The blooms are yours.",
        body: `Your card was charged ${total} (${cad(p.subtotalCents)} + ${cad(
          typeof p.gstCents === "number" && typeof p.pstCents === "number"
            ? p.gstCents + p.pstCents
            : undefined,
        )} GST/PST). Next: tell us the workplace and we'll handle the rest — flowers, note, delivery, the good part.`,
        ctaLabel: "Set up delivery",
        ctaPath: "/my-orders",
        pushTitle: `You won ${title} 🎉`,
        pushBody: `Charged ${total}. Tap to set up delivery.`,
        smsText: `BloomBid: you WON ${title} for ${total}! Set delivery details:`,
      };
    }
    case "LOST":
      return {
        subject: `${title} went for ${cad(p.amountCents)}`,
        heading: "Not this time.",
        body: `${title} sold at ${cad(p.amountCents)}. Tomorrow's drop lands at 9 AM — set a max bid early and let it fight for you.`,
        ctaLabel: "See tomorrow's odds",
        ctaPath: "/",
        pushTitle: `Outbid at the wire — ${title}`,
        pushBody: `Went for ${cad(p.amountCents)}. Tomorrow, 9 AM.`,
        smsText: `BloomBid: ${title} went for ${cad(p.amountCents)}.`,
      };
    case "PAYMENT_FAILED":
      return {
        subject: "Your card didn't go through — 2 hours to fix it",
        heading: "Quick — your win is on hold.",
        body: "We couldn't charge your saved card. Update it within 2 hours and we'll retry automatically; otherwise the arrangement goes to the next bidder.",
        ctaLabel: "Fix my card",
        ctaPath: "/account/payment/new",
        pushTitle: "Payment failed — 2h to fix",
        pushBody: "Update your card and we'll retry automatically.",
        smsText: "BloomBid: payment failed. Fix your card within 2h:",
      };
    case "SECOND_CHANCE_OFFER":
      return {
        subject: `${title} can still be yours — at your bid`,
        heading: "Plot twist: it's back on the table.",
        body: `The winner's payment fell through. ${title} is yours at your top bid of ${cad(
          p.amountCents,
        )} — say the word within 3 hours.`,
        ctaLabel: "Take it or pass",
        ctaPath: "/my-orders",
        pushTitle: `Second chance — ${title}`,
        pushBody: `Yours at ${cad(p.amountCents)} if you want it. 3-hour window.`,
        smsText: `BloomBid: ${title} is yours at ${cad(p.amountCents)} if you accept within 3h:`,
      };
    case "DELIVERY_DETAILS_REMINDER":
      return {
        subject: "Your flowers need an address 🌷",
        heading: "One thing left: where do they work?",
        body: "Your win is paid and waiting on delivery details. Two minutes now saves a wilted tomorrow.",
        ctaLabel: "Add delivery details",
        ctaPath: "/my-orders",
        pushTitle: "Where should the flowers go?",
        pushBody: "Your win still needs delivery details.",
        smsText: "BloomBid: your win needs delivery details:",
      };
    case "DELIVERY_SCHEDULED":
      return {
        subject: `${title} is scheduled for delivery`,
        heading: "It's on the books.",
        body: `${title} is prepped and scheduled. We'll ping you the moment it's out the door.`,
        ctaLabel: "Track it",
        ctaPath: "/my-orders",
        pushTitle: "Delivery scheduled",
        pushBody: `${title} is on the schedule.`,
        smsText: `BloomBid: ${title} delivery scheduled.`,
      };
    case "OUT_FOR_DELIVERY":
      return {
        subject: `${title} is out for delivery 🚗`,
        heading: "Flowers in motion.",
        body: `${title} just left with the driver. Somebody's about to have a very good day at work.`,
        ctaLabel: "Follow along",
        ctaPath: "/my-orders",
        pushTitle: "Out for delivery 🚗",
        pushBody: `${title} is on its way.`,
        smsText: `BloomBid: ${title} is out for delivery.`,
      };
    case "DELIVERED":
      return {
        subject: `Delivered ✨ (photo inside)`,
        heading: "Mission accomplished.",
        body: `${title} made it — photo attached to prove the smile. Feel free to take all the credit.`,
        ctaLabel: "See the moment",
        ctaPath: "/my-orders",
        pushTitle: "Delivered ✨",
        pushBody: `${title} landed. Tap for the photo.`,
        smsText: `BloomBid: ${title} delivered! Photo:`,
      };
    case "DELIVERY_FAILED":
      return {
        subject: "Delivery hit a snag — two ways forward",
        heading: "We couldn't complete the handoff.",
        body: "The driver couldn't deliver (details and photo inside). Choose re-delivery next business day (+$10) or same-day pickup — your call.",
        ctaLabel: "Choose an option",
        ctaPath: "/my-orders",
        pushTitle: "Delivery issue — action needed",
        pushBody: "Pick re-delivery or pickup.",
        smsText: "BloomBid: delivery failed. Choose redelivery or pickup:",
      };
    case "LAST_CHANCE":
      return {
        subject: `${title} — last chance at the starting price`,
        heading: "It didn't sell. Your move.",
        body: `${title} is open for buy-now at the start price until 11:59 PM tonight. First tap takes it.`,
        ctaLabel: "Buy it now",
        ctaPath: auctionPath,
        pushTitle: `Last chance — ${title}`,
        pushBody: "Buy-now at start price until midnight.",
        smsText: `BloomBid: last chance on ${title} at start price tonight.`,
      };
  }
}
