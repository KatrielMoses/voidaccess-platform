"use client";

import { useEffect, useRef } from "react";
import { CloseButton } from "./ui";

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
      {modal ? <div aria-hidden className="absolute inset-0 bg-bg/70" onClick={onClose} /> : null}
      <div
        ref={panel}
        role="dialog"
        aria-modal={modal}
        aria-label={title}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-[30rem] flex-col overflow-y-auto border-l border-line bg-bg-2 px-6 py-6 outline-none sm:px-7"
      >
        <div className="mb-6 flex items-start justify-between gap-3 border-b border-line pb-4">
          <h2 className="text-[20px] leading-tight font-medium tracking-[-0.02em] break-words">{title}</h2>
          <CloseButton onClick={onClose} label="Close panel" />
        </div>
        {children}
      </div>
    </div>
  );
}
