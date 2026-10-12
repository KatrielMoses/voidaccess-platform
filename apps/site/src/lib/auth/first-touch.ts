import type { Touch } from "@/lib/attribution";

export interface FirstTouchPayload {
  utm?: Record<string, string>;
  ref?: string;
  landing?: string;
  at?: string;
}

/**
 * First-touch attribution to attach to sign-up. Only what the privacy prompt covers, and only after the visitor
 * said yes: with no consent (or nothing captured) nothing is sent.
 */
export function firstTouchPayload(touch: Touch, consent: "granted" | "denied" | null): FirstTouchPayload | undefined {
  if (consent !== "granted") return undefined;
  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const) {
    const v = touch[k];
    if (v) utm[k] = v;
  }
  const out: FirstTouchPayload = {};
  if (Object.keys(utm).length > 0) out.utm = utm;
  if (touch.ref) out.ref = touch.ref;
  if (touch.landing_path) out.landing = touch.landing_path;
  if (touch.ts) out.at = touch.ts;
  return Object.keys(out).length > 0 ? out : undefined;
}
