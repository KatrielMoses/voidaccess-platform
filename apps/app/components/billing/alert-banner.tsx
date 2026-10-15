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
      className="border-b border-line bg-bg-2 text-[15px] text-paper"
    >
      <div className="va-wrap flex flex-wrap items-center gap-x-5 gap-y-1.5 py-3">
        <span aria-hidden className="font-mono text-[12px] text-paper">
          !
        </span>
        <span className={state.level === "credits_80" ? "text-dim" : "text-paper"}>{message}</span>
        <span className="flex items-center gap-4">
          {state.level === "past_due" ? (
            <Link href="/billing" className="va-link">
              {copy.alerts.updatePayment}
            </Link>
          ) : (
            <>
              <Link href="/billing?from=alert#topups" className="va-link" data-testid="alert-topup">
                {copy.alerts.topUp}
              </Link>
              <Link href="/billing?from=alert" className="va-link" data-testid="alert-upgrade">
                {copy.alerts.upgrade}
              </Link>
            </>
          )}
        </span>
        <button
          type="button"
          aria-label={copy.alerts.dismiss}
          className="ml-auto flex size-8 items-center justify-center rounded-xs text-mute transition-colors duration-300 hover:text-paper"
          onClick={() => {
            window.sessionStorage.setItem(`va:alert:${state.key}:${state.level}`, "1");
            setHidden(true);
          }}
        >
          <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
      </div>
    </div>
  );
}
