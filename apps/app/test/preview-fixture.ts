/**
 * A synthetic completed run for the preview leak test: every field that can carry report content holds a unique
 * canary token. Tokens are "qzx" + 5 lowercase letters (letters only, so they survive defanging, lowercasing and
 * base32 checks). Invented values only: no real hosts, no real dark-web text.
 *
 * `visible` tokens are what a preview MAY show (title/query, the first summary sentences, the first 2 rows of each
 * section, the 2 visible sources' host and title). Every other token is `locked` and must never reach a preview client.
 */
import type { ResultBundle } from "@voidaccess/engine-client";

let n = 0;
const letters = (i: number) => {
  let s = "";
  for (let k = 0; k < 5; k++) {
    s = String.fromCharCode(97 + (i % 26)) + s;
    i = Math.floor(i / 26);
  }
  return s;
};

export interface CanaryRun {
  bundle: ResultBundle;
  /** tokens a preview must never receive */
  locked: Map<string, string>;
  /** tokens a preview may receive (the first rows, the first sentences) */
  visible: Map<string, string>;
  /** stored artifacts (STIX / Sigma) */
  artifacts: Record<string, string>;
  /** trace events to store in run_events */
  traces: { kind: string; stage: string; data: Record<string, unknown> }[];
}

export function canaryRun(): CanaryRun {
  const locked = new Map<string, string>();
  const visible = new Map<string, string>();
  const tok = (label: string, show = false) => {
    const t = `qzx${letters(1000 + n++ * 7)}`;
    (show ? visible : locked).set(t, label);
    return t;
  };
  const started = "2026-10-11T10:00:00.000Z";

  // sources: fetched in order, so s0 and s1 are the visible rows (host + title only)
  const sources = Array.from({ length: 6 }, (_, i) => {
    const show = i < 2;
    return {
      id: `s${i}`,
      kind: (i % 2 ? "onion_page" : "paste") as "onion_page" | "paste",
      name: `${tok(`source ${i} title`, show)} forum post`,
      url: `http://${tok(`source ${i} host`, show)}.example.net/${tok(`source ${i} path`)}/p`,
      fetched_at: new Date(Date.parse(started) + i * 60_000).toISOString(),
      excerpt: `excerpt ${tok(`source ${i} excerpt`)} text`,
      relevance: "direct" as const,
      relevance_reason: `term_match:${tok(`source ${i} relevance reason`)}`,
      page_kind: "forum_thread" as const,
    };
  });

  // entities: e0, e1 have the highest confidence (the default order), so they are the 2 visible rows
  const types = [
    "DOMAIN",
    "DOMAIN",
    "BITCOIN_ADDRESS",
    "MALWARE_FAMILY",
    "DOMAIN",
    "TELEGRAM_HANDLE",
    "ORGANIZATION_NAME",
    "DOMAIN",
    "CVE_NUMBER",
  ] as const;
  const entities = types.map((type, i) => {
    const show = i < 2;
    const t = tok(`entity ${i} value`, show);
    const value = type === "DOMAIN" ? `${t}.example.net` : t;
    return {
      id: `e${i}`,
      type,
      value,
      display_value: value,
      sensitive: false,
      confidence: show ? 0.99 - i * 0.01 : 0.5 - i * 0.01,
      first_seen: started,
      source_ids: [`s${i % sources.length}`],
      tags: [`note:${tok(`entity ${i} tag`, show)}`],
      relevance: "direct" as const,
      relevance_reason: `term_match:${tok(`entity ${i} relevance reason`, show)}`,
    };
  });

  const relationships = entities.slice(1).map((e, i) => ({
    source: entities[i]!.id,
    target: e.id,
    type: "CO_APPEARED_ON",
    weight: 0.5,
    evidence_source_ids: [`s${i % sources.length}`],
    relevance: "direct" as const,
  }));

  // actors are ordered by handle; tokens grow with n, so the first two created sort first
  const actors = Array.from({ length: 4 }, (_, i) => {
    const show = i < 2;
    return {
      id: `a${i}`,
      handle: tok(`actor ${i} handle`, show),
      aliases: [tok(`actor ${i} alias`, show)],
      entity_ids: [`e${2 + i}`, `e${3 + i}`],
      first_seen: started,
      last_seen: started,
      summary: `Profile ${tok(`actor ${i} profile`, show)} text.`,
    };
  });

  const summary = [
    "# Intelligence summary",
    "",
    `The run found activity around ${tok("summary sentence 1", true)}. A second sentence names ${tok("summary sentence 2", true)}. A third one is visible too.`,
    `The fourth sentence is locked: ${tok("summary sentence 4")}. So is the fifth, ${tok("summary sentence 5")}.`,
    "",
    `- a list item ${tok("summary list item")}`,
    "",
    `| col | ${tok("summary table cell")} |`,
    "",
    `Closing paragraph ${tok("summary closing")}.`,
  ].join("\n");

  const bundle: ResultBundle = {
    schema_version: 1,
    run_id: "pv-leak-run",
    query: "preview leak test query",
    refined_queries: [tok("refined query 1"), tok("refined query 2")],
    depth: "standard",
    started_at: started,
    completed_at: "2026-10-11T10:05:00.000Z",
    engine_version: "test",
    summary: {
      markdown: summary,
      key_findings: [`Finding ${tok("key finding 1")}`, `Finding ${tok("key finding 2")}`],
      risk_notes: [`Risk ${tok("risk note")}`],
      confidence: "medium",
      source_count: sources.length,
      summary_kind: "llm",
    },
    entities,
    relationships,
    actors,
    communities: [{ id: 0, entity_ids: entities.map((e) => e.id), label: tok("community label") }],
    sources,
    metrics: {
      duration_ms: 1000,
      tor_bootstrap_ms: 10,
      stage_ms: {},
      llm_calls: 0,
      llm_tokens_in: 0,
      llm_tokens_out: 0,
      llm_cost_usd: 0,
      pages_fetched: sources.length,
      bytes_fetched: 0,
      enrichment_calls: {},
    },
    relevance: {
      query_intent: tok("query intent"),
      pages: { direct: 6, related: 0, background: 0 },
      entities: { direct: 9, related: 0, background: 0 },
      relationships: { direct: 8, related: 0, background: 0 },
      removed: { gazetteer_context: 0, org_boilerplate: 0 },
      feed_items_capped: 0,
      filter_fallback: false,
      refined_query_restored: false,
    },
  };

  const artifacts = {
    stix: JSON.stringify({ type: "bundle", id: "bundle--x", note: tok("stix artifact") }),
    sigma: `title: ${tok("sigma artifact")}\n`,
  };

  const traces = [
    { kind: "query.refined", stage: "refine", data: { index: 0, text: tok("trace refined text") } },
    { kind: "search.request", stage: "collect", data: { engine: "ahmia", query_index: 0 } },
    {
      kind: "search.result",
      stage: "collect",
      data: { engine: "ahmia", query_index: 0, status: "ok", results: 3 },
    },
    {
      kind: "url.found",
      stage: "collect",
      data: { url_id: "u1", host: `${tok("trace host")}[.]example`, engine: "ahmia" },
    },
    { kind: "url.kept", stage: "filter", data: { url_id: "u1", score: 0.9 } },
    { kind: "page.fetched", stage: "fetch", data: { url_id: "u1", outcome: "ok", ms: 10 } },
    {
      kind: "entity.found",
      stage: "extract",
      data: { entity_id: "e1", type: "DOMAIN", display: tok("trace entity display"), url_id: "u1" },
    },
    { kind: "graph.progress", stage: "graph", data: { nodes: 9, edges: 8 } },
    { kind: "summary.status", stage: "summarize", data: { kind: "llm" } },
    // a kind from a newer engine: only its numbers may pass
    { kind: "future.kind", stage: "collect", data: { note: tok("unknown trace kind text"), n: 1 } },
  ];

  return { bundle, locked, visible, artifacts, traces };
}

/** Every locked token found in `text` (case-insensitive), with its label. */
export function leaks(text: string, locked: Map<string, string>): string[] {
  const t = text.toLowerCase();
  return [...locked].filter(([tok]) => t.includes(tok)).map(([tok, label]) => `${label} (${tok})`);
}
