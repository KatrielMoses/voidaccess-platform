/**
 * The live run model (P8): folds the run's event stream (progress events and contract-v2 traces) into what the live
 * view shows: every URL's trail (found by which engine -> kept or dropped -> fetch outcome -> entities), the
 * discarded tray, the entities and their co-occurrence graph, search engines, enrichment rows and the summary state.
 *
 * Pure and DOM-free (unit tested). `apply` returns the visual effects of one event; the renderer animates them when
 * live and skips them when fast-forwarding, so a late joiner sees the same state without hours of motion.
 *
 * Nothing here is ever rendered as HTML or a link: hosts and masked values are text only. A URL removed by the
 * content-safety filter loses its host the moment the drop is known (`host: null`, `safety: true`).
 */
import { STAGES, type Stage } from "@voidaccess/config";

export type StageState = "start" | "end" | "skipped" | "failed";

/** A stored or streamed event, as sent by the SSE stream and the replay endpoint. */
export type LiveEvent =
  | {
      type: "trace";
      seq: number;
      stage: string | null;
      kind: string;
      data: Record<string, unknown>;
      at: string;
    }
  | {
      type: string;
      seq: number;
      stage?: string | null;
      status?: string;
      counts?: Record<string, number> | null;
      at: string;
    };

export const isTraceEvent = (e: LiveEvent): e is Extract<LiveEvent, { type: "trace" }> => e.type === "trace";

/** Tray buckets: why something fell out of the flow. Safety drops of both kinds share one bucket. */
export const TRAY_BUCKETS = [
  ["duplicate", "duplicate"],
  ["irrelevant", "irrelevant"],
  ["cap", "over cap"],
  ["invalid", "invalid"],
  ["ssrf", "blocked"],
  ["disabled_source", "source off"],
  ["http_404", "404"],
  ["http_4xx", "4xx"],
  ["http_5xx", "5xx"],
  ["timeout", "timeout"],
  ["tor_error", "Tor error"],
  ["too_large", "too large"],
  ["empty", "empty"],
  ["error", "error"],
  ["safety", "safety"],
] as const;
export type TrayBucket = (typeof TRAY_BUCKETS)[number][0];
export const TRAY_LABEL = Object.fromEntries(TRAY_BUCKETS) as Record<TrayBucket, string>;
/** Buckets filled at the filter stage (left part of the tray) vs. at fetch (right part). */
export const FILTER_BUCKETS: TrayBucket[] = [
  "duplicate",
  "irrelevant",
  "cap",
  "invalid",
  "ssrf",
  "disabled_source",
];

export type UrlState = "found" | "kept" | "dropped" | "fetched" | "failed";

export interface UrlTrail {
  id: string;
  /** Display host (defanged); null once the content-safety filter removed it. */
  host: string | null;
  engine: string | null;
  depth: number | null;
  state: UrlState;
  score?: number;
  dropReason?: TrayBucket;
  fetch?: { outcome: string; httpStatus?: number; bytes?: number; ms?: number };
  byType?: Record<string, number>;
  entityIds: string[];
  safety: boolean;
  foundSeq: number;
}

export interface EntityItem {
  id: string;
  type: string;
  display: string;
  confidence?: number;
  urlId?: string;
  seq: number;
}

export interface EngineRow {
  engine: string;
  requests: number;
  results: number;
  /** the latest status reported for this engine */
  status: string | null;
  ms?: number;
}

export interface EnrichRow {
  source: string;
  status: string;
  hits?: number;
}

export type Effect =
  | { e: "url"; id: string }
  | { e: "keep"; id: string }
  | { e: "drop"; id: string; bucket: TrayBucket }
  | { e: "fetched"; id: string }
  | { e: "fail"; id: string; bucket: TrayBucket }
  | { e: "entity"; id: string; urlId?: string }
  | { e: "edge"; a: string; b: string }
  | { e: "stage"; stage: Stage; state: StageState };

/**
 * One line of the calm live log (reduced motion). It holds a url/entity ref, never a host: the host is read from
 * the model when shown, so a later safety drop also hides it in earlier lines.
 */
