"use client";

import { cn } from "@voidaccess/ui";
import { UnlockPanel } from "./unlock-panel";
import { usePreview } from "./preview-context";

/**
 * Placeholders for locked content. The server sends filler ("█" runs whose length is a hash of a seed, never of the
 * real value); the UI draws a soft grey bar of about that length and never prints the filler. Nothing here hides real
 * data: there is none to hide.
 */
export function LockedBar({ text, className }: { text?: string | null; className?: string }) {
  const len = Math.min(Math.max(text?.length ?? 14, 6), 32);
  return (
    <span
      aria-hidden
      data-testid="locked-bar"
      className={cn(
        "inline-block h-[0.7em] max-w-full rounded-xs bg-paper/[0.12] align-middle blur-[1.5px]",
        className,
      )}
      style={{ width: `${len}ch` }}
    />
  );
}

/** 3-5 placeholder lines under the visible summary sentences. */
export function LockedLines({ count = 4, seed = 0 }: { count?: number; seed?: number }) {
  const widths = [96, 88, 92, 71, 84, 63];
  return (
    <div aria-hidden className="flex flex-col gap-3.5 py-1" data-testid="locked-lines">
      {Array.from({ length: Math.min(Math.max(count, 3), 5) }, (_, i) => (
        <span
          key={i}
          className="block h-3 rounded-xs bg-paper/[0.10] blur-[2px]"
          style={{ width: `${widths[(i + seed) % widths.length]}%` }}
        />
      ))}
    </div>
  );
}

/**
 * A locked stretch of the report with the unlock panel over it: the placeholders stay visible (greyed and blurred)
 * around the panel, so the reader sees how much is there.
 */
export function LockedRegion({
  children,
  origin,
  className,
  minHeight = "26rem",
}: {
  children: React.ReactNode;
  origin: string;
  className?: string;
  minHeight?: string;
}) {
  const p = usePreview();
  return (
    <div className={cn("relative", className)} style={{ minHeight }} data-testid={`locked-region-${origin}`}>
      <div
        aria-hidden
        className="pointer-events-none select-none opacity-60 [mask-image:linear-gradient(to_bottom,black_55%,transparent)]"
      >
        {children}
      </div>
      <div className="absolute inset-x-0 top-6 flex justify-center px-3">
        <UnlockPanel
          investigationId={p.investigationId}
          totals={p.totals}
          offer={p.offer}
          origin={origin}
          failed={p.failed}
        />
      </div>
    </div>
  );
}

/** "2 of 38 shown": the section's full size next to what the preview shows. */
export function ShownOf({ shown, total, noun }: { shown: number; total: number; noun: string }) {
  return (
    <p className="font-mono text-[12px] text-mute tabular-nums" data-testid="preview-shown-of">
      {shown.toLocaleString("en-US")} of {total.toLocaleString("en-US")} {noun} shown
    </p>
  );
}
