/**
 * EVENT CONTRACT v2: `trace` events (identical in engine E3 and platform P8).
 *
 * v2 adds one event type, `trace`, and `schema: 2` on every event; schema-1 progress events are unchanged.
 *   trace = { type: "trace", schema: 2, run_id, seq, at, stage, kind, data }
 *
 * Validation is per event: an unknown `kind` is IGNORED (a newer engine may add kinds), a known kind with an
 * oversized or malformed field is REJECTED. Hosts are display forms only (defanged, never a URL or path), and
 * safety drops carry no host and no other detail (`sanitizeTrace` enforces that on top of the schema).
 *
 * Batches (runner -> app): `{ schema: 2, run_id, events: TraceEvent[] }`, signed like a single event with
 * `X-VA-Seq` = the seq of the LAST event in the batch. Batches carry trace events only; stage, counts, refined
 * and terminal events are always posted one by one, so ordering and settlement are unchanged.
 */
import { z } from "zod";
import { Stage } from "./stages";

export const TRACE_SCHEMA = 2 as const;
export const TRACE_BATCH_MAX = 50;

export const TRACE_KINDS = [
  "query.refined",
  "search.request",
  "search.result",
  "url.found",
  "url.kept",
  "url.dropped",
  "page.fetched",
  "page.entities",
  "entity.found",
  "enrich.source",
  "graph.progress",
  "summary.status",
  "trace.truncated",
  // contract v0.4 (engine 2.2): the LLM relevance filter returned nothing usable, every candidate was kept
  "filter_fallback",
] as const;
export type TraceKind = (typeof TRACE_KINDS)[number];

/** Per-run volume caps (contract defaults). Beyond a cap the engine emits `trace.truncated` once per kind. */
export const TRACE_CAPS: Record<TraceKind, number> = {
  "query.refined": 200,
  "search.request": 200,
  "search.result": 200,
  "url.found": 600,
  "url.kept": 600,
  "url.dropped": 600,
  "page.fetched": 400,
  "page.entities": 200,
  "entity.found": 300,
  "enrich.source": 200,
  "graph.progress": 200,
  "summary.status": 200,
  "trace.truncated": 200,
  filter_fallback: 200,
};
export const TRACE_TOTAL_CAP = 3000;

const Id = (prefix: "u" | "e") => z.string().regex(new RegExp(`^${prefix}[0-9]{1,6}$`));
const Name = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_.-]+$/);
/** A search engine or enrichment source as the engine names it ("Ahmia (Clearnet Proxy)"): text only, never markup. */
const SourceName = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z0-9_.() -]+$/);
const Count = z.number().int().nonnegative().max(1_000_000);
const Ms = z.number().int().nonnegative().max(3_600_000);

/**
 * Host display form: never a full URL, path or query. Onion: first 8 + "…" + last 4 + "[.]onion".
 * Clearnet: defanged ("example[.]com"). A plain dot is allowed in subdomains, but the host must be defanged.
 * The engine masks a name that contains an abuse term with "*" ("********…fcid[.]onion").
 */
export const DisplayHost = z
  .string()
  .min(4)
  .max(80)
  .regex(/^[a-z0-9.\-…*[\]]+$/i, "host must be a display host")
  .refine((h) => h.includes("[.]"), "host must be defanged");

