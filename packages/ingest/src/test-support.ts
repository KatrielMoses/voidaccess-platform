/**
 * Test and dev helpers: fixture-backed IngestDeps, a bundle with known raw sensitive values, and a
 * large-bundle generator. Not imported by production code.
 */
import { createHash } from "node:crypto";
import { loadFixture, type FixtureName } from "@voidaccess/engine-mock";
import { fingerprint, type ResultBundle } from "@voidaccess/engine-client";
import type { IngestDeps } from "./ingest";

/** Raw sensitive values that are injected into fixtures. A scan must never find them in storage. */
export const RAW_SENSITIVE = {
  email: "alice.operator@darkmail-test.example",
  email2: "bob.broker@darkmail-test.example",
  phone: "+15555550123",
  person: "Mallory Fixture",
  apiKey: "AKIAFIXTUREKEY0000000-sk_live_FIXTURE_RAW_SECRET_9f8e7d",
} as const;

export function rawSensitiveList(): string[] {
  return Object.values(RAW_SENSITIVE);
}

/**
 * A fixture plus sensitive entities: two emails, a phone, a person, a pre-redacted password token, and one
 * secret that (wrongly) carries its raw value, to exercise the vault path. Raw values are also planted in
 * an excerpt and the summary text to prove they are scrubbed.
 */
export function withSensitive(bundle: ResultBundle): ResultBundle {
  const b: ResultBundle = structuredClone(bundle);
  const srcs = b.sources.slice(0, 3).map((s) => s.id);
  const mk = (id: string, type: ResultBundle["entities"][number]["type"], value: string, display: string) =>
    ({
      id,
      type,
      value,
      display_value: display,
      sensitive: true,
      confidence: 0.9,
      first_seen: b.started_at,
      source_ids: srcs.slice(0, 2),
      tags: ["fixture:sensitive"],
    }) as ResultBundle["entities"][number];
  b.entities.push(
    mk("sx-email-1", "EMAIL_ADDRESS", RAW_SENSITIVE.email, "a***@darkmail-test.example"),
    mk("sx-email-2", "EMAIL_ADDRESS", RAW_SENSITIVE.email2, "b***@darkmail-test.example"),
    mk("sx-phone", "PHONE_NUMBER", RAW_SENSITIVE.phone, "+***23"),
    mk("sx-person", "PERSON_NAME", RAW_SENSITIVE.person, "M*** F***"),
    mk(
      "sx-pass",
      "COMBO_LIST_ENTRY",
      `len:14 sha256:${createHash("sha256").update("hunter2hunter2!").digest("hex").slice(0, 8)}`,
      "len:14",
    ),
    mk("sx-raw-key", "API_KEY", RAW_SENSITIVE.apiKey, "len:55"),
  );
  const anchor = b.entities.find((e) => e.type === "RANSOMWARE_GROUP") ?? b.entities[0]!;
  for (const id of ["sx-email-1", "sx-email-2", "sx-phone", "sx-pass", "sx-raw-key"])
    b.relationships.push({
      source: anchor.id,
      target: id,
      type: "CO_APPEARED_ON",
      weight: 0.5,
      evidence_source_ids: srcs.slice(0, 1),
    });
  if (b.sources[0])
    b.sources[0].excerpt = `contact ${RAW_SENSITIVE.email} or ${RAW_SENSITIVE.phone}`.slice(0, 500);
  b.summary.markdown += `\n\nContact seen: ${RAW_SENSITIVE.email} (${RAW_SENSITIVE.person}).`;
  b.summary.key_findings.push(`Key ${RAW_SENSITIVE.apiKey} was exposed`);
  return b;
}

type Tier = "direct" | "related" | "background";
const RANK: Record<Tier, number> = { direct: 0, related: 1, background: 2 };
const weaker = (a: Tier, b: Tier): Tier => (RANK[a] >= RANK[b] ? a : b);
const PAGE_KIND_CYCLE = ["leak_post", "forum_thread", "market_listing", "news_article", "directory"] as const;

/**
 * Gives a fixture the contract v0.4 relevance tiers, shaped like a real 22R run (engine 964100a): a few Direct values
 * (the ones that name the query), some Related, a long Background tail (agencies, unrelated organisations, feed
 * items), sources with a page kind, edges at the weaker tier of their ends, and the run-level summary.
 * `direct: false` makes a run where nothing collected mentions the query (every item Background, filter fallback).
 */
