/**
 * Pure preview redactors, one per payload type. Each takes the REAL payload (already masked by the existing safety
 * rules) and returns what a preview account may see: the visible rows unchanged, everything else replaced by
 * placeholders built from positions only (never from a hidden value). No I/O; unit-tested in test/preview-redact.test.ts.
 */
import type { ArchiveContext, ArchiveGraph } from "@voidaccess/archive";
import type {
  ActorView,
  EntityPage,
  EntityRowView,
  GraphData,
  InvestigationView,
  SourceView,
} from "@/lib/results/types";
import {
  PREVIEW_PLACEHOLDER_ROWS,
  PREVIEW_ROWS,
  lockedText,
  type AccessMarker,
  type PreviewTotals,
} from "./shared";
import { previewSummary } from "./summary";

export const previewMarker = (totals: PreviewTotals): { level: "preview"; totals: PreviewTotals } => ({
  level: "preview",
  totals,
});

const placeholders = <T>(n: number, make: (i: number) => T): T[] =>
  Array.from({ length: Math.max(0, Math.min(n, PREVIEW_PLACEHOLDER_ROWS)) }, (_, i) => make(i));

const lockList = (items: readonly unknown[], seed: string): string[] =>
  items.slice(0, PREVIEW_PLACEHOLDER_ROWS).map((_, i) => lockedText(`${seed}:${i}`));

// ---------------------------------------------------------------------------------------------------------------
// investigation header + summary

export type InvestigationPayload = InvestigationView & { access: AccessMarker; summaryLocked?: true };

