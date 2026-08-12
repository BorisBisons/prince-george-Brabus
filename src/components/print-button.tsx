"use client";

import { Button } from "@/components/ui/button";

export function PrintButton({ disabled }: { disabled?: boolean }) {
  return (
    <Button variant="cta" disabled={disabled} onClick={() => window.print()}>
      Print / save PDF
    </Button>
  );
}
