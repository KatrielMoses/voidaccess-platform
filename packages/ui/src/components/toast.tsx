"use client";

import * as React from "react";
import { Toast as T } from "radix-ui";
import { cn } from "../lib/cn";

/** Variant names are semantic; there is no hue. A failed action gets a ✕ marker and its words do the rest. */
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

const MARK: Record<ToastVariant, string | null> = { default: null, success: "✓", danger: "✕", warning: "!" };

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
        {items.map((item) => {
          const mark = MARK[item.variant ?? "default"];
          return (
            <T.Root
              key={item.id}
              duration={item.duration ?? 5000}
              onOpenChange={(open) => {
                if (!open) setItems((prev) => prev.filter((i) => i.id !== item.id));
              }}
              className={cn(
                "flex items-start gap-3 rounded-lg border border-line-2 bg-bg-2 px-4 py-3.5 text-paper",
                "data-[state=open]:animate-[va-toast-in_.6s_cubic-bezier(.16,1,.3,1)]",
              )}
            >
              {mark ? (
                <span aria-hidden className="pt-[3px] font-mono text-[12px] leading-5 text-paper">
                  {mark}
                </span>
              ) : null}
              <div className="flex-1">
                <T.Title className="text-[15px] leading-[1.45] font-medium">{item.title}</T.Title>
                {item.description ? (
                  <T.Description className="mt-1 text-[15px] leading-[1.5] text-dim">
                    {item.description}
                  </T.Description>
                ) : null}
              </div>
              <T.Close
                aria-label="Dismiss"
                className="flex size-6 items-center justify-center rounded-xs text-mute transition-colors duration-300 hover:text-paper"
              >
                <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden>
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              </T.Close>
            </T.Root>
          );
        })}
        <T.Viewport className="fixed right-6 bottom-6 z-[100] flex w-[380px] max-w-[calc(100vw-2.75rem)] flex-col gap-2 outline-none max-[960px]:right-[22px] max-[960px]:bottom-[22px]" />
      </T.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
