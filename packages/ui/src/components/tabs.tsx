"use client";

import * as React from "react";
import { Tabs as T } from "radix-ui";
import { cn } from "../lib/cn";

export const Tabs = T.Root;

export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return (
    <T.List
      className={cn("inline-flex items-center gap-1 border-b border-border-subtle", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "-mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium text-fg-secondary transition-colors hover:text-fg focus-visible:outline-2 focus-visible:outline-accent data-[state=active]:border-accent data-[state=active]:text-fg",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof T.Content>) {
  return (
    <T.Content
      className={cn("pt-4 focus-visible:outline-2 focus-visible:outline-accent", className)}
      {...props}
    />
  );
}
