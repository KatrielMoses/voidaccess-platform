/**
 * Live open-source numbers for the marketing pages: GitHub stars and total PyPI downloads.
 *  - stars: GitHub's own API first (`stargazers_count`), shields.io's badge JSON as the backup (shields sometimes answers
 *    "invalid" for GitHub counts while GitHub is fine);
 *  - downloads: shields.io's pepy badge JSON (pepy's own API needs a key).
 *
 * Caching, three layers, so a page never waits on the network more than once an hour per instance:
 *   1. an in-memory copy per server instance / Worker isolate, kept for an hour (failures are kept for 5 minutes, so a
 *      shields outage doesn't add a timeout to every request);
 *   2. `cf.cacheTtl` puts the subrequest in Cloudflare's edge cache for an hour (Workers; ignored by Node);
 *   3. `next.revalidate` lets Next's data cache keep it for an hour where one is configured (next start).
 * Every fetch has a 1.5 s timeout. Anything unexpected (timeout, non-200, odd JSON) falls back to the committed
 * last-known values below, per number, so the page always shows a real figure.
 */

export const STARS_API_URL = "https://api.github.com/repos/KatrielMoses/VoidAccess";
export const STARS_URL = "https://img.shields.io/github/stars/KatrielMoses/VoidAccess.json";
export const DOWNLOADS_URL = "https://img.shields.io/pepy/dt/voidaccess.json";

/** Last-known values, shown when every live source fails. Checked 2026-10-18. */
export const STATS_FALLBACK = { stars: "802", downloads: "18k" } as const;

export const STATS_TIMEOUT_MS = 1500;
export const STATS_TTL_MS = 60 * 60 * 1000;
const FAIL_TTL_MS = 5 * 60 * 1000;

export interface Stats {
  /** Display form: "801", "1.2k". */
  stars: string;
  /** Display form without the plus: "18k". Total downloads, never "installs" or "users". */
  downloads: string;
}

/** `{"value":"801"}` -> "801". null for anything that isn't a shields badge JSON with a string value. */
export function shieldsValue(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const v = (json as { value?: unknown }).value;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** 801 -> "801", 1234 -> "1.2k", 12_345 -> "12k", 1_250_000 -> "1.3M". */
export function formatCount(n: number): string {
  if (n < 1000) return String(Math.round(n));
  const [div, unit] = n < 1_000_000 ? [1000, "k"] : [1_000_000, "M"];
  const v = n / div;
  const s = v < 10 ? (Math.floor(v * 10) / 10).toFixed(1).replace(/\.0$/, "") : String(Math.floor(v));
  return s + unit;
}

/**
 * Normalises a shields count ("801", "1.2k", "18K", or digits with thousands separators) to the site's display form. Counts are rounded down, so
 * the "+" after downloads stays true. null if it doesn't look like a count.
 */
export function normaliseCount(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.replace(/,/g, "").trim();
  if (/^\d+$/.test(s)) return formatCount(Number(s));
  const m = /^(\d+(?:\.\d+)?)\s*([kKmM])$/.exec(s);
  if (!m) return null;
  return formatCount(Number(m[1]) * (m[2]!.toLowerCase() === "k" ? 1000 : 1_000_000));
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** GitHub's repo JSON -> the star count in display form, or null. */
export function githubStars(json: unknown): string | null {
  const n = json && typeof json === "object" ? (json as { stargazers_count?: unknown }).stargazers_count : undefined;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? formatCount(n) : null;
}

async function fetchJson(url: string, fetcher: Fetcher): Promise<unknown> {
  try {
    const init = {
      headers: { accept: "application/json", "user-agent": "voidaccess-site" },
      signal: AbortSignal.timeout(STATS_TIMEOUT_MS),
      next: { revalidate: STATS_TTL_MS / 1000 },
      cf: { cacheTtl: STATS_TTL_MS / 1000, cacheEverything: true },
    } as RequestInit;
    const res = await fetcher(url, init);
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

const fetchCount = async (url: string, fetcher: Fetcher) => normaliseCount(shieldsValue(await fetchJson(url, fetcher)));
const fetchStars = async (fetcher: Fetcher) =>
  githubStars(await fetchJson(STARS_API_URL, fetcher)) ?? (await fetchCount(STARS_URL, fetcher));

let memo: { value: Stats; until: number } | null = null;
let inflight: Promise<Stats> | null = null;

/** Live stars and downloads, cached for an hour, falling back to STATS_FALLBACK. Never throws. */
export async function getStats(opts: { fetcher?: Fetcher; now?: number } = {}): Promise<Stats> {
  const now = opts.now ?? Date.now();
  if (memo && memo.until > now) return memo.value;
  if (inflight) return inflight;
  const fetcher = opts.fetcher ?? ((u, i) => fetch(u, i));
  inflight = (async () => {
    const [stars, downloads] = await Promise.all([fetchStars(fetcher), fetchCount(DOWNLOADS_URL, fetcher)]);
    const value = { stars: stars ?? STATS_FALLBACK.stars, downloads: downloads ?? STATS_FALLBACK.downloads };
    memo = { value, until: now + (stars && downloads ? STATS_TTL_MS : FAIL_TTL_MS) };
    return value;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Tests only: forget the in-memory copy. */
export function resetStatsCache() {
  memo = null;
  inflight = null;
}
