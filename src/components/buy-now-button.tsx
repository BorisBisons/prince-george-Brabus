"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatCad } from "@/lib/utils";

export function BuyNowButton({ auctionId, priceCents }: { auctionId: string; priceCents: number }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auctions/${auctionId}/buy-now`, { method: "POST" });
      const data = await res.json();
      if (res.status === 401) {
        router.push("/signin");
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "That didn't work — try again.");
        return;
      }
      router.push("/my-orders?bought=1");
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button variant="cta" size="lg" className="w-full" disabled={busy} onClick={onClick}>
        {busy ? "Snagging it…" : `Buy now for ${formatCad(priceCents)} + tax`}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-charcoal/70">
          {error}
        </p>
      )}
    </div>
  );
}
