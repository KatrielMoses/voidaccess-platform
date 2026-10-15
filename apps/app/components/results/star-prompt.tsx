"use client";
import { useState } from "react";
import { Button, buttonVariants, cn } from "@voidaccess/ui";

/** Small, non-blocking, dismissible: shown on a finished investigation's results until the user dismisses it once. */
export function StarPrompt({ href }: { href: string }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const dismiss = () => {
    setOpen(false);
    void fetch("/api/account/star-prompt", { method: "DELETE" }).catch(() => {});
  };
  return (
    <aside
      data-testid="star-prompt"
      aria-label="Support VoidAccess"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-5 py-3.5 text-[14px]"
    >
      <p className="text-dim">
        Found this useful? The engine is open source, and a star on GitHub helps other people find it.
      </p>
      <div className="flex items-center gap-2">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={dismiss}
          className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
        >
          Star on GitHub
        </a>
        <Button variant="ghost" size="sm" onClick={dismiss} aria-label="Dismiss">
          Dismiss
        </Button>
      </div>
    </aside>
  );
}
