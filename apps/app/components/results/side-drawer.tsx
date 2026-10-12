"use client";

import { useEffect, useRef } from "react";

/** Minimal accessible right-hand drawer: Esc and overlay close it, focus moves in and returns on close. */
export function SideDrawer({
  open,
  onClose,
  title,
  children,
  modal = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  modal?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    returnTo.current = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      returnTo.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end" data-testid="drawer">
      {modal ? <div aria-hidden className="absolute inset-0 bg-black/60" onClick={onClose} /> : null}
      <div
        ref={panel}
        role="dialog"
        aria-modal={modal}
        aria-label={title}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border-subtle bg-overlay p-5 shadow-2xl shadow-black/60 outline-none"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-semibold break-words">{title}</h2>
          <button
            type="button"
            aria-label="Close panel"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded text-fg-secondary hover:bg-raised hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
