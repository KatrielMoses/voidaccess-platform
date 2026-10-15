/** Pure graph helpers (no DOM, no sigma): filtering, seeding, colours. Unit-tested. */
import { EDGE_COOCCURRENCE } from "./entity-style";
import type { GraphData } from "./types";

/** Above this many nodes the graph opens showing only the top nodes by degree (with a "show all" toggle). */
export const BIG_GRAPH_THRESHOLD = 3000;
export const BIG_GRAPH_TOP = 1500;

export interface GraphFilterState {
  /** entity types currently hidden */
  hiddenTypes: ReadonlySet<string>;
  minConfidence: number;
  /** show typed relationships only: hides co-occurrence edges and nodes left without a typed edge */
  typedOnly: boolean;
  showAll: boolean;
}

export const DEFAULT_FILTERS: GraphFilterState = {
  hiddenTypes: new Set(),
  minConfidence: 0,
  typedOnly: false,
  showAll: false,
};

export interface Visible {
  nodes: Set<string>;
  /** indexes into data.edges */
  edges: Set<number>;
  /** nodes dropped only because the graph is big and show-all is off */
  truncated: number;
}

export function isBig(data: GraphData): boolean {
  return data.nodes.length > BIG_GRAPH_THRESHOLD;
}

/** Which nodes and edges are visible under the current filters. */
export function computeVisible(data: GraphData, f: GraphFilterState): Visible {
  const keep = new Set<string>();
  for (const [id, type, , confidence] of data.nodes) {
    if (!f.hiddenTypes.has(type) && confidence >= f.minConfidence) keep.add(id);
  }

  let truncated = 0;
  if (isBig(data) && !f.showAll) {
    const ranked = data.nodes
      .filter((n) => keep.has(n[0]))
      .sort((a, b) => b[4] - a[4] || (a[0] < b[0] ? -1 : 1));
    const top = new Set(ranked.slice(0, BIG_GRAPH_TOP).map((n) => n[0]));
    truncated = keep.size - top.size;
    for (const id of [...keep]) if (!top.has(id)) keep.delete(id);
  }

  const edges = new Set<number>();
  const touched = new Set<string>();
  data.edges.forEach(([s, t, type], i) => {
    if (!keep.has(s) || !keep.has(t)) return;
    if (f.typedOnly && type === EDGE_COOCCURRENCE) return;
    edges.add(i);
    touched.add(s);
    touched.add(t);
  });
  if (f.typedOnly) for (const id of [...keep]) if (!touched.has(id)) keep.delete(id);
  return { nodes: keep, edges, truncated };
}

/** Per-type node counts, for the filter chips. */
export function typeCounts(data: GraphData): [string, number][] {
  const m = new Map<string, number>();
  for (const n of data.nodes) m.set(n[1], (m.get(n[1]) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
}

/** Neighbours of a node grouped by entity type (for the detail panel). */
export function neighborsByType(
  data: GraphData,
  id: string,
): Map<string, { id: string; label: string; edgeType: string }[]> {
  const byId = new Map(data.nodes.map((n) => [n[0], n]));
  const out = new Map<string, { id: string; label: string; edgeType: string }[]>();
  for (const [s, t, type] of data.edges) {
    const other = s === id ? t : t === id ? s : null;
    if (!other) continue;
    const n = byId.get(other);
    if (!n) continue;
    out.set(n[1], [...(out.get(n[1]) ?? []), { id: other, label: n[2], edgeType: type }]);
  }
  return out;
}

function hash01(s: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  return (h >>> 0) / 4294967296;
}

/**
 * Deterministic starting positions: each community gets a centre on a wide disc and its nodes scatter around
 * it. The same investigation always starts from the same layout, so ForceAtlas2 converges to a stable picture.
 */
export function seedPositions(data: GraphData): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const spread = Math.sqrt(data.nodes.length) * 4;
  for (const [id, , , , , community] of data.nodes) {
    const ckey = community === null ? id : `c${community}`;
    const ca = hash01(ckey, 1) * Math.PI * 2;
    const cr = Math.sqrt(hash01(ckey, 2)) * spread;
    const a = hash01(id, 3) * Math.PI * 2;
    const r = Math.sqrt(hash01(id, 4)) * (community === null ? spread * 0.3 : spread * 0.08 + 2);
    out.set(id, { x: Math.cos(ca) * cr + Math.cos(a) * r, y: Math.sin(ca) * cr + Math.sin(a) * r });
  }
  return out;
}

export const nodeSize = (degree: number) => Math.min(3 + Math.sqrt(degree) * 1.5, 16);

/**
 * The graph's palette (design.md §3, §7): the field, paper hairlines and one violet signal. No entity hues;
 * entity kinds are shapes (lib/results/glyphs.ts).
 */
export const FIELD = "#0f0f12";
const PAPER = [243, 241, 236] as const;
const V500 = [106, 117, 239] as const;
export const V200 = "#c9ccf3";
export const PAPER_HEX = "#f3f1ec";
export const V500_HEX = "#6a75ef";

/**
 * Node colour: paper whose alpha is the node's intensity. The glyph program mixes it into the field, so the node
 * stays opaque and hides the edges behind it.
 */
export const nodeColor = (intensity: number) => `rgba(243,241,236,${intensity.toFixed(3)})`;
export const SIGNAL_NODE = "rgba(106,117,239,1)";

/** Importance by connections: hubs read as bright paper, leaves recede (0.5 to 1). */
export const nodeIntensity = (degree: number, maxDegree: number) =>
  0.5 + 0.5 * Math.sqrt(Math.min(1, degree / Math.max(1, maxDegree)));

/** Sigma's WebGL layers blend premultiplied colour, so translucent edge colours are premultiplied here. */
const pm = (rgb: readonly [number, number, number], a: number) =>
  `rgba(${Math.round(rgb[0] * a)},${Math.round(rgb[1] * a)},${Math.round(rgb[2] * a)},${a})`;

export const EDGE = {
  cooccurrence: pm(PAPER, 0.16),
  typed: pm(PAPER, 0.36),
  archive: pm(PAPER, 0.24),
  /** edges outside the hovered or selected node's neighbourhood */
  muted: pm(PAPER, 0.035),
  /** the signal: edges of the hovered or selected node */
  signal: pm(V500, 0.95),
  signalSoft: pm(V500, 0.6),
} as const;

/** Unselected nodes outside the focus neighbourhood fall back to this intensity. */
export const MUTED_INTENSITY = 0.16;

/** Label colours: dim by default, paper for the neighbourhood, lavender for the focused node. */
export const LABEL = {
  base: "rgba(243,241,236,0.66)",
  near: "rgba(243,241,236,0.86)",
  focus: V200,
} as const;
