// The ONE parser for first-touch attribution. P1 (site) writes the `va_ft` cookie; its exact shape may change,
// so everything that reads attribution goes through parseAttribution().
import type { FirstTouch } from "@voidaccess/db/schema";

export const FIRST_TOUCH_COOKIE = "va_ft";
const MAX = 200;
const clip = (v: unknown) => (typeof v === "string" && v.length > 0 ? v.slice(0, MAX) : undefined);

type Source = Record<string, unknown>;

function fromObject(o: Source): FirstTouch | null {
  const utm: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k.startsWith("utm_")) {
      const c = clip(v);
      if (c) utm[k] = c;
    }
  }
  if (o.utm && typeof o.utm === "object") {
    for (const [k, v] of Object.entries(o.utm as Source)) {
      const c = clip(v);
      if (c) utm[k.startsWith("utm_") ? k : `utm_${k}`] = c;
    }
  }
  const ref = clip(o.ref);
  const landing = clip(o.landing);
  const at = clip(o.at);
  if (!Object.keys(utm).length && !ref && !landing) return null;
  return {
    ...(Object.keys(utm).length ? { utm } : {}),
    ...(ref ? { ref } : {}),
    ...(landing ? { landing } : {}),
    at: at ?? new Date().toISOString(),
  };
}

/** Cookie value (JSON, possibly URL-encoded) first, then query params (utm_*, ref). */
export function parseAttribution(input: {
  cookie?: string | null;
  query?: URLSearchParams | Record<string, string | undefined> | null;
}): FirstTouch | null {
  if (input.cookie) {
    try {
      const raw =
        input.cookie.startsWith("%7B") || input.cookie.startsWith("%7b")
          ? decodeURIComponent(input.cookie)
          : input.cookie;
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object") {
        const ft = fromObject(parsed as Source);
        if (ft) return ft;
      }
    } catch {
      /* fall through to query params */
    }
  }
  if (input.query) {
    const o: Source =
      input.query instanceof URLSearchParams ? Object.fromEntries(input.query.entries()) : { ...input.query };
    return fromObject(o);
  }
  return null;
}