/** Masked entity display: bounded, no markup, no URL scheme, no email with a clear local part. */
export const MaskedDisplay = z
  .string()
  .min(1)
  .max(80)
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  .refine((s) => !/[<>\u0000-\u001f]/.test(s), "no markup or control characters")
  .refine((s) => !/[a-z][a-z0-9+.-]*:\/\//i.test(s), "no URL scheme")
  .refine(
    (s) => !/(^|[^*\w.])[\w.+-]*[A-Za-z0-9]{2}[\w.+-]*@[\w-]+\.[\w.-]+/.test(s),
    "email must be masked",
  );

export const TraceData = {
  "query.refined": z.object({ index: Count.max(50), text: z.string().min(1).max(200) }),
  "search.request": z.object({ engine: SourceName, query_index: Count.max(50) }),
  "search.result": z.object({
    engine: SourceName,
    query_index: Count.max(50),
    status: z.enum(["ok", "error", "timeout", "disabled", "no_key", "rate_limited"]),
    results: Count,
    ms: Ms.optional(),
    outcome: z.enum(["ok", "empty", "unreachable", "rate_limited", "error"]).optional(),
  }),
  "url.found": z.object({
    url_id: Id("u"),
    host: DisplayHost,
    engine: SourceName.optional(),
    depth: Count.max(10).optional(),
  }),
  "url.kept": z.object({ url_id: Id("u"), score: z.number().min(0).max(1).optional() }),
  "url.dropped": z.object({
    url_id: Id("u"),
    reason: z.enum(["duplicate", "irrelevant", "cap", "invalid", "ssrf", "safety", "disabled_source"]),
  }),
  "page.fetched": z.object({
    url_id: Id("u"),
    outcome: z.enum([
      "ok",
      "http_404",
      "http_4xx",
      "http_5xx",
      "timeout",
      "tor_error",
      "too_large",
      "safety_dropped",
      "empty",
      "error",
    ]),
    http_status: z.number().int().min(100).max(599).optional(),
    bytes: z.number().int().nonnegative().max(1_000_000_000).optional(),
    ms: Ms.optional(),
  }),
  "page.entities": z.object({
    url_id: Id("u"),
    by_type: z.record(Name, Count).refine((r) => Object.keys(r).length <= 40, "too many types"),
  }),
  "entity.found": z.object({
    entity_id: Id("e"),
    type: Name,
    display: MaskedDisplay,
    confidence: z.number().min(0).max(1).optional(),
    url_id: Id("u").optional(),
  }),
  "enrich.source": z.object({
    source: SourceName,
    status: z.enum(["ok", "error", "timeout", "disabled", "no_key", "skipped", "rate_limited"]),
    hits: Count.optional(),
  }),
  "graph.progress": z.object({ nodes: Count, edges: Count, communities: Count.optional() }),
  "summary.status": z.object({
    kind: z.enum(["llm", "fallback", "none"]),
    attempt: Count.max(20).optional(),
  }),
  "trace.truncated": z.object({ kind: z.enum(TRACE_KINDS), dropped: Count }),
  /** counts only: which filter fell back (onion or clearnet search results), how many candidates, how many kept */
  filter_fallback: z.object({ scope: z.enum(["onion", "clearnet"]), candidates: Count, kept: Count }),
} as const satisfies Record<TraceKind, z.ZodType>;

export type TraceDataOf<K extends TraceKind> = z.infer<(typeof TraceData)[K]>;

/** The envelope, before `data` is checked against its kind. */
export const TraceEnvelope = z.object({
  type: z.literal("trace"),
  schema: z.literal(TRACE_SCHEMA),
  run_id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  at: z.iso.datetime({ offset: true }),
  stage: Stage,
  kind: z.string().min(1).max(40),
  data: z.record(z.string(), z.unknown()),
});

export type TraceEvent = {
  [K in TraceKind]: {
    type: "trace";
    schema: 2;
    run_id: string;
    seq: number;
    at: string;
    stage: Stage;
    kind: K;
    data: TraceDataOf<K>;
  };
}[TraceKind];

export const TraceBatch = z.object({
  schema: z.literal(TRACE_SCHEMA),
  run_id: z.string().min(1),
  events: z.array(z.unknown()).min(1).max(TRACE_BATCH_MAX),
});
export type TraceBatch = { schema: 2; run_id: string; events: TraceEvent[] };

export type TraceCheck =
  | { ok: true; event: TraceEvent }
  | { ok: false; ignored: true; seq?: number }
  | { ok: false; ignored: false; seq?: number; error: string };

const isKind = (k: string): k is TraceKind => (TRACE_KINDS as readonly string[]).includes(k);

/** Safety rule: a safety drop carries the url id and the reason/outcome, nothing else. */
export function sanitizeTrace(e: TraceEvent): TraceEvent {
  if (e.kind === "url.dropped" && e.data.reason === "safety")
    return { ...e, data: { url_id: e.data.url_id, reason: "safety" } };
  if (e.kind === "page.fetched" && e.data.outcome === "safety_dropped")
    return { ...e, data: { url_id: e.data.url_id, outcome: "safety_dropped" } };
  return e;
}

/** True when this trace event marks its URL as removed by the content-safety filter. */
export function isSafetyDrop(e: Pick<TraceEvent, "kind" | "data">): boolean {
  const d = e.data as { reason?: string; outcome?: string };
  return (
    (e.kind === "url.dropped" && d.reason === "safety") ||
    (e.kind === "page.fetched" && d.outcome === "safety_dropped")
  );
}

/** Validate one trace event: unknown kinds are ignored, malformed or oversized ones rejected. */
export function checkTrace(raw: unknown): TraceCheck {
  const env = TraceEnvelope.safeParse(raw);
  const seq =
    raw && typeof raw === "object" && typeof (raw as { seq?: unknown }).seq === "number"
      ? (raw as { seq: number }).seq
      : undefined;
  if (!env.success) {
    const kind = raw && typeof raw === "object" ? (raw as { kind?: unknown }).kind : undefined;
    // a well-formed envelope with a kind we don't know yet is a newer engine, not an error
    if (typeof kind === "string" && !isKind(kind)) return { ok: false, ignored: true, seq };
    return { ok: false, ignored: false, seq, error: "invalid envelope" };
  }
  const { kind } = env.data;
  if (!isKind(kind)) return { ok: false, ignored: true, seq };
  const data = TraceData[kind].safeParse(env.data.data);
  if (!data.success) return { ok: false, ignored: false, seq, error: `invalid ${kind}` };
  return { ok: true, event: sanitizeTrace({ ...env.data, kind, data: data.data } as TraceEvent) };
}

/** Display host for a URL, per the contract (onion: 8 + "…" + 4 + "[.]onion"; clearnet: defanged). */
export function displayHost(urlOrHost: string): string | null {
  let host: string;
  try {
    host = /^[a-z][a-z0-9+.-]*:\/\//i.test(urlOrHost) ? new URL(urlOrHost).hostname : urlOrHost;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/\.$/, "");
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".")) return null;
  if (host.endsWith(".onion")) {
    const label = host.slice(0, -".onion".length).split(".").pop() ?? "";
    if (label.length < 13) return `${label}[.]onion`;
    return `${label.slice(0, 8)}…${label.slice(-4)}[.]onion`;
  }
  const i = host.lastIndexOf(".");
  return `${host.slice(0, i)}[.]${host.slice(i + 1)}`;
}
