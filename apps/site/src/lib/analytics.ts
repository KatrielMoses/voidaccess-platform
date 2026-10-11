"use client";

import { touchFromLocation, type Touch } from "./attribution";

type Plausible = ((name: string, opts?: { props?: Record<string, string> }) => void) & { q?: unknown[] };
declare global {
  interface Window {
    plausible?: Plausible;
  }
}

const KEY = "va_first_touch";
const CONSENT = "va_attribution_consent";

let memoryTouch: Touch | undefined;

/** Queue-safe: works before the Plausible script has loaded, and is a no-op in dev (script isn't loaded). */
export function track(name: string, props?: Record<string, string>) {
  if (typeof window === "undefined") return;
  const p: Plausible = (window.plausible ??= Object.assign(
    function (...args: unknown[]) {
      (p.q ??= []).push(args);
    } as Plausible,
    {},
  ));
  p(name, props ? { props } : undefined);
}

export function getConsent(): "granted" | "denied" | null {
  try {
    const v = localStorage.getItem(CONSENT);
    return v === "granted" || v === "denied" ? v : null;
  } catch {
    return null;
  }
}

export function setConsent(v: "granted" | "denied") {
  try {
    localStorage.setItem(CONSENT, v);
    if (v === "granted" && memoryTouch) localStorage.setItem(KEY, JSON.stringify(memoryTouch));
    if (v === "denied") localStorage.removeItem(KEY);
  } catch {
    // storage unavailable: attribution stays in memory only
  }
}

/**
 * First touch for this visitor: the stored one if they consented earlier, else the one captured in
 * memory on landing. Persisted to first-party localStorage only after consent.
 */
export function initFirstTouch(): Touch {
  if (memoryTouch) return memoryTouch;
  let stored: Touch | undefined;
  if (getConsent() === "granted") {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) stored = JSON.parse(raw) as Touch;
    } catch {
      stored = undefined;
    }
  }
  memoryTouch = stored ?? touchFromLocation(location.href, document.referrer, new Date());
  if (!stored && getConsent() === "granted") setConsent("granted");
  return memoryTouch;
}

export function getFirstTouch(): Touch {
  return initFirstTouch();
}
