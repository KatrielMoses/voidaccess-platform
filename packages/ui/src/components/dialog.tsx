"use client";

import * as React from "react";
import { Dialog as D } from "radix-ui";
import { cn } from "../lib/cn";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ className, children, ...props }: React.ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" />
      <D.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border-subtle bg-overlay p-6 text-fg shadow-2xl shadow-black/50 focus:outline-none",
          className,
        )}
        {...props}
      >
        {children}
        <D.Close
          aria-label="Close"
          className="absolute top-3 right-3 flex size-8 items-center justify-center rounded text-fg-secondary hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
        >
          ✕
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 flex flex-col gap-1.5", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-6 flex justify-end gap-2", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof D.Title>) {
  return <D.Title className={cn("font-display text-lg font-semibold", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: React.ComponentProps<typeof D.Description>) {
  return <D.Description className={cn("text-sm text-fg-secondary", className)} {...props} />;
}
