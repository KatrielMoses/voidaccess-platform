"use client";

import { useEffect, useState } from "react";
import { visitProps } from "@/lib/attribution";
import { getConsent, initFirstTouch, setConsent, track } from "@/lib/analytics";
import { privacyNotice } from "@content/consent";

let visitSent = false;

/**
 * Captures first-touch attribution and sends the `site_visit` event to Plausible. Attribution is only
 * written to localStorage after the visitor agrees; until then it lives in memory for this visit.
 */
export function Attribution() {
  const [ask, setAsk] = useState(false);

  useEffect(() => {
    const touch = initFirstTouch();
    if (!visitSent) {
      visitSent = true;
      track("site_visit", visitProps(touch));
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads client-only storage after mount
    setAsk(getConsent() === null);
  }, []);

  if (!ask) return null;
  const choose = (v: "granted" | "denied") => {
    setConsent(v);
    setAsk(false);
  };
  return (
    <div
      role="region"
      aria-label={privacyNotice.label}
      className="fixed bottom-4 left-4 right-4 z-50 max-w-md rounded-xl border border-border-strong bg-raised p-4 text-sm shadow-2xl sm:right-auto"
    >
      <p className="leading-relaxed text-fg-secondary">{privacyNotice.text}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => choose("granted")} className="min-h-11 rounded-lg bg-accent px-4 font-semibold text-fg-inverse hover:bg-white">
          {privacyNotice.accept}
        </button>
        <button type="button" onClick={() => choose("denied")} className="min-h-11 rounded-lg border border-border-strong px-4 font-semibold hover:bg-accent-dim">
          {privacyNotice.decline}
        </button>
      </div>
    </div>
  );
}
