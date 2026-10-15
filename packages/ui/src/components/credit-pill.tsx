import * as React from "react";
import { cn } from "../lib/cn";

export interface CreditPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Credit balance to display. Supplied by the caller; never hard-coded here. */
  balance: number;
  label?: string;
}

/** A copy-chip-shaped readout (design.md §6): 36px, 1px `line` border, mono value with tabular numerals. */
export function CreditPill({ balance, label = "credits", className, ...props }: CreditPillProps) {
  return (
    <span
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-sm border border-line px-3 font-mono text-[13px] leading-none whitespace-nowrap transition-[border-color] duration-300 hover:border-line-2",
        className,
      )}
      {...props}
    >
      <span className="text-paper tabular-nums">{balance.toLocaleString("en-US")}</span>
      <span className="text-mute">{label}</span>
    </span>
  );
}
