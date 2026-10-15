"use client";

import * as React from "react";
import { Checkbox as C } from "radix-ui";
import { cn } from "../lib/cn";

/** Hairline square; checked is a paper fill with an ink tick. No violet: a checkbox is not the signal. */
export function Checkbox({ className, ...props }: React.ComponentProps<typeof C.Root>) {
  return (
    <C.Root
      className={cn(
        "flex size-[18px] shrink-0 items-center justify-center rounded-xs border border-line-3 bg-transparent transition-[background-color,border-color] duration-300 ease-out hover:border-paper disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-paper data-[state=checked]:bg-paper data-[state=indeterminate]:border-paper data-[state=indeterminate]:bg-paper",
        className,
      )}
      {...props}
    >
      <C.Indicator className="flex items-center justify-center text-ink">
        {props.checked === "indeterminate" ? (
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
            <path d="M3 6h6" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
            <path d="M2.5 6.2 5 8.6l4.6-5.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        )}
      </C.Indicator>
    </C.Root>
  );
}
