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
      className="fixed bottom-4 left-4 right-4 z-50 max-w-md rounded-lg border border-line-2 bg-bg-2 p-5 sm:bottom-6 sm:left-6 sm:right-auto"
    >
      <p className="text-[15px] leading-normal text-dim">{privacyNotice.text}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={() => choose("granted")} className="va-btn va-btn-light">
          <span>{privacyNotice.accept}</span>
        </button>
        <button type="button" onClick={() => choose("denied")} className="va-btn va-btn-line">
          <span>{privacyNotice.decline}</span>
        </button>
      </div>
    </div>
  );
}
