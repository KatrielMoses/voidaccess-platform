/**
 * Preview lock: the shared, client-safe half (no database, no node built-ins). Client components import from here;
 * server code imports "@/lib/access" (which re-exports this file).
 *
 * Free accounts get a PREVIEW of each report; Pro / Pro+ (or a run paid with purchased top-up credits) get the full
 * report. Redaction happens on the server: a locked value is replaced by a placeholder before it is serialised, so it
 * never reaches the browser in any form (API JSON, RSC payload, SSE, export, email).
 */

export type ReportAccess = "full" | "preview";

/** Full counts of everything the run found, sent with every preview payload so the unlock panel can name them. */
export interface PreviewTotals {
  sources: number;
  entities: number;
  byType: Record<string, number>;
  actors: number;
  /** ONION_URL entities */
  onions: number;
  /** indicator-like entities (network, crypto, malware, vulnerability, messaging, identity, credential) */
  iocs: number;
  relationships: number;
}

export type AccessMarker = { level: "full" } | { level: "preview"; totals: PreviewTotals };

/** Rows visible per section (entities, actors, sources). */
export const PREVIEW_ROWS = 2;
/** At most this many summary sentences are visible (and at most PREVIEW_SUMMARY_CHARS characters). */
export const PREVIEW_SUMMARY_SENTENCES = 3;
export const PREVIEW_SUMMARY_CHARS = 400;
/** At most this many placeholder rows per section; the totals carry the real size. */
export const PREVIEW_PLACEHOLDER_ROWS = 20;
/** API error code for a locked resource (HTTP 402). */
export const LOCKED_ERROR = "preview_locked";
export const LOCKED_STATUS = 402;

export const FULL_ACCESS: AccessMarker = Object.freeze({ level: "full" }) as AccessMarker;

/** FNV-1a 32-bit: tiny, deterministic, no node:crypto (this file is imported by client components). */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A placeholder of 8..28 "█". The length comes from a hash of `seed` (a position such as "entity:3"), NEVER of the
 * real value, so a placeholder carries no information about what it hides.
 */
export function lockedText(seed: string): string {
  return "█".repeat(8 + (fnv1a(seed) % 21));
}
