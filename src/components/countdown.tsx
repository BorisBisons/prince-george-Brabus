"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Server-truth countdown. `serverNow` returns the corrected epoch ms; when
 * absent (grid cards) we trust the local clock between page loads.
 * Pulses gently under 5 minutes; announces politely for screen readers.
 */
export function Countdown({
  endAt,
  serverNow,
  className,
  compact = false,
}: {
  endAt: string | null;
  serverNow?: () => number;
  className?: string;
  compact?: boolean;
}) {
  const nowFn = React.useMemo(() => serverNow ?? (() => Date.now()), [serverNow]);
  const [msLeft, setMsLeft] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!endAt) return;
    const end = new Date(endAt).getTime();
    const tick = () => setMsLeft(Math.max(0, end - nowFn()));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [endAt, nowFn]);

  if (!endAt || msLeft === null) return null;

  const total = Math.floor(msLeft / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const closingSoon = msLeft > 0 && msLeft <= 5 * 60_000;
  const text =
    h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;

  return (
    <time
      dateTime={endAt}
      aria-label={msLeft === 0 ? "Auction ended" : `Closes in ${h ? `${h} hours ` : ""}${m} minutes`}
      className={cn(
        "nums font-display",
        closingSoon && "animate-gentle-pulse text-rose-deep",
        className,
      )}
    >
      {msLeft === 0 ? "Closed" : compact ? text : `Closes in ${text}`}
    </time>
  );
}
