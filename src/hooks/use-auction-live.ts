"use client";

import * as React from "react";
import type { AuctionPublicState } from "@/lib/auction/bidding";

/**
 * Live auction state: Pusher when configured, 10s polling otherwise; either
 * way the countdown re-syncs to server time every 30s (server is truth).
 */
export function useAuctionLive(initial: AuctionPublicState) {
  const [state, setState] = React.useState(initial);
  const [clockOffsetMs, setClockOffsetMs] = React.useState(
    () => new Date(initial.serverNow).getTime() - Date.now(),
  );

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch(`/api/auctions/${initial.id}/state`, { cache: "no-store" });
      if (!res.ok) return;
      const next: AuctionPublicState = await res.json();
      setState(next);
      setClockOffsetMs(new Date(next.serverNow).getTime() - Date.now());
    } catch {
      /* transient — next tick will retry */
    }
  }, [initial.id]);

  // Realtime subscription (public payloads only — viewer info comes from refresh)
  React.useEffect(() => {
    const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
    const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;

    if (key && cluster) {
      let disposed = false;
      let cleanup: (() => void) | undefined;
      import("pusher-js").then(({ default: Pusher }) => {
        if (disposed) return;
        const pusher = new Pusher(key, { cluster });
        const channel = pusher.subscribe(`auction-${initial.id}`);
        // Public snapshot keeps price/history fresh; a refresh fills in viewer state.
        channel.bind("bid", (pub: AuctionPublicState) => {
          setState((prev) => ({ ...pub, viewer: prev.viewer }));
          void refresh();
        });
        channel.bind("status", () => void refresh());
        cleanup = () => {
          channel.unbind_all();
          pusher.unsubscribe(`auction-${initial.id}`);
          pusher.disconnect();
        };
      });
      return () => {
        disposed = true;
        cleanup?.();
      };
    }

    // Fallback: poll
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [initial.id, refresh]);

  // Clock re-sync every 30s + when the tab regains focus
  React.useEffect(() => {
    const sync = async () => {
      try {
        const res = await fetch("/api/time", { cache: "no-store" });
        const { now } = await res.json();
        setClockOffsetMs(new Date(now).getTime() - Date.now());
      } catch {
        /* keep last offset */
      }
    };
    const interval = setInterval(sync, 30_000);
    const onFocus = () => {
      void sync();
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const serverNow = React.useCallback(() => Date.now() + clockOffsetMs, [clockOffsetMs]);

  return { state, setState, refresh, serverNow };
}