export function withTiers(bundle: ResultBundle, opts: { direct?: boolean } = {}): ResultBundle {
  const b: ResultBundle = structuredClone(bundle);
  const hasDirect = opts.direct ?? true;
  const words = b.query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 4);
  const nDirectSources = hasDirect ? Math.max(1, Math.round(b.sources.length * 0.25)) : 0;
  const nRelatedSources = hasDirect ? Math.max(1, Math.round(b.sources.length * 0.2)) : 0;
  b.sources.forEach((s, i) => {
    const tier: Tier =
      i < nDirectSources ? "direct" : i < nDirectSources + nRelatedSources ? "related" : "background";
    s.relevance = tier;
    s.relevance_reason =
      tier === "direct" ? `term_match:${words[0] ?? "query"}` : tier === "related" ? "refined_term" : "none";
    s.page_kind =
      tier === "background" && i % 3 === 0 ? "feed_item" : PAGE_KIND_CYCLE[i % PAGE_KIND_CYCLE.length];
  });
  b.entities.forEach((e, i) => {
    const names = words.some((w) => e.value.toLowerCase().includes(w));
    let tier: Tier;
    let reason: string;
    if (!hasDirect) [tier, reason] = ["background", "none"];
    else if (names) [tier, reason] = ["direct", "query_entity"];
    else if (e.type === "ORGANIZATION_NAME" || e.type === "LOCATION")
      [tier, reason] = ["background", "agency_not_near_match"];
    else if (i % 7 === 0) [tier, reason] = ["direct", "near_direct_match"];
    else if (i % 4 === 0) [tier, reason] = ["related", "related_page"];
    else [tier, reason] = ["background", "none"];
    e.relevance = tier;
    e.relevance_reason = reason;
  });
  const tierOf = new Map(b.entities.map((e) => [e.id, e.relevance as Tier]));
  for (const r of b.relationships)
    r.relevance = weaker(tierOf.get(r.source) ?? "background", tierOf.get(r.target) ?? "background");
  const count = (xs: { relevance?: Tier }[]) => ({
    direct: xs.filter((x) => x.relevance === "direct").length,
    related: xs.filter((x) => x.relevance === "related").length,
    background: xs.filter((x) => x.relevance === "background").length,
  });
  b.relevance = {
    query_intent: "named_threat",
    pages: count(b.sources),
    entities: count(b.entities),
    relationships: count(b.relationships),
    removed: { gazetteer_context: hasDirect ? 2 : 4, org_boilerplate: 1 },
    feed_items_capped: 169,
    filter_fallback: !hasDirect,
    refined_query_restored: false,
  };
  return b;
}

export function fixtureBundle(name: FixtureName, sensitive = true): ResultBundle {
  const { bundle } = loadFixture(name);
  return sensitive ? withSensitive(bundle) : bundle;
}

export function bundleDeps(
  bundle: unknown,
  artifacts: Record<string, string> = {},
): IngestDeps & { reads: number } {
  const deps = {
    reads: 0,
    async readBundle() {
      deps.reads++;
      return structuredClone(bundle);
    },
    async readExport(_runId: string, format: string) {
      const a = artifacts[format];
      return a === undefined ? null : new TextEncoder().encode(a);
    },
  };
  return deps;
}

