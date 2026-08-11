import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Placeholder landing — the real live grid ships with the auction engine
 * (build order step 3) and gets its polish pass in step 8.
 */
export default function HomePage() {
  return (
    <div className="py-16 text-center">
      <h1 className="mx-auto max-w-2xl font-display text-5xl leading-tight text-forest">
        One drop a day.
        <br />
        The best bid takes the blooms.
      </h1>
      <p className="mx-auto mt-6 max-w-md text-lg text-charcoal/70">
        Every morning at 9, a small batch of arrangements goes up for auction.
        Win one, and we hand-deliver it to their workplace — right here in
        Prince George.
      </p>
      <div className="mt-10 flex items-center justify-center gap-3">
        <Link href="/signin">
          <Button variant="cta" size="lg">
            Get ready to bid
          </Button>
        </Link>
      </div>
      <p className="mt-16 font-display text-xl text-charcoal/50">
        Today&apos;s blooms are still in the cooler. The first drop lands soon.
      </p>
    </div>
  );
}