export interface LogLine {
  seq: number;
  stage: Stage;
  /** "found", "kept", "dropped", "read", "failed", "entity", "search", "enrich", "graph", "summary", "query" */
  verb: string;
  ref?: string;
  detail?: string;
}
export const LOG_MAX = 200;

const STAGE_SET = new Set<string>(STAGES);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

/** Edges per entity from page co-occurrence: enough to read as a graph, bounded so the view stays light. */
const MAX_EDGES_PER_ENTITY = 3;
export const MAX_EDGES = 900;

export class LiveModel {
  urls = new Map<string, UrlTrail>();
  urlOrder: string[] = [];
  entities = new Map<string, EntityItem>();
  entityOrder: string[] = [];
  edges: [string, string][] = [];
  private edgeKeys = new Set<string>();
  engines = new Map<string, EngineRow>();
  queries: string[] = [];
  enrich = new Map<string, EnrichRow>();
  graph: { nodes: number; edges: number; communities?: number } | null = null;
  summary: { kind: string; attempt?: number } | null = null;
  tray: Record<TrayBucket, number> = Object.fromEntries(TRAY_BUCKETS.map(([k]) => [k, 0])) as Record<
    TrayBucket,
    number
  >;
  truncated: Record<string, number> = {};
  private unseen = new Set<string>();
  stages: Partial<Record<Stage, StageState>> = {};
  counts: Record<string, number> = {};
  kept = 0;
  fetchedOk = 0;
  lastSeq = -1;
  /** Bumped on every applied event; renderers compare it to skip unchanged frames. */
  version = 0;
  terminal: string | null = null;
  log: LogLine[] = [];

  constructor(init?: {
    stages?: Partial<Record<Stage, StageState>>;
    counts?: Record<string, number> | null;
  }) {
    if (init?.stages) this.stages = { ...init.stages };
    if (init?.counts) this.counts = { ...init.counts };
  }

  get found(): number {
    return this.urls.size;
  }
  get discarded(): number {
    return Object.values(this.tray).reduce((a, n) => a + n, 0);
  }

  /** 0..1: how much of the collected noise has been discarded (drives the terrain's flattening). */
  noiseCleared(): number {
    if (this.terminal === "completed") return 1;
    const found = Math.max(this.found, this.counts.results_found ?? 0);
    if (found === 0) return 0;
    const decided = this.discarded + this.kept;
    // the share of found links resolved, weighted by how much of it was noise
    return Math.min(1, (this.discarded / found) * 1.15 + (decided / found) * 0.1);
  }

  /** 0..1: signal strength from entities found (drives the violet line). */
  signal(): number {
    const n = Math.max(this.entities.size, this.counts.entities_found ?? 0);
    return n === 0 ? 0 : Math.min(1, 0.18 + 0.82 * (1 - Math.exp(-n / 60)));
  }

  /**
   * Pages read: the trace count when traces are on (the engine's pages_fetched also counts failed attempts), the
   * progress count when traces are off or page.fetched was truncated.
   */
  pagesRead(): number {
    const traced = this.found > 0 && !this.truncated["page.fetched"];
    return traced ? this.fetchedOk : Math.max(this.fetchedOk, this.counts.pages_fetched ?? 0);
  }

  /**
   * Entities extracted from pages (what the engine's entities_found counts). Enrichment adds entities with no page;
   * those are in the graph, not in this number. Falls back to the progress count like pagesRead().
   */
  pageEntities(): number {
    const traced = this.found > 0 && !this.truncated["entity.found"];
    let fromPages = 0;
    for (const e of this.entities.values()) if (e.urlId) fromPages++;
    return traced ? fromPages : Math.max(fromPages, this.counts.entities_found ?? 0);
  }

  /** The current stage: the last one started and not finished, else the furthest finished one. */
  currentStage(): Stage | null {
    let last: Stage | null = null;
    for (const s of STAGES) if (this.stages[s] === "start") last = s;
    if (last) return last;
    for (const s of STAGES) if (this.stages[s]) last = s;
    return last;
  }

