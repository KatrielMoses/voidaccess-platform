import * as React from "react";
import { cn } from "../lib/cn";

export interface CreditPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Credit balance to display. Supplied by the caller; never hard-coded here. */
  balance: number;
  label?: string;
}

export function CreditPill({ balance, label = "credits", className, ...props }: CreditPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-accent-border bg-accent-dim px-3 py-1 text-sm text-accent",
        className,
      )}
      {...props}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-accent" />
      <span className="font-mono font-medium tabular-nums">{balance.toLocaleString("en-US")}</span>
      <span className="text-fg-secondary">{label}</span>
    </span>
  );
}
