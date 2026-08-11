"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RunSheetCard, useOfflineFlush, type StopData } from "@/components/run-sheet-card";

export function RunSheetView({ stops, routeStarted }: { stops: StopData[]; routeStarted: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const refresh = React.useCallback(() => router.refresh(), [router]);
  useOfflineFlush(refresh);

  async function control(action: "start" | "reroute") {
    setBusy(true);
    await fetch("/api/admin/run-sheet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => {});
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {!routeStarted && stops.length > 0 && (
          <Button variant="cta" size="lg" className="flex-1" disabled={busy} onClick={() => control("start")}>
            Start route ({stops.length} stops)
          </Button>
        )}
        <Button variant="outline" disabled={busy} onClick={() => control("reroute")}>
          Re-sort
        </Button>
      </div>
      {stops.length === 0 ? (
        <p className="rounded-card bg-white p-8 text-center text-charcoal/60 shadow-lift">
          Nothing to deliver today. Enjoy the quiet — tomorrow&apos;s winners are bidding right now.
        </p>
      ) : (
        stops.map((stop) => <RunSheetCard key={stop.deliveryId} stop={stop} />)
      )}
    </div>
  );
}
