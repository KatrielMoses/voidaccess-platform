"use client";

import * as React from "react";
import { Dialog as D } from "radix-ui";
import { cn } from "../lib/cn";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

/** Raised ink (bg-2) on a dimmed field; hairline border, 6px radius, no shadow. */
export function DialogContent({ className, children, ...props }: React.ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-40 bg-bg/80 backdrop-blur-[6px] data-[state=open]:animate-[va-fade-in_.4s_cubic-bezier(.16,1,.3,1)]" />
      <D.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2.75rem)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line-2 bg-bg-2 p-7 text-paper focus:outline-none data-[state=open]:animate-[va-dialog-in_.6s_cubic-bezier(.16,1,.3,1)] max-[960px]:p-6",
          className,
        )}
        {...props}
      >
        {children}
        <D.Close
          aria-label="Close"
          className="absolute top-4 right-4 flex size-8 items-center justify-center rounded-xs text-mute transition-colors duration-300 hover:bg-paper/[.04] hover:text-paper"
        >
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-5 flex flex-col gap-2 pr-8", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-7 flex flex-wrap justify-end gap-2.5", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof D.Title>) {
  return (
    <D.Title
      className={cn("text-[23px] leading-[1.15] font-medium tracking-[-0.025em] text-paper", className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }: React.ComponentProps<typeof D.Description>) {
  return <D.Description className={cn("text-[15px] leading-[1.55] text-dim", className)} {...props} />;
}
