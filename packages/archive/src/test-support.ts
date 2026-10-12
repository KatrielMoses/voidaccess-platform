/** Test and dev helpers: a compact ResultBundle builder (fictional names only) and in-memory deps. Not used by production code. */
import { gzipSync } from "node:zlib";
import type { ResultBundle } from "@voidaccess/engine-client";
import type { ArchiveObjectStore } from "./store";
import type { ArchiveDeps, PageRecord } from "./types";

export interface SrcSpec {
  id: string;
  url: string | null;
  fetchedAt: string;
  kind?: ResultBundle["sources"][number]["kind"];
  name?: string;
  excerpt?: string;
}
export interface EntSpec {
  id: string;
  type: ResultBundle["entities"][number]["type"];
  value: string;
  sources: string[];
  sensitive?: boolean;
  firstSeen?: string;
}
export interface RelSpec {
  a: string;
  b: string;
  type?: string;
  evidence?: string[];
}
export interface BundleSpec {
  runId?: string;
  query?: string;
  sources: SrcSpec[];
  entities: EntSpec[];
  relationships?: RelSpec[];
}

/** A schema-valid bundle. The run id and query are deliberately recognisable so anonymity scans can look for them. */
export function makeBundle(spec: BundleSpec): ResultBundle {
  const started = "2026-10-11T10:00:00.000Z";
  return {
    schema_version: 1,
    run_id: spec.runId ?? "00000000-0000-4000-8000-000000000001",
    query: spec.query ?? "secret search phrase one",
    refined_queries: [`${spec.query ?? "secret search phrase one"} refined`],
    depth: "standard",
    started_at: started,
    completed_at: "2026-10-11T10:05:00.000Z",
    engine_version: "test",
    summary: {
      markdown: `Summary for ${spec.query ?? "secret search phrase one"}`,
      key_findings: [],
      risk_notes: [],
      confidence: "medium",
      source_count: spec.sources.length,
    },
    entities: spec.entities.map((e) => ({
      id: e.id,
      type: e.type,
      value: e.value,
      display_value: e.value,
      sensitive: Boolean(e.sensitive),
      confidence: 0.9,
      first_seen: e.firstSeen ?? started,
      source_ids: e.sources,
      tags: ["method:regex"],
    })),
    relationships: (spec.relationships ?? []).map((r) => ({
      source: r.a,
      target: r.b,
      type: r.type ?? "CO_APPEARED_ON",
      weight: 0.5,
      evidence_source_ids: r.evidence ?? [],
    })),
    actors: [],
    communities: [],
    sources: spec.sources.map((s) => ({
      id: s.id,
      kind: s.kind ?? "onion_page",
      name: s.name ?? `source ${s.id}`,
      url: s.url,
      fetched_at: s.fetchedAt,
      excerpt: s.excerpt ?? "",
    })),
    metrics: {
      duration_ms: 1000,
      tor_bootstrap_ms: 10,
      stage_ms: {},
      llm_calls: 0,
      llm_tokens_in: 0,
      llm_tokens_out: 0,
      llm_cost_usd: 0,
      pages_fetched: spec.sources.length,
      bytes_fetched: 0,
      enrichment_calls: {},
    },
  };
}

export class MemoryObjectStore implements ArchiveObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array) {
    if (this.objects.has(key)) return "exists" as const;
    this.objects.set(key, bytes);
    return "created" as const;
  }
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async deleteAll(key: string) {
    this.objects.delete(key);
  }
  async exists(key: string) {
    return this.objects.has(key);
  }
}

export function memoryDeps(
  bundle: unknown,
  pages: PageRecord[] | null,
  store: ArchiveObjectStore = new MemoryObjectStore(),
): ArchiveDeps & { store: ArchiveObjectStore } {
  return {
    store,
    objectStore: store,
    async readBundle() {
      return structuredClone(bundle);
    },
    readPages() {
      if (pages === null) return null;
      return (async function* () {
        for (const p of pages) yield p;
      })();
    },
  };
}

export function pagesGz(pages: PageRecord[]): Buffer {
  return gzipSync(Buffer.from(pages.map((p) => JSON.stringify(p)).join("\n") + "\n"));
}

const hex = (n: number) => Array.from({ length: n }, (_, i) => ((i * 7 + 3) % 16).toString(16)).join("");
/** Fictional onion hosts, stable per seed. */
export const onion = (seed: string, path = "") =>
  `http://${(seed.replace(/[^a-z2-7]/g, "a") + hex(56)).slice(0, 56)}.onion${path}`;
