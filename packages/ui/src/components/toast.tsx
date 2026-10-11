"use client";

import * as React from "react";
import { Toast as T } from "radix-ui";
import { cn } from "../lib/cn";

export type ToastVariant = "default" | "success" | "danger" | "warning";

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** ms; default 5000 */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

const ToastContext = React.createContext<{ toast: (t: ToastInput) => void } | null>(null);

const accentBar: Record<ToastVariant, string> = {
  default: "before:bg-accent",
  success: "before:bg-success",
  danger: "before:bg-danger",
  warning: "before:bg-warning",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const nextId = React.useRef(0);

  const toast = React.useCallback((t: ToastInput) => {
    nextId.current += 1;
    const id = nextId.current;
    setItems((prev) => [...prev, { ...t, id }]);
  }, []);

  const value = React.useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      <T.Provider swipeDirection="right">
        {children}
        {items.map((item) => (
          <T.Root
            key={item.id}
            duration={item.duration ?? 5000}
            onOpenChange={(open) => {
              if (!open) setItems((prev) => prev.filter((i) => i.id !== item.id));
            }}
            className={cn(
              "relative flex items-start gap-3 overflow-hidden rounded-lg border border-border-subtle bg-overlay p-4 pl-5 text-fg shadow-xl shadow-black/40 before:absolute before:inset-y-0 before:left-0 before:w-1",
              accentBar[item.variant ?? "default"],
            )}
          >
            <div className="flex-1">
              <T.Title className="text-sm font-medium">{item.title}</T.Title>
              {item.description ? (
                <T.Description className="mt-1 text-sm text-fg-secondary">{item.description}</T.Description>
              ) : null}
            </div>
            <T.Close
              aria-label="Dismiss"
              className="text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
            >
              ✕
            </T.Close>
          </T.Root>
        ))}
        <T.Viewport className="fixed right-4 bottom-4 z-[100] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
      </T.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
