import { cn } from "@voidaccess/ui";

type Tone = "live" | "done" | "failed" | "quiet";
const MAP: Record<string, { label: string; tone: Tone }> = {
  reserved: { label: "Queued", tone: "quiet" },
  launching: { label: "Starting", tone: "live" },
  running: { label: "Running", tone: "live" },
  ingesting: { label: "Finishing", tone: "live" },
  completed: { label: "Completed", tone: "done" },
  failed: { label: "Failed", tone: "failed" },
  cancelled: { label: "Cancelled", tone: "quiet" },
};

/**
 * Run status without hue (design.md §3.3): a word plus a small marker.
 * Live = a v-500 dot (the signal); completed = paper tick; failed = hairline-boxed "✕ Failed"; queued/cancelled = mute.
 */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const m = MAP[status] ?? { label: status, tone: "quiet" as Tone };
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex h-6 items-center gap-2 font-mono text-[12.5px] leading-none whitespace-nowrap",
        m.tone === "live" && "text-paper",
        m.tone === "done" && "text-paper",
        m.tone === "quiet" && "text-mute",
        m.tone === "failed" && "rounded-xs border border-line-3 px-2 text-paper",
        className,
      )}
    >
      {m.tone === "live" ? <span aria-hidden className="size-1.5 rounded-full bg-v-500" /> : null}
      {m.tone === "done" ? <span aria-hidden>✓</span> : null}
      {m.tone === "failed" ? <span aria-hidden>✕</span> : null}
      {m.tone === "quiet" ? (
        <span aria-hidden className="size-1.5 rounded-full border border-current" />
      ) : null}
      {m.label}
    </span>
  );
}
