"use client";

import * as React from "react";
import { Checkbox as C } from "radix-ui";
import { cn } from "../lib/cn";

export function Checkbox({ className, ...props }: React.ComponentProps<typeof C.Root>) {
  return (
    <C.Root
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded border border-border-strong bg-surface transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent",
        className,
      )}
      {...props}
    >
      <C.Indicator className="text-xs leading-none font-bold text-fg-inverse">
        {props.checked === "indeterminate" ? "–" : "✓"}
      </C.Indicator>
    </C.Root>
  );
}
