/** First-touch attribution. Pure helpers (no storage access) so they can be unit tested. */
export interface Touch {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  ref?: string;
  referrer?: string;
  landing_path?: string;
  ts?: string;
}

const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
const clip = (v: string) => v.trim().slice(0, 200);

export function touchFromLocation(href: string, referrer: string, now: Date): Touch {
  const url = new URL(href);
  const t: Touch = { landing_path: url.pathname, ts: now.toISOString() };
  for (const k of UTM) {
    const v = url.searchParams.get(k);
    if (v) t[k] = clip(v);
  }
  const ref = url.searchParams.get("ref");
  if (ref) t.ref = clip(ref);
  if (referrer) {
    try {
      const r = new URL(referrer);
      if (r.host !== url.host) t.referrer = clip(r.host);
    } catch {
      // ignore malformed referrer
    }
  }
  return t;
}

/** Props for the Plausible `site_visit` event: attribution fields only, never the email or anything personal. */
export function visitProps(t: Touch): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of [...UTM, "ref", "referrer", "landing_path"] as const) {
    const v = t[k];
    if (v) out[k] = v;
  }
  return out;
}
