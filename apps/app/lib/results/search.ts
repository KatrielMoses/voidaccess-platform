/**
 * Value search for the results workspace (P9-4). Case-insensitive substring over what the user can SEE: the masked
 * display value, the type label and the tags. Never an unmasked value (the graph payload carries none).
 *
 * Defanged forms match their plain forms both ways: "zwrad.onion" finds "lockbit…zwrad[.]onion", and so does
 * "zwrad[.]onion". Highlight ranges are reported in the ORIGINAL display string, so "[.]" highlights whole.
 */
import { typeLabel } from "./entity-style";

/** Lower-case and refang: "[.]" "(.)" "{.}" "[dot]" -> ".", "hxxp" -> "http", "[:]" -> ":". */
const FANG: [RegExp, string][] = [
  [/\[\.\]|\(\.\)|\{\.\}|\[dot\]|\(dot\)/g, "."],
  [/\[:\]/g, ":"],
  [/hxxp/g, "http"],
];

export function normalize(s: string): string {
  let out = s.toLowerCase();
  for (const [re, to] of FANG) out = out.replace(re, to);
  return out.trim();
}

const STICKY: [RegExp, string][] = FANG.map(([re, to]) => [new RegExp(re.source, "y"), to]);

/** The refanged, lower-cased form of `s` plus, for each of its characters, the index it came from in `s`. */
export function normalizeWithMap(s: string): { text: string; map: number[] } {
  const lower = s.toLowerCase();
  let text = "";
  const map: number[] = [];
  let i = 0;
  outer: while (i < lower.length) {
    const c = lower[i]!;
    if (c === "[" || c === "(" || c === "{" || c === "h") {
      for (const [re, to] of STICKY) {
        re.lastIndex = i;
        const m = re.exec(lower);
        if (!m) continue;
        for (let k = 0; k < to.length; k++) {
          text += to[k];
          // the replacement spans the whole original token
          map.push(k === to.length - 1 ? i + m[0].length - 1 : i);
        }
        i += m[0].length;
        continue outer;
      }
    }
    text += c;
    map.push(i);
    i++;
  }
  return { text, map };
}

export interface Searchable {
  id: string;
  type: string;
  /** the masked display value, exactly as shown */
  display: string;
  tags?: readonly string[];
}

export interface Match {
  id: string;
  /** [start, end) ranges in the display string to highlight; empty when only the type or a tag matched */
  ranges: [number, number][];
}

interface Indexed {
  id: string;
  text: string;
  map: number[];
  /** the type label and tags, refanged and lower-cased */
  extra: string[];
}
export type SearchIndex = Indexed[];

/** Normalise every item once; searching is then a plain indexOf per item. */
export function buildIndex(items: readonly Searchable[]): SearchIndex {
  return items.map((it) => ({
    id: it.id,
    ...normalizeWithMap(it.display),
    extra: [normalize(typeLabel(it.type)), ...(it.tags ?? []).map(normalize)],
  }));
}

/** All matches for `query`, in index order. An empty query matches nothing (the caller shows everything). */
export function searchIndex(index: SearchIndex, query: string): Map<string, Match> {
  const q = normalize(query);
  const out = new Map<string, Match>();
  if (!q) return out;
  for (const it of index) {
    const ranges: [number, number][] = [];
    let from = 0;
    for (;;) {
      const at = it.text.indexOf(q, from);
      if (at < 0) break;
      ranges.push([it.map[at]!, it.map[at + q.length - 1]! + 1]);
      from = at + q.length;
    }
    if (ranges.length > 0 || it.extra.some((x) => x.includes(q))) out.set(it.id, { id: it.id, ranges });
  }
  return out;
}

export const search = (items: readonly Searchable[], query: string) => searchIndex(buildIndex(items), query);

/** Split `display` into plain and highlighted runs for rendering (text only, never HTML). */
export function highlightRuns(
  display: string,
  ranges: readonly [number, number][],
): { text: string; hit: boolean }[] {
  if (ranges.length === 0) return [{ text: display, hit: false }];
  const runs: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [s, e] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (s < at) continue;
    if (s > at) runs.push({ text: display.slice(at, s), hit: false });
    runs.push({ text: display.slice(s, e), hit: true });
    at = e;
  }
  if (at < display.length) runs.push({ text: display.slice(at), hit: false });
  return runs;
}

/** Truncate in the middle for long values (onion addresses, wallets): "lockbit3ab…zwrad[.]onion". */
export function middleTruncate(s: string, max = 34): string {
  if (s.length <= max) return s;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.55);
  return `${s.slice(0, head)}…${s.slice(s.length - (keep - head))}`;
}