/** Deterministic pseudo-random generator so large bundles are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const TYPES: Array<[ResultBundle["entities"][number]["type"], number]> = [
  ["ONION_URL", 30],
  ["DOMAIN", 12],
  ["IP_ADDRESS", 10],
  ["FILE_HASH_SHA256", 12],
  ["BITCOIN_ADDRESS", 8],
  ["CVE_NUMBER", 5],
  ["MALWARE_FAMILY", 5],
  ["RANSOMWARE_GROUP", 3],
  ["THREAT_ACTOR_HANDLE", 3],
  ["TELEGRAM_HANDLE", 4],
  ["ORGANIZATION_NAME", 6],
  ["EMAIL_ADDRESS", 2],
];

/** A large synthetic bundle (default 5,000 entities, 15,000 relationships) for ingest and graph performance checks. */
export function generateBundle(
  opts: { entities?: number; relationships?: number; sources?: number; seed?: number } = {},
): ResultBundle {
  const n = opts.entities ?? 5000;
  const m = opts.relationships ?? n * 3;
  const nSources = opts.sources ?? 300;
  const rand = rng(opts.seed ?? 42);
  const total = TYPES.reduce((a, [, w]) => a + w, 0);
  const pick = () => {
    let r = rand() * total;
    for (const [t, w] of TYPES) if ((r -= w) <= 0) return t;
    return TYPES[0]![0];
  };
  const hex = (len: number) =>
    Array.from({ length: len }, () => Math.floor(rand() * 16).toString(16)).join("");
  const started = "2026-10-11T10:00:00.000Z";
  const sources = Array.from({ length: nSources }, (_, i) => ({
    id: `s${i}`,
    kind: (["tor_search", "onion_page", "paste", "code_forge", "feed", "enrichment"] as const)[i % 6]!,
    name: `source #${i}`,
    url: i % 6 === 1 ? `http://${hex(56)}.onion/p/${hex(6)}` : null,
    fetched_at: started,
    excerpt: `Synthetic excerpt ${i}: mentions of entity cluster ${i % 50}.`,
  }));
  const entities = Array.from({ length: n }, (_, i) => {
    const type = pick();
    const value =
      type === "ONION_URL"
        ? `${hex(56)}.onion`
        : type === "DOMAIN"
          ? `host-${hex(6)}.example.net`
          : type === "IP_ADDRESS"
            ? `203.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`
            : type === "FILE_HASH_SHA256"
              ? hex(64)
              : type === "BITCOIN_ADDRESS"
                ? `bc1q${hex(38)}`
                : type === "CVE_NUMBER"
                  ? `CVE-2024-${10000 + i}`
                  : type === "EMAIL_ADDRESS"
                    ? `user${i}@example.org`
                    : type === "TELEGRAM_HANDLE"
                      ? `@actor_${i}`
                      : type === "ORGANIZATION_NAME"
                        ? `Org ${i}`
                        : type === "THREAT_ACTOR_HANDLE"
                          ? `handle_${i}`
                          : type === "RANSOMWARE_GROUP"
                            ? `Group${i}`
                            : `Malware${i}`;
    const sensitive = type === "EMAIL_ADDRESS";
    return {
      id: `e${i}`,
      type,
      value,
      display_value: sensitive ? `u***@example.org` : value,
      sensitive,
      confidence: Math.round((0.3 + rand() * 0.7) * 100) / 100,
      first_seen: started,
      source_ids: [sources[i % nSources]!.id],
      tags: i % 7 === 0 ? ["method:regex"] : ["method:ner"],
    };
  });
  const relTypes = [
    "CO_APPEARED_ON",
    "CO_APPEARED_ON",
    "CO_APPEARED_ON",
    "CO_APPEARED_ON",
    "TARGETS",
    "USES",
    "DROPS",
    "EXPLOITS",
  ];
  const rels = new Map<string, ResultBundle["relationships"][number]>();
  // preferential attachment toward a small hub set gives a realistic heavy-tailed degree distribution
  while (rels.size < m) {
    const a = Math.floor(rand() * n);
    const b = rand() < 0.4 ? Math.floor(rand() ** 3 * n) : Math.floor(rand() * n);
    if (a === b) continue;
    const type = relTypes[Math.floor(rand() * relTypes.length)]!;
    rels.set(`${a}-${b}-${type}`, {
      source: `e${a}`,
      target: `e${b}`,
      type,
      weight: 0.5,
      evidence_source_ids: [],
    });
  }
  const nComm = Math.max(5, Math.floor(n / 60));
  const communities = Array.from({ length: nComm }, (_, c) => ({ id: c, entity_ids: [] as string[] }));
  entities.forEach((e, i) => communities[i % nComm]!.entity_ids.push(e.id));
  const actors = entities
    .filter((e) => e.type === "RANSOMWARE_GROUP" || e.type === "THREAT_ACTOR_HANDLE")
    .slice(0, 40)
    .map((e, i) => ({
      id: `a${i}`,
      handle: e.value,
      aliases: [],
      entity_ids: [e.id],
      first_seen: started,
      last_seen: started,
      summary: "Synthetic actor.",
    }));
  return {
    schema_version: 1,
    run_id: "generated",
    query: "synthetic large bundle",
    refined_queries: ["synthetic large bundle"],
    depth: "deep",
    started_at: started,
    completed_at: "2026-10-11T10:05:00.000Z",
    engine_version: "gen",
    summary: {
      markdown: "### Synthetic\n\nA generated bundle.",
      key_findings: ["synthetic"],
      risk_notes: ["synthetic"],
      confidence: "medium",
      source_count: nSources,
    },
    entities,
    relationships: [...rels.values()],
    actors,
    communities,
    sources,
    metrics: {
      duration_ms: 300000,
      tor_bootstrap_ms: 1000,
      stage_ms: {},
      llm_calls: 0,
      llm_tokens_in: 0,
      llm_tokens_out: 0,
      llm_cost_usd: 0,
      pages_fetched: nSources,
      bytes_fetched: 0,
      enrichment_calls: {},
    },
  };
}

export { fingerprint };
