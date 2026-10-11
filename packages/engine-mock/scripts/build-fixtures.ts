/**
 * Converts raw E0/E1B baseline CLI payloads (`result.json` from
 * gs://voidaccess-cloud-runs/baseline/<id>/) into redacted ResultBundle fixtures.
 *
 *   tsx scripts/build-fixtures.ts <raw-dir>
 *
 * <raw-dir> holds the downloaded `*.json` files named as in FIXTURE_SOURCES below.
 * Raw inputs are NEVER committed. Output: fixtures/<name>.bundle.json + fixtures/<name>.progress.json.
 * Redaction rules are documented in fixtures/README.md and implemented in `redact` below.
 */
/* eslint-disable no-control-regex, @typescript-eslint/no-explicit-any -- one-off conversion script over untyped raw JSON */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ResultBundle,
  checkBundleIntegrity,
  isSensitiveType,
  maskEntityValue,
  secretValueToken,
  isSecretType,
  type BundleActor,
  type BundleEntity,
  type BundleRelationship,
  type BundleSource,
  type EntityType,
  type SourceKind,
  ENTITY_TYPES,
} from "@voidaccess/engine-client";

/** name -> raw file (stem) in <raw-dir>. Stems are the GCS folder names under baseline/. */
const FIXTURE_SOURCES = [
  { name: "lockbit-deep", raw: "e1b1791745003-000", note: "E1B wave run, query q01, deep" },
  { name: "dprk-deep-typed", raw: "e1b1791746263-002", note: "E1B wave run, query q03, deep" },
  { name: "blackcat-standard-onion", raw: "e1b1791746263-006", note: "E1B wave run, query q02, standard" },
] as const;

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "fixtures");

// ---------- deterministic fakes ----------
const sha = (s: string) => createHash("sha256").update(s).digest();
const hexOf = (s: string, n: number) => sha(s).toString("hex").slice(0, n);
function pick<T>(list: readonly T[], seed: string, salt: string): T {
  return list[sha(`${salt}:${seed}`).readUInt32BE(0) % list.length] as T;
}
function charsFrom(alphabet: string, seed: string, n: number): string {
  let out = "";
  let i = 0;
  while (out.length < n) {
    const b = sha(`${seed}:${i++}`);
    for (const byte of b) {
      if (out.length >= n) break;
      out += alphabet[byte % alphabet.length];
    }
  }
  return out;
}
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B32 = "abcdefghijklmnopqrstuvwxyz234567";
const ADJ = [
  "Northwind",
  "Harborview",
  "Summit",
  "Bluegate",
  "Cedar",
  "Ironbridge",
  "Lakeshore",
  "Redwood",
  "Silverline",
  "Pinecrest",
  "Granite",
  "Oakmont",
  "Brightwater",
  "Falcon",
  "Meridian",
  "Stonehaven",
];
const NOUN = [
  "Logistics",
  "Dental Group",
  "Manufacturing",
  "Capital",
  "Health Partners",
  "Foods",
  "Energy",
  "Insurance",
  "Textiles",
  "Systems",
  "Law Offices",
  "Construction",
  "Retail",
  "Schools",
  "Freight",
  "Clinics",
];
const HANDLE_A = ["shadow", "quiet", "iron", "pale", "night", "cold", "rusty", "silent", "vivid", "hollow"];
const HANDLE_B = [
  "broker",
  "vendor",
  "ghost",
  "mantis",
  "raven",
  "wolf",
  "cipher",
  "lotus",
  "badger",
  "crow",
];

const used = new Set<string>();
function unique(base: string, seed: string): string {
  let v = base;
  let k = 0;
  while (used.has(v))
    v = `${base} ${["II", "III", "IV", "V", "VI", "VII", "VIII"][k++] ?? hexOf(seed + k, 3)}`;
  used.add(v);
  return v;
}

