"use client";

import { useState } from "react";
import { cn } from "@voidaccess/ui";

/** Copy to clipboard; `label` is read by screen readers (e.g. "Copy masked value"). */
export function CopyButton({
  text,
  label = "Copy",
  className,
  tab = false,
}: {
  text: string;
  label?: string;
  className?: string;
  /** the small "Copy" tab at the end of a copy chip (design.md §6) */
  tab?: boolean;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable: nothing to do */
        }
      }}
      className={cn(
        "inline-flex min-w-[3.75rem] shrink-0 items-center justify-center px-2 font-mono text-[12px] text-dim transition-colors duration-300 hover:text-paper",
        tab
          ? "rounded-r-[3px] border-l border-line bg-paper/[0.06]"
          : "h-7 rounded-xs border border-line hover:border-line-2",
        className,
      )}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** Text that is never a link, with a copy button: used for source URLs, including .onion addresses. */
export function CopyOnlyUrl({ url }: { url: string }) {
  return (
    <span className="flex items-stretch rounded-sm border border-line">
      <code
        className="min-w-0 flex-1 px-2.5 py-1.5 font-mono text-[12.5px] leading-snug break-all text-dim"
        data-testid="source-url"
      >
        {url}
      </code>
      <CopyButton text={url} label="Copy source URL" tab />
    </span>
  );
}