export function redactInvestigation(inv: InvestigationView, totals: PreviewTotals): InvestigationPayload {
  const { summary } = inv;
  return {
    ...inv,
    refinedQueries: lockList(inv.refinedQueries, "refined"),
    summary: {
      ...summary,
      markdown: previewSummary(summary.markdown),
      keyFindings: lockList(summary.keyFindings, "finding"),
      riskNotes: lockList(summary.riskNotes, "risk"),
      stats: summary.stats
        ? { ...summary.stats, refinedQueries: lockList(summary.stats.refinedQueries, "refined") }
        : null,
    },
    relevance: inv.relevance ? { ...inv.relevance, queryIntent: lockedText("intent") } : null,
    summaryLocked: true,
    access: previewMarker(totals),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// entities

export const lockedEntityRow = (n: number, type: string): EntityRowView => ({
  bundleId: `locked-${n}`,
  locked: true,
  type,
  displayValue: lockedText(`entity:${n}`),
  sensitive: false,
  confidence: 0,
  firstSeen: null,
  sourceCount: 0,
  tags: [],
  degree: 0,
  relevance: null,
  relevanceReason: null,
});

/**
 * `firstRows` is the unfiltered entity list in the default order (at least PREVIEW_ROWS + PREVIEW_PLACEHOLDER_ROWS
 * rows when that many exist). The first PREVIEW_ROWS are returned as they are; the rest become placeholders that
 * keep only their type. `offset` > 0 (a later page) returns no rows. Client filters are ignored on purpose: with real
 * totals they would be a search oracle over locked values.
 */
export function redactEntityPage(
  firstRows: EntityRowView[],
  totals: PreviewTotals,
  offset = 0,
): EntityPage & { access: AccessMarker } {
  const access = previewMarker(totals);
  if (offset > 0) return { rows: [], total: totals.entities, access };
  const visible = firstRows.slice(0, PREVIEW_ROWS);
  const hidden = Math.max(0, totals.entities - visible.length);
  const rest = firstRows.slice(PREVIEW_ROWS);
  const locked = placeholders(hidden, (i) =>
    lockedEntityRow(PREVIEW_ROWS + i, rest[i]?.type ?? rest.at(-1)?.type ?? "OTHER"),
  );
  return { rows: [...visible, ...locked], total: totals.entities, access };
}

// ---------------------------------------------------------------------------------------------------------------
// sources

/** Origin only ("http://host"): the visible source rows show host and title, never the path or the excerpt. */
export function hostOnly(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export const lockedSourceRow = (n: number, kind: string): SourceView => ({
  bundleId: `locked-${n}`,
  locked: true,
  kind,
  name: lockedText(`source:${n}`),
  url: null,
  fetchedAt: "",
  excerpt: lockedText(`excerpt:${n}`),
  relevance: null,
  relevanceReason: null,
  pageKind: null,
});

export function redactSources(sources: SourceView[]): SourceView[] {
  const visible = sources.slice(0, PREVIEW_ROWS).map((s, i) => ({
    ...s,
    url: hostOnly(s.url),
    excerpt: lockedText(`excerpt:${i}`),
    relevanceReason: null,
  }));
  const rest = sources.slice(PREVIEW_ROWS);
  return [...visible, ...placeholders(rest.length, (i) => lockedSourceRow(PREVIEW_ROWS + i, rest[i]!.kind))];
}

// ---------------------------------------------------------------------------------------------------------------
// actors

export const lockedActorRow = (n: number): ActorView => ({
  bundleId: `locked-${n}`,
  locked: true,
  handle: lockedText(`actor:${n}`),
  aliases: [],
  firstSeen: null,
  lastSeen: null,
  summary: null,
  entityCount: 0,
  entities: [],
  sources: [],
});

/**
 * The first PREVIEW_ROWS actors keep their profile (handle, aliases, dates, summary), but their linked entities and
 * sources are other rows of the report, so those keep only their type / kind.
 */
export function redactActors(actors: ActorView[]): ActorView[] {
  const visible = actors.slice(0, PREVIEW_ROWS).map((a, ai) => ({
    ...a,
    entities: a.entities.slice(0, PREVIEW_PLACEHOLDER_ROWS).map((e, i) => ({
      bundleId: `locked-a${ai}-e${i}`,
      type: e.type,
      displayValue: lockedText(`actor:${ai}:entity:${i}`),
      sensitive: false,
    })),
    sources: a.sources.slice(0, PREVIEW_PLACEHOLDER_ROWS).map((s, i) => ({
      bundleId: `locked-a${ai}-s${i}`,
      kind: s.kind,
      name: lockedText(`actor:${ai}:source:${i}`),
    })),
  }));
  const rest = actors.length - visible.length;
  return [...visible, ...placeholders(rest, (i) => lockedActorRow(PREVIEW_ROWS + i))];
}

// ---------------------------------------------------------------------------------------------------------------
// graph

export type PreviewGraphNode = [
  id: string,
  type: string,
  label: null,
  confidence: 0,
  degree: number,
  community: number | null,
  sensitive: 0,
  tags: [],
];
export type PreviewGraphData = {
  nodes: PreviewGraphNode[];
  edges: GraphData["edges"];
  communities: { id: number; label: null; size: number }[];
};
type PreviewMarker = Extract<AccessMarker, { level: "preview" }>;
export type GraphPayload =
  (GraphData & { access: { level: "full" } }) | (PreviewGraphData & { access: PreviewMarker });

/** Fisher-Yates with an injectable random source (tests pass a seeded one). */
function shuffle<T>(xs: T[], random: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * The shape only: opaque node ids `n<i>` in shuffled order, types and communities kept (degree follows from the
 * edges anyway), every label, score, tag and community name removed; edges keep their type, weight becomes 1.
 */
export function redactGraph(
  g: GraphData,
  totals: PreviewTotals,
  random: () => number = Math.random,
): PreviewGraphData & { access: PreviewMarker } {
  const order = shuffle(g.nodes, random);
  const ids = new Map<string, string>();
  order.forEach((n, i) => ids.set(n[0], `n${i}`));
  return {
    nodes: order.map((n, i) => [`n${i}`, n[1], null, 0, n[4], n[5], 0, []]),
    edges: g.edges.flatMap(([s, t, type]) => {
      const a = ids.get(s);
      const b = ids.get(t);
      return a && b ? [[a, b, type, 1] as GraphData["edges"][number]] : [];
    }),
    communities: g.communities.map((c) => ({ id: c.id, label: null, size: c.size })),
    access: previewMarker(totals),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// archive overlay

export function redactArchiveContext(
  ctx: ArchiveContext,
  totals: PreviewTotals,
): ArchiveContext & { access: AccessMarker } {
  return { seen: {}, neighbours: [], offline: [], totals: { ...ctx.totals }, access: previewMarker(totals) };
}

export function redactArchiveGraph(
  _g: ArchiveGraph,
  totals: PreviewTotals,
): ArchiveGraph & { access: AccessMarker } {
  return { nodes: [], edges: [], truncated: false, access: previewMarker(totals) };
}

// ---------------------------------------------------------------------------------------------------------------
// live run: SSE trace frames, replay, run status snapshot

/**
 * A contract-v2 trace event's `data` for a preview account. Stage progress, ids (u12 / e34, engine-local) and counts
 * stay; every host, entity value and refined-query text becomes a placeholder. Unknown kinds keep only numbers.
 */
export function redactTraceData(
  kind: string | null,
  data: Record<string, unknown> | null,
  seq: number,
): Record<string, unknown> {
  const d = data ?? {};
  switch (kind) {
    case "query.refined":
      return { ...d, text: lockedText(`refined:${seq}`) };
    case "url.found":
      return "host" in d ? { ...d, host: lockedText(`host:${seq}`) } : { ...d };
    case "entity.found":
      return { ...d, display: lockedText(`entity:${seq}`) };
    case "search.request":
    case "search.result":
    case "url.kept":
    case "url.dropped":
    case "page.fetched":
    case "page.entities":
    case "enrich.source":
    case "graph.progress":
    case "summary.status":
    case "trace.truncated":
    case "filter_fallback":
      return { ...d };
    default:
      // a newer engine's kind: keep numbers only
      return Object.fromEntries(Object.entries(d).filter(([, v]) => typeof v === "number"));
  }
}

export const redactRefinedQueries = (qs: readonly string[] | null | undefined): string[] =>
  lockList(qs ?? [], "refined");