  apply(ev: LiveEvent): Effect[] {
    if (ev.seq <= this.lastSeq) return []; // replays and reconnects never double-count
    this.lastSeq = ev.seq;
    this.version++;
    if (isTraceEvent(ev)) return this.applyTrace(ev);
    const out: Effect[] = [];
    const p = ev as Exclude<LiveEvent, { type: "trace" }>;
    if (p.counts) this.counts = { ...this.counts, ...p.counts };
    if (p.type === "stage" && p.stage && STAGE_SET.has(p.stage)) {
      const stage = p.stage as Stage;
      const status = (p.status ?? "start") as StageState;
      const prev = this.stages[stage];
      if (!(prev && prev !== "start" && status === "start")) {
        this.stages[stage] = status;
        out.push({ e: "stage", stage, state: status });
      }
    }
    if (p.type === "completed" || p.type === "failed" || p.type === "cancelled") {
      this.terminal = p.type;
      if (p.type === "completed")
        for (const s of STAGES) if (!this.stages[s] || this.stages[s] === "start") this.stages[s] = "end";
    }
    return out;
  }

  private applyTrace(ev: Extract<LiveEvent, { type: "trace" }>): Effect[] {
    const fx = this.traceEffects(ev);
    const line = this.logLine(ev, fx);
    if (line) {
      this.log.push(line);
      if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX);
    }
    return fx;
  }

  private logLine(ev: Extract<LiveEvent, { type: "trace" }>, fx: Effect[]): LogLine | null {
    const stage = (STAGE_SET.has(ev.stage ?? "") ? ev.stage : "collect") as Stage;
    const d = ev.data;
    const base = { seq: ev.seq, stage };
    const f = fx[0];
    switch (ev.kind) {
      case "query.refined":
        return str(d.text) ? { ...base, verb: "query", detail: str(d.text) } : null;
      case "search.result":
        return {
          ...base,
          verb: "search",
          detail: `${str(d.engine) ?? ""} · ${str(d.status) === "ok" ? `${num(d.results) ?? 0} results` : outcomeLabel(str(d.status) ?? "")}`,
        };
      case "url.found":
        return f
          ? { ...base, verb: "found", ref: f.e === "url" ? f.id : undefined, detail: str(d.engine) }
          : null;
      case "url.kept":
        return f ? { ...base, verb: "kept", ref: str(d.url_id) } : null;
      case "url.dropped":
        return f && f.e === "drop"
          ? { ...base, verb: "dropped", ref: f.id, detail: TRAY_LABEL[f.bucket] }
          : null;
      case "page.fetched":
        if (!f) return null;
        return f.e === "fail"
          ? { ...base, verb: "failed", ref: f.id, detail: TRAY_LABEL[f.bucket] }
          : { ...base, verb: "read", ref: str(d.url_id) };
      case "entity.found":
        return f ? { ...base, verb: "entity", ref: str(d.entity_id) } : null;
      case "enrich.source":
        return {
          ...base,
          verb: "enrich",
          detail: `${str(d.source) ?? ""} · ${outcomeLabel(str(d.status) ?? "")}`,
        };
      case "graph.progress":
        return { ...base, verb: "graph", detail: `${num(d.nodes) ?? 0} nodes · ${num(d.edges) ?? 0} links` };
      case "summary.status":
        return { ...base, verb: "summary", detail: str(d.kind) === "llm" ? "writing" : (str(d.kind) ?? "") };
      default:
        return null;
    }
  }

  private traceEffects(ev: Extract<LiveEvent, { type: "trace" }>): Effect[] {
    const d = ev.data;
    switch (ev.kind) {
      case "query.refined": {
        const i = num(d.index) ?? this.queries.length;
        const t = str(d.text);
        if (t && i < 50) this.queries[i] = t;
        return [];
      }
      case "search.request":
      case "search.result": {
        const engine = str(d.engine);
        if (!engine) return [];
        const row = this.engines.get(engine) ?? { engine, requests: 0, results: 0, status: null };
        if (ev.kind === "search.request") row.requests++;
        else {
          row.results += num(d.results) ?? 0;
          row.status = str(d.status) ?? row.status;
          row.ms = num(d.ms) ?? row.ms;
        }
        this.engines.set(engine, row);
        return [];
      }
      case "url.found": {
        const id = str(d.url_id);
        if (!id || this.urls.has(id)) return [];
        this.urls.set(id, {
          id,
          host: str(d.host) ?? null,
          engine: str(d.engine) ?? null,
          depth: num(d.depth) ?? null,
          state: "found",
          entityIds: [],
          safety: false,
          foundSeq: ev.seq,
        });
        this.urlOrder.push(id);
        return [{ e: "url", id }];
      }
      case "url.kept": {
        const u = this.url(str(d.url_id));
        if (!u || u.state !== "found") return [];
        u.state = "kept";
        u.score = num(d.score);
        this.kept++;
        return [{ e: "keep", id: u.id }];
      }
      case "url.dropped": {
        const u = this.url(str(d.url_id));
        const reason = str(d.reason);
        if (!u) return this.unseenDrop(str(d.url_id), reason === "safety" ? "safety" : reason);
        if (!reason || u.state === "dropped") return [];
        if (u.state === "kept") this.kept--;
        const bucket: TrayBucket = reason === "safety" ? "safety" : (reason as TrayBucket);
        if (!(bucket in this.tray)) return [];
        u.state = "dropped";
        u.dropReason = bucket;
        if (bucket === "safety") this.markSafety(u);
        this.tray[bucket]++;
        return [{ e: "drop", id: u.id, bucket }];
      }
      case "page.fetched": {
        const u = this.url(str(d.url_id));
        const outcome = str(d.outcome);
        if (!u) return outcome === "safety_dropped" ? this.unseenDrop(str(d.url_id), "safety") : [];
        if (!outcome) return [];
        if (u.fetch) {
          // The latest outcome wins only for the post-scrape safety gate: a page first read "ok" can still be
          // removed. Undo what the earlier outcome counted, then fall through as a safety drop.
          if (outcome !== "safety_dropped" || u.safety) return [];
          if (u.state === "fetched") this.fetchedOk--;
          else if (u.dropReason && this.tray[u.dropReason] > 0) this.tray[u.dropReason]--;
        }
        if (outcome === "safety_dropped") {
          this.markSafety(u);
          u.fetch = { outcome };
        } else u.fetch = { outcome, httpStatus: num(d.http_status), bytes: num(d.bytes), ms: num(d.ms) };
        if (outcome === "ok") {
          u.state = "fetched";
          this.fetchedOk++;
          return [{ e: "fetched", id: u.id }];
        }
        const bucket: TrayBucket = outcome === "safety_dropped" ? "safety" : (outcome as TrayBucket);
        if (!(bucket in this.tray)) return [];
        u.state = "failed";
        u.dropReason = bucket;
        this.tray[bucket]++;
        return [{ e: "fail", id: u.id, bucket }];
      }
      case "page.entities": {
        const u = this.url(str(d.url_id));
        if (u && d.by_type && typeof d.by_type === "object")
          u.byType = Object.fromEntries(
            Object.entries(d.by_type as Record<string, unknown>).filter(([, v]) => typeof v === "number"),
          ) as Record<string, number>;
        return [];
      }
      case "entity.found": {
        const id = str(d.entity_id);
        const type = str(d.type);
        const display = str(d.display);
        if (!id || !type || !display || this.entities.has(id)) return [];
        const urlId = str(d.url_id);
        this.entities.set(id, { id, type, display, confidence: num(d.confidence), urlId, seq: ev.seq });
        this.entityOrder.push(id);
        const out: Effect[] = [{ e: "entity", id, urlId }];
        const u = this.url(urlId);
        if (u) {
          // co-occurrence on the same page: link to the last few entities already found there
          for (const other of u.entityIds.slice(-MAX_EDGES_PER_ENTITY)) {
            if (this.edges.length >= MAX_EDGES) break;
            const key = other < id ? `${other}|${id}` : `${id}|${other}`;
            if (this.edgeKeys.has(key)) continue;
            this.edgeKeys.add(key);
            this.edges.push([other, id]);
            out.push({ e: "edge", a: other, b: id });
          }
          u.entityIds.push(id);
        }
        return out;
      }
      case "enrich.source": {
        const source = str(d.source);
        const status = str(d.status);
        if (source && status) this.enrich.set(source, { source, status, hits: num(d.hits) });
        return [];
      }
      case "graph.progress": {
        const nodes = num(d.nodes);
        const edges = num(d.edges);
        if (nodes !== undefined && edges !== undefined)
          this.graph = { nodes, edges, communities: num(d.communities) };
        return [];
      }
      case "summary.status": {
        const kind = str(d.kind);
        if (kind) this.summary = { kind, attempt: num(d.attempt) };
        return [];
      }
      case "trace.truncated": {
        const kind = str(d.kind);
        if (kind) this.truncated[kind] = (this.truncated[kind] ?? 0) + (num(d.dropped) ?? 0);
        return [];
      }
      default:
        return []; // a kind this version doesn't know yet
    }
  }

  private url(id: string | undefined): UrlTrail | undefined {
    return id ? this.urls.get(id) : undefined;
  }

  /**
   * A drop for a link that was never announced: the engine's safety filter can remove a link before its
   * `url.found` goes out, so it has no host and no mark. It still counts in the tray, once per id.
   */
  private unseenDrop(id: string | undefined, reason: string | undefined): Effect[] {
    if (!id || !reason || !(reason in this.tray) || this.unseen.has(id)) return [];
    this.unseen.add(id);
    this.tray[reason as TrayBucket]++;
    return [];
  }

  private markSafety(u: UrlTrail) {
    u.safety = true;
    u.host = null;
    u.engine = null;
    u.depth = null;
    u.score = undefined;
  }

  /** The throttled screen-reader line for the current stage ("Collect: 212 links found, 48 kept"). */
  summaryLine(): string {
    const st = this.currentStage();
    if (this.terminal === "completed")
      return `Done: ${this.entities.size || (this.counts.entities_found ?? 0)} entities found.`;
    if (this.terminal === "failed") return "The investigation stopped.";
    if (this.terminal === "cancelled") return "The investigation was cancelled.";
    const found = Math.max(this.found, this.counts.results_found ?? 0);
    switch (st) {
      case "refine":
        return `Refine: ${this.queries.filter(Boolean).length} queries`;
      case "collect":
        return `Collect: ${found} links found, ${this.engines.size} search engines`;
      case "filter":
        return `Filter: ${found} links found, ${this.kept} kept, ${this.discarded} discarded`;
      case "fetch":
        return `Fetch: ${this.pagesRead()} pages read, ${this.discarded} discarded`;
      case "extract":
        return `Extract: ${this.pageEntities()} entities found`;
      case "enrich":
        return `Enrich: ${this.enrich.size} sources checked`;
      case "graph":
        return `Graph: ${this.graph?.nodes ?? this.entities.size} nodes, ${this.graph?.edges ?? this.edges.length} links`;
      case "summarize":
        return "Writing the summary";
      default:
        return "Starting";
    }
  }
}

/** Format bytes for the trail ("41 KB"). */
export function formatBytes(n: number | undefined): string | null {
  if (n === undefined) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Plain words for a fetch outcome ("404", "timeout", "Tor error", "read"). */
export function outcomeLabel(outcome: string): string {
  if (outcome === "ok") return "read";
  if (outcome === "no_key") return "no key";
  if (outcome === "rate_limited") return "rate limited";
  if (outcome === "disabled") return "off";
  if (outcome === "error") return "error";
  if (outcome === "skipped") return "skipped";
  if (outcome === "safety_dropped") return "safety filter";
  return TRAY_LABEL[outcome as TrayBucket] ?? outcome;
}
