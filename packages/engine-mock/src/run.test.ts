import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ResultBundle,
  RunSpec,
  checkBundleIntegrity,
  isTerminalEvent,
  validateJsonSchema,
  type JsonSchema,
} from "@voidaccess/engine-client";
import { FIXTURE_NAMES, loadFixture } from "./fixtures";
import { startReceiver, type Receiver } from "./receiver";
import { runMock } from "./run";

const secret = "test-secret-0123456789";
let rx: Receiver;
beforeEach(async () => {
  rx = await startReceiver(secret);
});
afterEach(async () => {
  await rx.close();
});

const spec = (over: Partial<RunSpec> = {}): RunSpec => ({
  run_id: "run-test-1",
  query: "Cl0p MOVEit ransomware",
  depth: "standard",
  callback_url: `${rx.url}/callback`,
  callback_secret: secret,
  artifact_put_urls: {
    bundle: `${rx.url}/artifacts/bundle.json`,
    exports: { stix: `${rx.url}/artifacts/stix.json` },
  },
  deadline_at: new Date(Date.now() + 60_000).toISOString(),
  ...over,
});
const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "engine-client", "schemas");
const schema = (n: string) => JSON.parse(readFileSync(join(schemaPath, `${n}.json`), "utf8")) as JsonSchema;
const seqs = () => rx.events.map((e) => e.seq);

describe("fixtures", () => {
  it.each(FIXTURE_NAMES)("%s validates (zod + JSON Schema) and has real scale", (name) => {
    const { bundle } = loadFixture(name);
    expect(ResultBundle.safeParse(bundle).success).toBe(true);
    expect(validateJsonSchema(schema("ResultBundle"), bundle)).toEqual([]);
    expect(checkBundleIntegrity(bundle)).toEqual([]);
    expect(bundle.entities.length).toBeGreaterThanOrEqual(100);
    expect(bundle.sources.every((s) => s.excerpt.length <= 200)).toBe(true);
    expect(bundle.relationships.some((r) => r.type !== "CO_APPEARED_ON")).toBe(true);
    expect(bundle.actors.length).toBeGreaterThan(0);
  });
});

describe("mock engine", () => {
  it("success: ordered, HMAC-verified events, bundle PUT before completed, schema-valid", async () => {
    const result = await runMock(spec(), { durationMs: 1500, writeExports: true });
    expect(result.terminal).toBe("completed");
    expect(rx.rejected).toEqual([]);
    expect(seqs()).toEqual(rx.events.map((_, i) => i + 1));
    const last = rx.events.at(-1)!;
    expect(last.type).toBe("completed");
    expect(rx.events.filter(isTerminalEvent)).toHaveLength(1);
    expect(rx.events.filter((e) => e.type === "stage" && e.status === "start").map((e) => e.stage)).toEqual([
      "refine",
      "collect",
      "filter",
      "fetch",
      "extract",
      "enrich",
      "graph",
      "summarize",
    ]);
    expect(rx.events.some((e) => e.type === "refined" && e.refined_queries?.length)).toBe(true);
    expect(rx.events.some((e) => e.type === "counts")).toBe(true);
    expect(last.stages_completed).toHaveLength(8);
    const raw = rx.artifacts.get("bundle.json")!;
    expect(rx.artifacts.has("stix.json")).toBe(true);
    const bundle = JSON.parse(raw);
    expect(ResultBundle.safeParse(bundle).success).toBe(true);
    expect(validateJsonSchema(schema("ResultBundle"), bundle)).toEqual([]);
    expect(bundle.run_id).toBe("run-test-1");
    expect(validateJsonSchema(schema("ProgressEvent"), last)).toEqual([]);
  });

  it("rejects callbacks signed with the wrong secret (receiver 401s; run errors)", async () => {
    await expect(
      runMock(spec({ callback_secret: "another-secret-0123456789" }), { durationMs: 200, retries: 0 }),
    ).rejects.toThrow(/HTTP 401/);
    expect(rx.events).toHaveLength(0);
    expect(rx.rejected[0]?.reason).toBe("signature_mismatch");
  });

  it("failure: emits failed with partial stages_completed, no bundle", async () => {
    const result = await runMock(spec(), { mode: "failure", durationMs: 1000, stopAtStageIndex: 4 });
    expect(result.terminal).toBe("failed");
    const last = rx.events.at(-1)!;
    expect(last).toMatchObject({ type: "failed", reason: "error" });
    expect(last.stages_completed).toEqual(["refine", "collect", "filter", "fetch"]);
    expect(rx.artifacts.has("bundle.json")).toBe(false);
    expect(rx.rejected).toEqual([]);
  });

  it("cancel: emits cancelled with stages_completed and partial metrics", async () => {
    const result = await runMock(spec(), { mode: "cancel", durationMs: 1000, stopAtStageIndex: 3 });
    expect(result.terminal).toBe("cancelled");
    const last = rx.events.at(-1)!;
    expect(last).toMatchObject({ type: "cancelled", reason: "cancelled" });
    expect(last.stages_completed).toEqual(["refine", "collect", "filter"]);
    expect(last.metrics?.stage_ms).toBeDefined();
    expect(rx.artifacts.has("bundle.json")).toBe(false);
  });

  it("cancel via AbortSignal (SIGTERM analogue)", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    const result = await runMock(spec(), { durationMs: 2000, signal: ac.signal });
    expect(result.terminal).toBe("cancelled");
    expect(rx.events.at(-1)?.type).toBe("cancelled");
  });

  it("blocked: a single failed(blocked_query) before any stage or collection", async () => {
    const result = await runMock(spec({ query: "blocked" }), { mode: "blocked", durationMs: 1000 });
    expect(result).toMatchObject({ terminal: "failed", reason: "blocked_query" });
    expect(rx.events).toHaveLength(1);
    expect(rx.events[0]).toMatchObject({
      seq: 1,
      type: "failed",
      reason: "blocked_query",
      stages_completed: [],
    });
    expect(rx.events.some((e) => e.type === "stage")).toBe(false);
    expect(rx.artifacts.size).toBe(0);
  });

  it("deadline already passed: failed(deadline)", async () => {
    const result = await runMock(spec({ deadline_at: new Date(Date.now() - 1000).toISOString() }), {
      durationMs: 500,
    });
    expect(result).toMatchObject({ terminal: "failed", reason: "deadline" });
  });
});
