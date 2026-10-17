/**
 * Deterministic contract-v2 trace planner for the mock engine.
 *
 * Plans a realistic run (per stage, with relative times in [0, 1) inside the stage) from a fixture bundle and a
 * seed. The same seed and fixture always give the same plan, so tests are stable. Caps are NOT applied here:
 * the emitter in run.ts enforces TRACE_CAPS / TRACE_TOTAL_CAP and emits `trace.truncated`, like the engine.
 *
 * Volumes (approx.):
 *   level true:   4 queries, 32 search pairs, ~300-360 urls, ~20% kept, ~1000-1300 events in total.
 *   level "full": 26 queries (208 search pairs, over the 200 cap), 600 urls, ~62% kept, page.entities at its cap,
 *                 entity.found and graph.progress pushed up: ~2550-2750 events after caps.
 */
import {
  MaskedDisplay,
  STAGES,
  displayHost,
  type ResultBundle,
  type Stage,
  type TraceDataOf,
  type TraceKind,
} from "@voidaccess/engine-client";

export type TraceLevel = true | "full";

/** Live counter a planned item moves when it is played (keeps `counts` consistent with the trace). */
export type TraceEffect = "result" | "page" | "entity";

export type PlannedTrace = {
  [K in TraceKind]: { at: number; kind: K; data: TraceDataOf<K>; effect?: TraceEffect };
}[TraceKind];

export interface TracePlan {
  queries: string[];
  stages: Record<Stage, PlannedTrace[]>;
  /** World totals (before caps): urls found, ok page fetches, entities found. */
  totals: { results_found: number; pages_fetched: number; entities_found: number };
}

/** As the engine names them (spaces and brackets included). */
export const SEARCH_ENGINES = [
  "Ahmia",
  "Torch",
  "Excavator",
  "OnionLand",
  "Tor66",
  "The Deep Searches",
  "Ahmia (Clearnet Proxy)",
  "Torgle",
] as const;

const QUERY_SUFFIXES = [
  "leak site",
  "onion forum",
  "data dump",
  "negotiation portal",
  "affiliate panel",
  "TTPs",
  "IOC list",
  "victim list",
  "ransom note",
  "telegram channel",
  "breach forum post",
  "initial access broker",
  "builder leak",
  "decryptor",
  "mirror",
  "paste",
  "wallet",
  "credentials",
  "exploit",
  "CVE",
  "press release",
  "market listing",
  "tor mirror",
  "new victims",
  "chat logs",
  "infrastructure",
];

const CLEARNET_HOSTS = [
  "ransomlook.io",
  "github.com",
  "pastebin.com",
  "bleepingcomputer.com",
  "therecord.media",
  "securityweek.com",
  "reddit.com",
  "cisa.gov",
  "attack.mitre.org",
  "nvd.nist.gov",
  "thehackernews.com",
  "ransomware.live",
  "darkreading.com",
  "krebsonsecurity.com",
];

const EXTRA_ENRICH: { source: string; status: TraceDataOf<"enrich.source">["status"] }[] = [
  { source: "virustotal", status: "no_key" },
  { source: "shodan", status: "no_key" },
  { source: "otx", status: "timeout" },
  { source: "abuseipdb", status: "skipped" },
  { source: "hibp", status: "skipped" },
  { source: "urlscan", status: "error" },
];

// ---- seeded PRNG ----------------------------------------------------------------------------------------

/** FNV-1a 32-bit. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class Rng {
  private a: number;
  constructor(seed: number | string) {
    this.a = typeof seed === "string" ? hashSeed(seed) : seed >>> 0;
  }
  /** mulberry32, [0, 1). */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  /** Integer in [lo, hi]. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr;
  }
}

// ---- helpers --------------------------------------------------------------------------------------------

const item = <K extends TraceKind>(
  at: number,
  kind: K,
  data: TraceDataOf<K>,
  effect?: TraceEffect,
): PlannedTrace => ({ at, kind, data, ...(effect ? { effect } : {}) }) as PlannedTrace;

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
function onionHost(rng: Rng): string {
  let s = "";
  for (let i = 0; i < 55; i++) s += B32[Math.floor(rng.next() * 32)];
  return `${s}d.onion`; // v3 addresses end in "d" (version byte)
}

/**
 * Bursty offsets in [lo, hi): n items grouped into a few clusters (sorted). Not uniform, like a real stage
 * where work arrives in waves.
 */
