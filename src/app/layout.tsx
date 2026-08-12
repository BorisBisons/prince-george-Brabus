import type { Metadata } from "next";
import { Fraunces, Inter } from "next/font/google";
import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  axes: ["opsz", "SOFT", "WONK"],
});
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "BloomBid — daily flower auctions, Prince George", template: "%s · BloomBid" },
  description:
    "One batch of arrangements drops every morning. Bid all day. Win, and we hand-deliver to their workplace in Prince George.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const { getKillSwitch } = await import("@/lib/kill-switch");
  const killSwitch = await getKillSwitch().catch(() => ({ active: false, banner: null }));

  return (
    <html lang="en" className={`${fraunces.variable} ${inter.variable}`}>
      <body className="relative min-h-screen">
        {killSwitch.active && (
          <div role="status" className="relative z-20 bg-rose px-4 py-2.5 text-center text-sm font-medium text-charcoal">
            {killSwitch.banner ?? "Auctions are paused — standing bids are preserved."}
          </div>
        )}
        <header className="relative z-10 bg-forest text-cream">
          <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
            <Link
              href="/"
              className="font-display text-2xl tracking-wide text-gold"
              aria-label="BloomBid home"
            >
              BloomBid
            </Link>
            <nav className="flex items-center gap-2 text-sm">
              {session?.user ? (
                <>
                  <Link href="/my-bids" className="rounded px-3 py-2 hover:bg-white/10">
                    My bids
                  </Link>
                  <Link href="/my-orders" className="rounded px-3 py-2 hover:bg-white/10">
                    Orders
                  </Link>
                  <Link href="/account" className="rounded px-3 py-2 hover:bg-white/10">
                    Account
                  </Link>
                  <form
                    action={async () => {
                      "use server";
                      await signOut({ redirectTo: "/" });
                    }}
                  >
                    <Button variant="ghost" size="sm" className="text-cream hover:bg-white/10">
                      Sign out
                    </Button>
                  </form>
                </>
              ) : (
                <Link
                  href="/signin"
                  className="rounded bg-rose px-4 py-2 font-semibold text-charcoal hover:bg-rose-deep"
                >
                  Sign in
                </Link>
              )}
            </nav>
          </div>
        </header>
        <main className="relative z-10 mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</main>
        <footer className="relative z-10 mt-16 border-t border-forest/10 py-8 text-center text-sm text-charcoal/60">
          <p>Grown-up romance, delivered in Prince George.</p>
          <p className="mt-2 space-x-3">
            {[
              ["/about", "About"],
              ["/faq", "FAQ"],
              ["/terms", "Terms"],
              ["/privacy", "Privacy"],
            ].map(([href, label]) => (
              <Link key={href} href={href!} className="underline-offset-2 hover:text-forest hover:underline">
                {label}
              </Link>
            ))}
          </p>
        </footer>
      </body>
    </html>
  );
}
