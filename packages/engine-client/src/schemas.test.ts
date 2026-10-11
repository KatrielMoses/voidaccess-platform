import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ENTITY_TYPES, ProgressEvent, ResultBundle, RunSpec, STAGES, validateJsonSchema } from "./index";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
const load = (n: string) =>
  JSON.parse(readFileSync(join(dir, `${n}.json`), "utf8")) as Record<string, unknown>;

const metrics = {
  duration_ms: 1000,
  tor_bootstrap_ms: 10,
  stage_ms: { refine: 5 },
  llm_calls: 1,
  llm_tokens_in: 1,
  llm_tokens_out: 1,
  llm_cost_usd: 0.001,
  pages_fetched: 1,
  bytes_fetched: 10,
  enrichment_calls: { rdap: 2 },
};
const at = "2026-10-12T10:00:00.000Z";
const event = { run_id: "r1", seq: 0, at, type: "stage", stage: "refine", stage_index: 1, stage_total: 8 };
const spec = {
  run_id: "r1",
  query: "Akira ransomware",
  depth: "quick",
  callback_url: "http://localhost:1/cb",
  callback_secret: "0123456789abcdef",
  deadline_at: at,
  artifact_put_urls: { bundle: "http://localhost:1/bundle", exports: { stix: "http://localhost:1/stix" } },
};
const bundle = {
  schema_version: 1,
  run_id: "r1",
  query: "q",
  refined_queries: ["q2"],
  depth: "quick",
  started_at: at,
  completed_at: at,
  engine_version: "x",
  summary: { markdown: "m", key_findings: [], risk_notes: [], confidence: "low", source_count: 1 },
  entities: [
    {
      id: "e1",
      type: "CVE_NUMBER",
      value: "CVE-2024-3400",
      display_value: "CVE-2024-3400",
      sensitive: false,
      confidence: 0.9,
      source_ids: ["s1"],
      tags: [],
    },
  ],
  relationships: [],
  actors: [],
  communities: [{ id: 0, entity_ids: ["e1"] }],
  sources: [{ id: "s1", kind: "feed", name: "kev", url: null, fetched_at: at, excerpt: "x" }],
  metrics,
};

describe("zod schemas", () => {
  it("has 8 stages and a taxonomy covering the engine types", () => {
    expect(STAGES).toHaveLength(8);
    for (const t of [
      "RANSOMWARE_GROUP",
      "THREAT_ACTOR_HANDLE",
      "ONION_URL",
      "FILE_HASH_SHA256",
      "CVE_NUMBER",
      "BITCOIN_ADDRESS",
      "EMAIL_ADDRESS",
      "ORGANIZATION_NAME",
    ]) {
      expect(ENTITY_TYPES).toContain(t);
    }
  });
  it("parses valid samples", () => {
    expect(ProgressEvent.safeParse(event).success).toBe(true);
    expect(RunSpec.safeParse(spec).success).toBe(true);
    expect(ResultBundle.safeParse(bundle).success).toBe(true);
  });
  it("rejects invalid samples", () => {
    expect(ProgressEvent.safeParse({ ...event, stage: "scrape" }).success).toBe(false);
    expect(ProgressEvent.safeParse({ ...event, stage_total: 7 }).success).toBe(false);
    expect(ProgressEvent.safeParse({ ...event, at: "yesterday" }).success).toBe(false);
    expect(RunSpec.safeParse({ ...spec, depth: "huge" }).success).toBe(false);
    expect(RunSpec.safeParse({ ...spec, callback_url: "nope" }).success).toBe(false);
    expect(ResultBundle.safeParse({ ...bundle, schema_version: 2 }).success).toBe(false);
    expect(
      ResultBundle.safeParse({ ...bundle, entities: [{ ...bundle.entities[0], type: "NOT_A_TYPE" }] })
        .success,
    ).toBe(false);
    expect(
      ResultBundle.safeParse({ ...bundle, sources: [{ ...bundle.sources[0], excerpt: "x".repeat(501) }] })
        .success,
    ).toBe(false);
  });
});

describe("committed JSON Schema files", () => {
  it("are in sync with the zod schemas", () => {
    for (const [name, s] of Object.entries({ RunSpec, ProgressEvent, ResultBundle })) {
      const fresh = z.toJSONSchema(s, { target: "draft-2020-12", io: "output" });
      expect({ ...load(name), $id: undefined, title: undefined }).toEqual({
        ...fresh,
        $id: undefined,
        title: undefined,
      });
    }
  });
  it("accept valid samples and reject invalid ones", () => {
    expect(validateJsonSchema(load("ProgressEvent"), event)).toEqual([]);
    expect(validateJsonSchema(load("RunSpec"), spec)).toEqual([]);
    expect(validateJsonSchema(load("ResultBundle"), bundle)).toEqual([]);
    expect(validateJsonSchema(load("ProgressEvent"), { ...event, stage: "scrape" })).not.toEqual([]);
    expect(validateJsonSchema(load("ResultBundle"), { ...bundle, entities: undefined })).not.toEqual([]);
  });
});
