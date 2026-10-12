"use client";

import Link from "next/link";
import { useState } from "react";
import { billingCopy as copy, fill } from "@/content/billing";

export interface BannerState {
  level: "credits_80" | "credits_100" | "past_due" | null;
  pct: number;
  resetDate: string;
  /** the period this alert belongs to, so a dismissal only lasts until the next period */
  key: string;
}

/** Non-blocking: one slim banner under the header, dismissible for the rest of the session. */
export function AlertBanner({ state }: { state: BannerState }) {
  const [hidden, setHidden] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.sessionStorage.getItem(`va:alert:${state.key}:${state.level}`) === "1",
  );
  if (!state.level || hidden) return null;
  const message =
    state.level === "past_due"
      ? copy.alerts.pastDue
      : state.level === "credits_100"
        ? fill(copy.alerts.b100, { date: state.resetDate })
        : fill(copy.alerts.b80, { pct: state.pct });
  return (
    <div
      role="status"
      data-testid="alert-banner"
      data-level={state.level}
      className={`border-b px-4 py-2 text-sm ${state.level === "credits_80" ? "border-warning/30 bg-warning/10 text-warning" : "border-danger/30 bg-danger/10 text-danger"}`}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 sm:px-2">
        <span className="font-medium">{message}</span>
        <span className="flex items-center gap-3">
          {state.level === "past_due" ? (
            <Link href="/billing" className="underline underline-offset-2">
              {copy.alerts.updatePayment}
            </Link>
          ) : (
            <>
              <Link
                href="/billing?from=alert#topups"
                className="underline underline-offset-2"
                data-testid="alert-topup"
              >
                {copy.alerts.topUp}
              </Link>
              <Link
                href="/billing?from=alert"
                className="underline underline-offset-2"
                data-testid="alert-upgrade"
              >
                {copy.alerts.upgrade}
              </Link>
            </>
          )}
        </span>
        <button
          type="button"
          aria-label={copy.alerts.dismiss}
          className="ml-auto text-lg leading-none opacity-70 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-current"
          onClick={() => {
            window.sessionStorage.setItem(`va:alert:${state.key}:${state.level}`, "1");
            setHidden(true);
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
