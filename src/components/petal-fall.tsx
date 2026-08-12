"use client";

import * as React from "react";

/**
 * Falling rose petals for win moments (spec §3: petals, not confetti dots).
 * Pure CSS animation, removed after one pass; respects prefers-reduced-motion
 * via the global media query that zeroes animation durations.
 */
export function PetalFall({ count = 18 }: { count?: number }) {
  const [done, setDone] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setDone(true), 6500);
    return () => clearTimeout(t);
  }, []);
  if (done) return null;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
      {Array.from({ length: count }, (_, i) => {
        const left = (i * 137.5) % 100; // golden-angle spread
        const delay = (i % 9) * 0.45;
        const duration = 3.6 + (i % 5) * 0.7;
        const size = 12 + (i % 4) * 4;
        return (
          <span
            key={i}
            className="petal absolute"
            style={{
              left: `${left}%`,
              top: -24,
              width: size,
              height: size * 0.85,
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
            }}
          />
        );
      })}
    </div>
  );
}
