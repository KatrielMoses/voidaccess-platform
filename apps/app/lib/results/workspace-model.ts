/** Pure helpers for the results workspace (P9): sidebar rows per group, filters, match order. Unit-tested. */
import { GROUPS, GROUP_LABEL, groupOf, type GroupId } from "./categories";
import { computeVisible, type Visible } from "./graph-model";
import type { Match } from "./search";
import type { GraphData } from "./types";

export interface Row {
  id: string;
  type: string;
  /** the masked display value, exactly as the entities table shows it */
  display: string;
  confidence: number;
  degree: number;
  sensitive: boolean;
  tags: string[];
  group: GroupId;
}

/** Rows by group, in GROUPS order, each sorted by connections (degree), then confidence, then value. */
export function rowsByGroup(data: GraphData): Map<GroupId, Row[]> {
  const out = new Map<GroupId, Row[]>(GROUPS.map((g) => [g.id, []]));
  for (const [id, type, label, confidence, degree, , sensitive, tags] of data.nodes) {
    const group = groupOf(type);
    out.get(group)!.push({
      id,
      type,
      display: label,
      confidence,
      degree,
      sensitive: sensitive === 1,
      tags: tags ?? [],
      group,
    });
  }
  for (const rows of out.values())
    rows.sort(
      (a, b) => b.degree - a.degree || b.confidence - a.confidence || (a.display < b.display ? -1 : 1),
    );
  return out;
}

export interface Filters {
  minConfidence: number;
  typedOnly: boolean;
  archive: boolean;
  hiddenGroups: ReadonlySet<GroupId>;
  showAll: boolean;
}
export const NO_FILTERS: Filters = {
  minConfidence: 0,
  typedOnly: false,
  archive: false,
  hiddenGroups: new Set(),
  showAll: false,
};

export function activeFilterCount(f: Filters): number {
  return (f.minConfidence > 0 ? 1 : 0) + (f.typedOnly ? 1 : 0) + (f.archive ? 1 : 0) + f.hiddenGroups.size;
}

/** One line for the "Filtered: …" note. */
export function filterSummary(f: Filters): string {
  const parts: string[] = [];
  if (f.minConfidence > 0) parts.push(`confidence ≥ ${f.minConfidence.toFixed(2)}`);
  if (f.typedOnly) parts.push("typed relationships only");
  if (f.archive) parts.push("archive context on");
  if (f.hiddenGroups.size) parts.push(`hidden: ${[...f.hiddenGroups].map((g) => GROUP_LABEL[g]).join(", ")}`);
  return parts.join(" · ");
}

export function visibleFor(data: GraphData, f: Filters): Visible {
  const hiddenTypes = new Set<string>();
  if (f.hiddenGroups.size)
    for (const n of data.nodes) if (f.hiddenGroups.has(groupOf(n[1]))) hiddenTypes.add(n[1]);
  return computeVisible(data, {
    hiddenTypes,
    minConfidence: f.minConfidence,
    typedOnly: f.typedOnly,
    showAll: f.showAll,
  });
}

/** Matches in sidebar order (group order, then row order): ↑/↓ walk this list, Enter takes the active one. */
export function orderedMatches(groups: Map<GroupId, Row[]>, matches: ReadonlyMap<string, Match>): Row[] {
  const out: Row[] = [];
  if (matches.size === 0) return out;
  for (const g of GROUPS) for (const r of groups.get(g.id) ?? []) if (matches.has(r.id)) out.push(r);
  return out;
}

/**
 * A display window of at most `max` characters that keeps the first highlight visible: long values (onion
 * addresses, wallets) are cut in the middle normally, or around the match while searching. Ranges are re-based.
 */
export function windowAround(
  display: string,
  ranges: readonly [number, number][],
  max: number,
): { text: string; ranges: [number, number][] } {
  if (display.length <= max) return { text: display, ranges: [...ranges] };
  const first = ranges[0];
  if (!first) {
    const keep = max - 1;
    const head = Math.ceil(keep * 0.55);
    return { text: `${display.slice(0, head)}…${display.slice(display.length - (keep - head))}`, ranges: [] };
  }
  // centre the window on the first match, then trim one character for each "…" it needs
  const span = Math.min(first[1] - first[0], max - 2);
  let from = Math.max(0, Math.min(first[0] - Math.floor((max - span) / 2), display.length - max));
  let to = from + max;
  const lead = from > 0 ? "…" : "";
  const tail = to < display.length ? "…" : "";
  if (lead) from++;
  if (tail) to--;
  const body = display.slice(from, to);
  const shift = from - lead.length;
  const out: [number, number][] = [];
  for (const [s, e] of ranges) {
    const a = Math.max(s, from) - shift;
    const b = Math.min(e, to) - shift;
    if (b > a) out.push([a, b]);
  }
  return { text: lead + body + tail, ranges: out };
}
