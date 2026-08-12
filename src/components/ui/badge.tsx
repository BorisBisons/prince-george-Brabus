import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-3 py-0.5 text-xs font-semibold",
  {
    variants: {
      variant: {
        forest: "bg-forest/10 text-forest",
        rose: "bg-rose-wash text-charcoal",
        neutral: "bg-charcoal/5 text-charcoal/70",
        // gold is reserved for winning states
        winning: "bg-gold/15 text-gold-deep",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
