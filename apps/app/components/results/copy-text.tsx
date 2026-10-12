"use client";

import { useState } from "react";
import { cn } from "@voidaccess/ui";

/** Copy to clipboard; `label` is read by screen readers (e.g. "Copy masked value"). */
export function CopyButton({
  text,
  label = "Copy",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
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
        "inline-flex h-7 shrink-0 items-center rounded border border-border-subtle px-2 text-xs text-fg-secondary hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent",
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
    <span className="flex items-start gap-2">
      <code
        className="min-w-0 flex-1 break-all rounded bg-void px-2 py-1 font-mono text-xs text-fg-secondary"
        data-testid="source-url"
      >
        {url}
      </code>
      <CopyButton text={url} label="Copy source URL" />
    </span>
  );
}
