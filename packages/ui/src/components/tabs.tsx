"use client";

import * as React from "react";
import { Tabs as T } from "radix-ui";
import { cn } from "../lib/cn";

export const Tabs = T.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return <T.List className={cn("flex items-center gap-7 border-b border-line", className)} {...props} />;
}

/** Dim label; the active tab is paper with a 1px paper rule on the baseline. */
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "relative -mb-px h-11 border-b border-transparent text-[15px] text-dim transition-[color,border-color] duration-300 ease-out hover:text-paper data-[state=active]:border-paper data-[state=active]:text-paper",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof T.Content>) {
  return <T.Content className={cn("pt-6", className)} {...props} />;
}