const PUBLIC_HOSTS = new Set([
  "attack.mitre.org",
  "www.cisa.gov",
  "cisa.gov",
  "nvd.nist.gov",
  "cve.mitre.org",
  "krebsonsecurity.com",
  "www.bleepingcomputer.com",
  "thehackernews.com",
]);
const hostOf = (u: string) => {
  try {
    return new URL(/^https?:\/\//i.test(u) ? u : `http://${u}`).host.toLowerCase();
  } catch {
    return "";
  }
};

const fakeOnionHost = (seed: string) => charsFrom(B32, `onion:${seed}`, 55) + "d.onion";
const fakeOrg = (v: string) => unique(`${pick(ADJ, v, "oa")} ${pick(NOUN, v, "on")}`, v);
const fakeHandle = (v: string) =>
  `${pick(HANDLE_A, v, "ha")}_${pick(HANDLE_B, v, "hb")}${(sha(v).readUInt16BE(4) % 90) + 10}`;
const fakeIp = (v: string) => {
  const b = sha(`ip:${v}`);
  const net = ["198.51.100", "203.0.113", "192.0.2"][b[0]! % 3];
  return `${net}.${(b[1]! % 253) + 1}`;
};
const fakeWallet = (type: string, v: string): string => {
  switch (type) {
    case "BITCOIN_ADDRESS":
      return "1" + charsFrom(B58, `w:${v}`, 33);
    case "LITECOIN_ADDRESS":
      return "L" + charsFrom(B58, `w:${v}`, 33);
    case "DOGECOIN_ADDRESS":
      return "D" + charsFrom(B58, `w:${v}`, 33);
    case "ETHEREUM_ADDRESS":
    case "ETH_ADDRESS":
      return "0x" + hexOf(`w:${v}`, 40);
    case "MONERO_ADDRESS":
      return "4" + charsFrom(B58, `w:${v}`, 94);
    default:
      return "T" + charsFrom(B58, `w:${v}`, 33);
  }
};
const fakeEmail = (v: string) => `${pick(HANDLE_B, v, "ea")}${hexOf(v, 3)}@example.org`;
function fakeUrl(v: string): string {
  const host = hostOf(v);
  if (host.endsWith(".onion"))
    return `http://${fakeOnionHost(host)}${hexOf(v, 6) === "" ? "" : `/p/${hexOf(v, 6)}`}`;
  if (PUBLIC_HOSTS.has(host)) {
    try {
      return new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`).origin + "/";
    } catch {
      return `https://${host}/`;
    }
  }
  return `https://${pick(HANDLE_A, host, "ua")}-${hexOf(host, 4)}.example.net/${hexOf(v, 6)}`;
}

// ---------- text scrubbing ----------
type Replacements = Map<string, string>;
const RE_ONION = /\b(?:https?:\/\/)?[a-z2-7]{16,56}\.onion\b(?:\/[^\s)"']*)?/gi;
const RE_EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g;
const RE_IP = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const RE_URL = /\bhttps?:\/\/[^\s)"']+/gi;
const RE_DEFANGED = /\b[\w-]+(?:\[\.\][\w-]+)+\b/g;
const RE_WALLET =
  /\b(?:bc1[a-z0-9]{20,60}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|0x[0-9a-fA-F]{40}|4[0-9AB][1-9A-HJ-NP-Za-km-z]{93})\b/g;
const RE_HANDLE = /(?<![\w@])@[A-Za-z0-9_]{4,32}\b/g;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function scrub(text: string, reps: Replacements): string {
  let t = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ");
  for (const [orig, fake] of reps) t = t.replace(new RegExp(esc(orig), "gi"), fake);
  t = t
    .replace(RE_ONION, (m) => `http://${fakeOnionHost(m)}`)
    .replace(RE_EMAIL, (m) => fakeEmail(m))
    .replace(RE_URL, (m) => fakeUrl(m))
    .replace(RE_DEFANGED, (m) => `${hexOf(m, 4)}.example.net`)
    .replace(RE_IP, (m) => fakeIp(m))
    .replace(RE_WALLET, (m) => fakeWallet("BITCOIN_ADDRESS", m))
    .replace(RE_HANDLE, (m) => `@${fakeHandle(m)}`);
  return t.replace(/\s+/g, " ").trim();
}
const excerpt = (text: string, reps: Replacements) => {
  const s = scrub(text, reps);
  return s.length <= 200 ? s : s.slice(0, 197).trimEnd() + "...";
};

// ---------- conversion ----------
type RawEntity = {
  id: string;
  entity_type: string;
  value: string;
  confidence: number | string;
  context_snippet?: string;
  source_url?: string;
  first_seen?: string;
  last_seen?: string;
  extraction_method?: string;
  suppressed?: boolean | string;
};
type RawRel = { entity_a_id: string; entity_b_id: string; relationship_type: string; confidence: number };
type RawPage = { url: string; source: string };

function redactEntity(type: EntityType, value: string): string {
  const v = value.trim();
  switch (type) {
    case "ORGANIZATION_NAME":
      return fakeOrg(v);
    case "THREAT_ACTOR_HANDLE":
    case "TELEGRAM_HANDLE":
    case "DISCORD_HANDLE":
    case "MATRIX_HANDLE":
    case "SESSION_ID":
    case "TOX_ID":
    case "WICKR_ID":
    case "WIRE_HANDLE":
      return fakeHandle(v);
    case "EMAIL_ADDRESS":
    case "XMPP_JID":
      return fakeEmail(v);
    case "IP_ADDRESS":
      return fakeIp(v);
    case "IPV6_ADDRESS":
      return `2001:db8::${hexOf(v, 4)}:${hexOf(v + "x", 4)}`;
    case "URL":
    case "PASTE_URL":
      return fakeUrl(v);
    case "ONION_URL":
      return `http://${fakeOnionHost(hostOf(v) || v)}`;
    case "DOMAIN":
      return `${hexOf(v, 6)}.example.net`;
    case "PGP_KEY_BLOCK":
      return `pgp:${hexOf(v, 16)}`;
    case "PHONE_NUMBER":
      return `+1555${(sha(v).readUInt32BE(0) % 9000000) + 1000000}`;
    case "PERSON_NAME":
      return `${pick(["Alex", "Sam", "Jordan", "Casey", "Riley"], v, "pf")} ${pick(["Hart", "Lowe", "Voss", "Reyes", "Okafor"], v, "pl")}`;
    default:
      if (type.endsWith("_ADDRESS")) return fakeWallet(type, v);
      return v; // MALWARE_FAMILY, RANSOMWARE_GROUP, CVE_NUMBER, MITRE_*, FILE_HASH_*, DATE, LOCATION: public
  }
}

function sourceKind(page: RawPage): SourceKind {
  const s = page.source.toLowerCase();
  if (page.url.includes(".onion")) return "onion_page";
  if (s.includes("tor_search")) return "tor_search";
  if (s.includes("paste")) return "paste";
  if (s.includes("github") || s.includes("gitlab")) return "code_forge";
  if (s.includes("rss") || s.includes("mitre") || s.includes("cve") || s.includes("feed")) return "feed";
  return "enrichment";
}

function convert(rawFile: string, name: string): { bundle: ResultBundle; progress: Record<string, number> } {
  used.clear();
  const d = JSON.parse(readFileSync(rawFile, "utf8")) as {
    run_id: string;
    depth: "quick" | "standard" | "deep";
    engine_version: string;
    cli_payload: Record<string, any>;
    metrics: Record<string, any>;
  };
  const p = d.cli_payload;
  const m = d.metrics;
  const rawEntities = (p.entities as RawEntity[]).filter(
    (e) =>
      e.suppressed !== true &&
      e.suppressed !== "True" &&
      (ENTITY_TYPES as readonly string[]).includes(e.entity_type),
  );
  const rawRels = p.relationships as RawRel[];
  const pages = p.pages_scraped as RawPage[];

  // 1. entity values and the replacement table used to scrub free text
  const fakeById = new Map<string, string>();
  const reps: Replacements = new Map();
  for (const e of rawEntities) {
    const type = e.entity_type as EntityType;
    const fake = redactEntity(type, e.value);
    fakeById.set(e.id, fake);
    if (fake !== e.value.trim() && e.value.trim().length >= 4) reps.set(e.value.trim(), fake);
  }
  const sortedReps: Replacements = new Map([...reps].sort((a, b) => b[0].length - a[0].length));

  // 2. sources from pages_scraped (+ any entity source_url missing there)
  const completedAt = new Date(p.created_at as string);
  const startedAt = new Date(completedAt.getTime() - Number(m.duration_ms));
  const urls = [
    ...new Set([
      ...pages.map((x) => x.url),
      ...rawEntities.map((e) => e.source_url).filter((u): u is string => !!u),
    ]),
  ];
  const pageSource = new Map(pages.map((x) => [x.url, x.source]));
  const snippetByUrl = new Map<string, string>();
  for (const e of rawEntities)
    if (e.source_url && e.context_snippet && !snippetByUrl.has(e.source_url))
      snippetByUrl.set(e.source_url, e.context_snippet);
  const sourceIdByUrl = new Map<string, string>();
  const sources: BundleSource[] = urls.map((u, i) => {
    const id = `s${i + 1}`;
    sourceIdByUrl.set(u, id);
    const kind = sourceKind({ url: u, source: pageSource.get(u) ?? "enrichment" });
    const host = hostOf(u);
    const publicHost = PUBLIC_HOSTS.has(host);
    return {
      id,
      kind,
      name: publicHost ? host : `${kind.replace("_", " ")} #${i + 1}`,
      url: kind === "enrichment" && !host ? null : fakeUrl(u),
      fetched_at: new Date(
        startedAt.getTime() + Math.round(((i + 1) / (urls.length + 1)) * (Number(m.duration_ms) * 0.6)),
      ).toISOString(),
      excerpt: excerpt(snippetByUrl.get(u) ?? "", sortedReps),
    };
  });

  // 3. entities
  const entities: BundleEntity[] = rawEntities.map((e) => {
    const type = e.entity_type as EntityType;
    const fake = fakeById.get(e.id)!;
    const sensitive = isSensitiveType(type);
    const value = isSecretType(type) ? secretValueToken(fake) : fake;
    return {
      id: e.id,
      type,
      value,
      display_value: maskEntityValue(type, fake),
      sensitive,
      confidence: Math.max(0, Math.min(1, Number(e.confidence))),
      ...(e.first_seen ? { first_seen: new Date(e.first_seen).toISOString() } : {}),
      source_ids: e.source_url && sourceIdByUrl.has(e.source_url) ? [sourceIdByUrl.get(e.source_url)!] : [],
      tags: [e.extraction_method ? `method:${e.extraction_method.toLowerCase()}` : "method:unknown"],
    };
  });
  const entityById = new Map(entities.map((e) => [e.id, e]));

  // 4. relationships (typed edges + co-occurrence)
  const relationships: BundleRelationship[] = rawRels
    .filter((r) => entityById.has(r.entity_a_id) && entityById.has(r.entity_b_id))
    .map((r) => ({
      source: r.entity_a_id,
      target: r.entity_b_id,
      type: r.relationship_type,
      weight: Math.max(0, Math.min(1, Number(r.confidence))),
      evidence_source_ids: [
        ...new Set([
          ...entityById.get(r.entity_a_id)!.source_ids,
          ...entityById.get(r.entity_b_id)!.source_ids,
        ]),
      ],
    }));

  // 5. actors: one per ransomware group / actor handle
  const neighbours = new Map<string, string[]>();
  for (const r of relationships) {
    (neighbours.get(r.source) ?? neighbours.set(r.source, []).get(r.source)!).push(r.target);
    (neighbours.get(r.target) ?? neighbours.set(r.target, []).get(r.target)!).push(r.source);
  }
  const actors: BundleActor[] = entities
    .filter(
      (e) => e.type === "RANSOMWARE_GROUP" || e.type === "THREAT_ACTOR_HANDLE" || e.type === "THREAT_ACTOR",
    )
    .map((e, i) => {
      const n = [...new Set(neighbours.get(e.id) ?? [])].slice(0, 12);
      return {
        id: `a${i + 1}`,
        handle: e.value,
        aliases: [],
        entity_ids: [e.id, ...n],
        ...(e.first_seen ? { first_seen: e.first_seen, last_seen: e.first_seen } : {}),
        summary: `${e.type === "RANSOMWARE_GROUP" ? "Ransomware group" : "Actor handle"} referenced with ${n.length} related entities in this run.`,
      };
    });

  // 6. communities
  const byComm = new Map<number, string[]>();
  for (const [eid, cid] of Object.entries(p.communities as Record<string, number>)) {
    if (!entityById.has(eid)) continue;
    (byComm.get(cid) ?? byComm.set(cid, []).get(cid)!).push(eid);
  }
  const communities = [...byComm.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([id, ids]) => {
      const lead = ids
        .map((i) => entityById.get(i)!)
        .find(
          (e) =>
            e.type === "RANSOMWARE_GROUP" || e.type === "MALWARE_FAMILY" || e.type === "THREAT_ACTOR_HANDLE",
        );
      return { id, entity_ids: ids, ...(lead ? { label: lead.value } : {}) };
    });

  // 7. summary (scrubbed model text)
  const markdown = scrub(String(p.summary ?? ""), sortedReps).slice(0, 6000);
  const sentences = markdown
    .replace(/[#*`]/g, "")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40);
  const avgConf = entities.reduce((a, e) => a + e.confidence, 0) / Math.max(1, entities.length);
  const typed = relationships.filter((r) => r.type !== "CO_APPEARED_ON").length;
  const stageMs = (m.stage_ms_events ?? {}) as Record<string, number>;
  const counts = (m.progress_counts ?? {}) as Record<string, number>;
  const bundle: ResultBundle = {
    schema_version: 1,
    run_id: `fixture-${name}`,
    query: scrub(String(p.query), sortedReps),
    refined_queries: [scrub(String(p.refined_query), sortedReps)],
    depth: d.depth,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    engine_version: String(d.engine_version).slice(0, 8),
    summary: {
      markdown,
      key_findings: sentences.slice(0, 4).map((s) => (s.length > 220 ? s.slice(0, 217) + "..." : s)),
      risk_notes: [
        typed > 0
          ? `${typed} typed relationships are model-extracted co-mentions and are not verified attribution.`
          : "Relationships are co-occurrence only; no typed relationships were extracted.",
        `${entities.filter((e) => e.sensitive).length} entities are flagged sensitive and shown masked.`,
      ],
      confidence: avgConf >= 0.85 ? "high" : avgConf >= 0.7 ? "medium" : "low",
      source_count: sources.length,
    },
    entities,
    relationships,
    actors,
    communities,
    sources,
    metrics: {
      duration_ms: Math.round(Number(m.duration_ms)),
      tor_bootstrap_ms: Math.round(Number(m.tor_bootstrap_ms)),
      stage_ms: Object.fromEntries(Object.entries(stageMs).map(([k, v]) => [k, Math.round(Number(v))])),
      llm_calls: Number(m.llm_calls_recorded ?? m.llm_calls_from_steps ?? 0),
      llm_tokens_in: Number(m.prompt_tokens ?? 0),
      llm_tokens_out: Number(m.completion_tokens ?? 0),
      llm_cost_usd: Number(m.llm_cost_usd ?? 0),
      pages_fetched: Number(counts.pages_fetched ?? m.pages_count ?? pages.length),
      bytes_fetched: Math.round(Number(m.bytes_fetched ?? 0)),
      enrichment_calls: Object.fromEntries(
        Object.entries((p.sources_used ?? {}) as Record<string, { count?: number }>)
          .filter(([, v]) => (v.count ?? 0) > 0)
          .map(([k, v]) => [k, v.count!]),
      ),
    },
  };
  const progress = {
    sources_queried: counts.sources_queried ?? Object.keys(p.sources_used ?? {}).length,
    results_found: counts.results_found ?? sources.length,
    pages_fetched: bundle.metrics.pages_fetched,
    entities_found: entities.length,
    actors_found: actors.length,
  };
  return { bundle: ResultBundle.parse(bundle), progress };
}

const rawDir = process.argv[2];
if (!rawDir) {
  console.error("usage: tsx scripts/build-fixtures.ts <raw-dir>");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
for (const f of FIXTURE_SOURCES) {
  const { bundle, progress } = convert(join(rawDir, `${f.raw}.json`), f.name);
  const problems = checkBundleIntegrity(bundle);
  if (problems.length) throw new Error(`${f.name}: ${problems.slice(0, 5).join("; ")}`);
  writeFileSync(join(outDir, `${f.name}.bundle.json`), JSON.stringify(bundle, null, 1) + "\n");
  writeFileSync(join(outDir, `${f.name}.progress.json`), JSON.stringify(progress) + "\n");
  const typedRel = bundle.relationships.filter((r) => r.type !== "CO_APPEARED_ON").length;
  console.log(
    `${f.name}: ${bundle.entities.length} entities, ${bundle.relationships.length} rels (${typedRel} typed), ${bundle.actors.length} actors, ${bundle.communities.length} communities, ${bundle.sources.length} sources`,
  );
}