export function burstOffsets(rng: Rng, n: number, lo = 0.02, hi = 0.95, avgBurst = 12): number[] {
  if (n <= 0) return [];
  const bursts = Math.max(1, Math.round(n / avgBurst));
  const centers = Array.from({ length: bursts }, () => rng.range(lo, hi)).sort((a, b) => a - b);
  const width = ((hi - lo) / bursts) * 0.25;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = centers[Math.min(bursts - 1, Math.floor((i * bursts) / n))]!;
    out.push(Math.min(hi, Math.max(lo, c + rng.range(0, width))));
  }
  return out.sort((a, b) => a - b);
}

const byAt = (a: PlannedTrace, b: PlannedTrace) => a.at - b.at;

/** Entity display for `entity.found`: bounded, defanged for links, masked emails, always MaskedDisplay-valid. */
export function entityDisplay(e: { type: string; display_value: string; value?: string }): string {
  let d = (e.display_value || e.value || "").trim();
  const isLinkType = ["URL", "ONION_URL", "DOMAIN", "PASTE_URL"].includes(e.type);
  if (/[a-z][a-z0-9+.-]*:\/\//i.test(d) || (isLinkType && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d)))
    d = displayHost(d) ?? `[${e.type.toLowerCase()}]`;
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  d = d.replace(/[<>\u0000-\u001f]/g, " ").trim();
  // mask any clear email local part to its first char
  d = d.replace(/([\w.+-]+)@([\w-]+\.[\w.-]+)/g, (_m, local: string, dom: string) =>
    local.includes("*") ? `${local}@${dom}` : `${local.slice(0, 1)}***@${dom}`,
  );
  if (d.length > 80) d = `${d.slice(0, 79)}…`;
  return d && MaskedDisplay.safeParse(d).success ? d : `[${e.type.toLowerCase()}]`;
}

function buildQueries(fx: ResultBundle, n: number): string[] {
  const base = fx.refined_queries.length ? fx.refined_queries : [fx.query];
  const out = base.slice(0, n).map((q) => q.slice(0, 200));
  const root = base[0]!.slice(0, 160);
  for (let i = 0; out.length < n; i++) out.push(`${root} ${QUERY_SUFFIXES[i % QUERY_SUFFIXES.length]}`);
  return out;
}

interface Url {
  id: string;
  host: string;
  onion: boolean;
  engine?: string;
  depth: number;
  dupOf?: string;
}

// ---- planner --------------------------------------------------------------------------------------------

export function planTrace(fx: ResultBundle, opts: { seed: string; level: TraceLevel }): TracePlan {
  const rng = new Rng(opts.seed);
  const full = opts.level === "full";
  const stages = Object.fromEntries(STAGES.map((s) => [s, [] as PlannedTrace[]])) as Record<
    Stage,
    PlannedTrace[]
  >;

  // ---- refine
  const queries = buildQueries(fx, full ? 26 : 4);
  burstOffsets(rng, queries.length, 0.3, 0.9, 4).forEach((at, index) =>
    stages.refine.push(item(at, "query.refined", { index, text: queries[index]! })),
  );

  // ---- collect: engines x queries, url bursts after each ok result
  type Res = {
    q: number;
    engine: string;
    at: number;
    status: TraceDataOf<"search.result">["status"];
    ms?: number;
  };
  const engineMode = (e: string): "ok" | "disabled" =>
    e === "Torgle" || (e === "OnionLand" && !full) ? "disabled" : "ok";
  const slot = 0.8 / queries.length;
  const results: Res[] = [];
  queries.forEach((_, q) => {
    const s = 0.02 + q * slot;
    SEARCH_ENGINES.forEach((engine, j) => {
      const reqAt = s + j * slot * 0.004;
      stages.collect.push(item(reqAt, "search.request", { engine, query_index: q }));
      const mode = engineMode(engine);
      if (mode !== "ok") {
        results.push({ q, engine, at: reqAt + slot * 0.01, status: mode });
        return;
      }
      const r = rng.next();
      const status = r < 0.07 ? "timeout" : r < 0.12 ? "error" : "ok";
      const ms =
        status === "timeout"
          ? 30_000
          : status === "error"
            ? rng.int(150, 3_000)
            : rng.int(engine === "Ahmia" ? 400 : 900, 24_000);
      results.push({ q, engine, at: s + slot * Math.min(0.9, 0.03 + (ms / 30_000) * 0.85), status, ms });
    });
  });

  const target = full ? 600 : rng.int(300, 360);
  const depth1 = Math.round(target * 0.15);
  const depth0 = target - depth1;
  const okRes = results.filter((r) => r.status === "ok").sort((a, b) => a.at - b.at);
  const weights = okRes.map(
    (r) => (r.engine === "Ahmia" ? 3 : r.engine === "Torch" ? 2 : 1) * rng.range(0.4, 1.6),
  );
  const wsum = weights.reduce((a, b) => a + b, 0);
  const alloc = okRes.map(() => 0);
  for (let i = 0; i < depth0; i++) {
    let x = rng.next() * wsum;
    let k = 0;
    while (k < weights.length - 1 && x >= weights[k]!) x -= weights[k++]!;
    alloc[k]!++;
  }

  const urls: Url[] = [];
  const sites: { host: string; onion: boolean }[] = [];
  const newSite = () => {
    const onion = !rng.chance(0.15);
    let host = displayHost(onion ? onionHost(rng) : rng.pick(CLEARNET_HOSTS))!;
    // the engine masks an onion name that contains an abuse term ("********…fcid[.]onion")
    if (onion && rng.chance(0.03)) host = "*".repeat(8) + host.slice(8);
    const site = { host, onion };
    sites.push(site);
    return site;
  };
  let uid = 0;
  const primaries: Url[] = []; // depth-0 urls that are not duplicates
  for (const r of results) {
    const k = okRes.indexOf(r);
    const n = k >= 0 ? alloc[k]! : 0;
    stages.collect.push(
      item(r.at, "search.result", {
        engine: r.engine,
        query_index: r.q,
        status: r.status,
        results: n,
        ...(r.ms !== undefined ? { ms: r.ms } : {}),
      }),
    );
    for (let i = 0; i < n; i++) {
      const at = r.at + 0.0002 + i * slot * 0.003;
      const other = primaries.filter((p) => p.engine !== r.engine);
      let u: Url;
      if (other.length && rng.chance(0.1)) {
        const orig = rng.pick(other);
        u = {
          id: `u${++uid}`,
          host: orig.host,
          onion: orig.onion,
          engine: r.engine,
          depth: 0,
          dupOf: orig.id,
        };
      } else {
        const site = sites.length && rng.chance(0.35) ? rng.pick(sites) : newSite();
        u = { id: `u${++uid}`, host: site.host, onion: site.onion, engine: r.engine, depth: 0 };
        primaries.push(u);
      }
      urls.push(u);
      stages.collect.push(
        item(at, "url.found", { url_id: u.id, host: u.host, engine: u.engine!, depth: 0 }, "result"),
      );
    }
  }
  // depth-1: crawled from onion sites found earlier, in a few late bursts
  const onionSites = sites.filter((s) => s.onion);
  burstOffsets(rng, depth1, 0.86, 0.98, 15).forEach((at) => {
    const site = onionSites.length && rng.chance(0.8) ? rng.pick(onionSites) : newSite();
    const u: Url = { id: `u${++uid}`, host: site.host, onion: site.onion, depth: 1 };
    urls.push(u);
    stages.collect.push(item(at, "url.found", { url_id: u.id, host: u.host, depth: 1 }, "result"));
  });
  stages.collect.sort(byAt);
  // url order as emitted (sort is stable, so ids follow the emitted order)
  const urlById = new Map(urls.map((u) => [u.id, u]));
  const foundOrder = stages.collect
    .filter((e) => e.kind === "url.found")
    .map((e) => urlById.get((e.data as { url_id: string }).url_id)!);

  // ---- filter
  type Reason = TraceDataOf<"url.dropped">["reason"];
  const decision = new Map<string, { kept: true; score: number } | { kept: false; reason: Reason }>();
  for (const u of foundOrder) if (u.dupOf) decision.set(u.id, { kept: false, reason: "duplicate" });
  const rest = foundOrder.filter((u) => !u.dupOf);
  const assign = (pool: Url[], n: number, reason: Reason) => {
    for (const u of rng.shuffle(pool.filter((x) => !decision.has(x.id))).slice(0, n))
      decision.set(u.id, { kept: false, reason });
  };
  assign(
    rest.filter((u) => u.onion),
    full ? 8 : rng.int(4, 6),
    "safety",
  );
  assign(
    rest.filter((u) => !u.onion),
    1,
    "ssrf",
  );
  assign(
    rest.filter((u) => !u.onion),
    full ? 2 : 1,
    "disabled_source",
  );
  assign(rest, Math.max(2, Math.round(rest.length * 0.02)), "invalid");
  // cap: the latest found depth-1 urls over the page budget
  const capN = Math.round(rest.length * 0.04);
  if (capN > 0)
    for (const u of rest.filter((x) => !decision.has(x.id) && x.depth === 1).slice(-capN))
      decision.set(u.id, { kept: false, reason: "cap" });
  const keepN = Math.round(foundOrder.length * (full ? 0.62 : rng.range(0.17, 0.22)));
  for (const u of rng.shuffle(rest.filter((x) => !decision.has(x.id))).slice(0, keepN))
    decision.set(u.id, { kept: true, score: Math.round(rng.range(0.52, 0.99) * 100) / 100 });
  for (const u of rest) if (!decision.has(u.id)) decision.set(u.id, { kept: false, reason: "irrelevant" });
  const filterAt = burstOffsets(rng, foundOrder.length, 0.03, 0.95, 40);
  foundOrder.forEach((u, i) => {
    const d = decision.get(u.id)!;
    stages.filter.push(
      d.kept
        ? item(filterAt[i]!, "url.kept", { url_id: u.id, score: d.score })
        : item(filterAt[i]!, "url.dropped", { url_id: u.id, reason: d.reason }),
    );
  });
  const kept = foundOrder.filter((u) => decision.get(u.id)!.kept);

  // ---- fetch: outcome mix, then a worker-pool timing model (8 parallel fetches)
  type Outcome = TraceDataOf<"page.fetched">["outcome"];
  const mix: [Outcome, number, number][] = [
    // outcome, share, minimum
    ["http_404", 0.08, 2],
    ["http_4xx", 0.04, 1],
    ["http_5xx", 0.05, 1],
    ["timeout", 0.1, 2],
    ["tor_error", 0.08, 2],
    ["error", 0.02, 1],
    ["empty", 0.04, 1],
    ["safety_dropped", 0.03, 2],
  ];
  const outcomes: Outcome[] = [];
  for (const [o, share, min] of mix)
    for (let i = 0; i < Math.max(min, Math.round(kept.length * share)); i++) outcomes.push(o);
  while (outcomes.length < kept.length) outcomes.push("ok");
  outcomes.length = kept.length;
  rng.shuffle(outcomes);
  // tor errors only happen on onion hosts: swap with an onion url's non-tor outcome
  kept.forEach((u, i) => {
    if (outcomes[i] !== "tor_error" || u.onion) return;
    const j = kept.findIndex((v, k) => v.onion && outcomes[k] !== "tor_error");
    if (j >= 0) [outcomes[i], outcomes[j]] = [outcomes[j]!, outcomes[i]!];
    else outcomes[i] = "timeout";
  });
  const workers = Array.from({ length: 8 }, () => 0);
  const fetches = kept.map((u, i) => {
    const outcome = outcomes[i]!;
    const ms =
      outcome === "timeout"
        ? 45_000
        : outcome === "tor_error"
          ? rng.int(2_000, 20_000)
          : u.onion
            ? rng.int(1_500, 28_000)
            : rng.int(200, 4_000);
    const w = workers.indexOf(Math.min(...workers));
    workers[w]! += ms;
    return { u, outcome, ms, end: workers[w]! };
  });
  const span = Math.max(1, ...workers);
  const okPages: Url[] = [];
  for (const f of fetches) {
    const at = 0.02 + (f.end / span) * 0.92;
    const base = { url_id: f.u.id };
    let data: TraceDataOf<"page.fetched">;
    switch (f.outcome) {
      case "safety_dropped":
        data = { ...base, outcome: "safety_dropped" };
        break;
      case "ok":
        data = { ...base, outcome: "ok", http_status: 200, bytes: rng.int(2_000, 450_000), ms: f.ms };
        okPages.push(f.u);
        break;
      case "http_404":
        data = { ...base, outcome: "http_404", http_status: 404, ms: f.ms };
        break;
      case "http_4xx":
        data = { ...base, outcome: "http_4xx", http_status: rng.pick([403, 410, 429]), ms: f.ms };
        break;
      case "http_5xx":
        data = { ...base, outcome: "http_5xx", http_status: rng.pick([500, 502, 503]), ms: f.ms };
        break;
      case "empty":
        data = { ...base, outcome: "empty", http_status: 200, bytes: rng.int(0, 180), ms: f.ms };
        break;
      default:
        data = { ...base, outcome: f.outcome, ms: f.ms };
    }
    stages.fetch.push(item(at, "page.fetched", data, f.outcome === "ok" ? "page" : undefined));
  }
  // The engine's post-scrape safety gate can remove a page that was already reported read: a second
  // page.fetched for the same url, and the latest wins.
  if (okPages.length > 4) {
    const gone = okPages.splice(rng.int(0, okPages.length - 1), 1)[0]!;
    stages.fetch.push(item(0.97, "page.fetched", { url_id: gone.id, outcome: "safety_dropped" }));
  }
  stages.fetch.sort(byAt);

  // ---- extract: fixture entities spread over ok pages (some pages rich, some empty)
  const pageWeight = okPages.map(() => rng.next() ** 2 + 0.02);
  const pwSum = pageWeight.reduce((a, b) => a + b, 0);
  const perPage = new Map<string, ResultBundle["entities"]>(okPages.map((p) => [p.id, []]));
  for (const e of fx.entities) {
    if (!okPages.length) break;
    let x = rng.next() * pwSum;
    let k = 0;
    while (k < pageWeight.length - 1 && x >= pageWeight[k]!) x -= pageWeight[k++]!;
    perPage.get(okPages[k]!.id)!.push(e);
  }
  const extractAt = burstOffsets(rng, okPages.length, 0.03, 0.95, 6);
  let eid = 0;
  okPages.forEach((p, i) => {
    const at = extractAt[i]!;
    const ents = perPage.get(p.id)!;
    const byType: Record<string, number> = {};
    for (const e of ents) byType[e.type] = (byType[e.type] ?? 0) + 1;
    // re-mentions of entities already known from other pages
    for (const t of Object.keys(byType)) if (rng.chance(0.3)) byType[t]! += rng.int(1, 3);
    stages.extract.push(item(at, "page.entities", { url_id: p.id, by_type: byType }));
    for (const e of ents)
      stages.extract.push(
        item(
          at,
          "entity.found",
          {
            entity_id: `e${++eid}`,
            type: e.type,
            display: entityDisplay(e),
            confidence: Math.round(Math.min(1, Math.max(0, e.confidence)) * 1000) / 1000,
            url_id: p.id,
          },
          "entity",
        ),
      );
  });

  // ---- enrich
  const enrich: TraceDataOf<"enrich.source">[] = [
    ...Object.entries(fx.metrics.enrichment_calls)
      .filter(([source]) => /^[A-Za-z0-9_.-]{1,40}$/.test(source))
      .map(([source, calls]) => ({
        source,
        status: "ok" as const,
        hits: Math.round(calls * rng.range(0.2, 0.9)),
      })),
    ...EXTRA_ENRICH.slice(0, full ? EXTRA_ENRICH.length : 4),
  ];
  burstOffsets(rng, enrich.length, 0.05, 0.95, 3).forEach((at, i) =>
    stages.enrich.push(item(at, "enrich.source", enrich[i]!)),
  );

  // ---- graph: monotonic steps up to the fixture's node / edge / community counts
  const steps = full ? 200 : 5;
  const nodes = fx.entities.length;
  const edges = fx.relationships.length;
  const comms = fx.communities.length;
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    stages.graph.push(
      item(0.05 + 0.9 * f - 0.9 / steps / 2, "graph.progress", {
        nodes: Math.round(nodes * Math.min(1, f * 1.4)),
        edges: Math.round(edges * f),
        ...(f > 0.5 || i === steps ? { communities: Math.round(comms * (i === steps ? 1 : f)) } : {}),
      }),
    );
  }

  // ---- summarize
  stages.summarize.push(item(rng.range(0.03, 0.08), "summary.status", { kind: "llm", attempt: 1 }));

  for (const s of STAGES) stages[s].sort(byAt);
  return {
    queries,
    stages,
    totals: {
      results_found: urls.length,
      pages_fetched: okPages.length,
      entities_found: okPages.length ? fx.entities.length : 0,
    },
  };
}
