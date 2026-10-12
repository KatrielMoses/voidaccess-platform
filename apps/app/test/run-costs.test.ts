import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { runCosts } from "@voidaccess/db";
import { setLauncher } from "@/lib/launcher";
import { CLOUD_RUN_RATES, computeUsd, runCostRow } from "@/lib/runs/cost";
import { useNoopIngest } from "@/lib/runs/ingest";
import { startInvestigation } from "@/lib/runs/service";
import { StubLauncher, db, makeUser, postEvent } from "./helpers";

const stub = new StubLauncher();
setLauncher(stub);
beforeAll(() => useNoopIngest());

const metrics = {
  duration_ms: 180_000,
  tor_bootstrap_ms: 3000,
  stage_ms: { refine: 1000 },
  llm_calls: 7,
  llm_tokens_in: 15_000,
  llm_tokens_out: 900,
  llm_cost_usd: 0.0058,
  pages_fetched: 17,
  bytes_fetched: 12345,
  enrichment_calls: { rdap: 1 },
};
const rows = (id: string) =>
  db().withSystem("t", (tx) => tx.select().from(runCosts).where(eq(runCosts.investigationId, id)), {
    audit: false,
  });

describe("run cost formula", () => {
  it("is duration x (vCPU x vCPU-rate + GiB x GiB-rate) at the documented Cloud Run rates", () => {
    expect(CLOUD_RUN_RATES).toMatchObject({ vcpuPerSecondUsd: 0.000018, gibPerSecondUsd: 0.000002 });
    expect(CLOUD_RUN_RATES.sourceUrl).toBe("https://cloud.google.com/run/pricing");
    // 180 s at 1 vCPU / 2 GiB: 180 x (0.000018 + 0.000004) = $0.00396 (E1B quick p50 compute was $0.0040)
    expect(computeUsd(180_000, 1, 2)).toBeCloseTo(0.00396, 8);
    expect(computeUsd(0, 1, 2)).toBe(0);
    expect(computeUsd(-5, 1, 2)).toBe(0);
    expect(computeUsd(60_000, 2, 4)).toBeCloseTo(60 * (2 * 0.000018 + 4 * 0.000002), 8);
    expect(runCostRow(metrics, 1, 2)).toEqual({
      computeUsd: expect.closeTo(0.00396, 8),
      llmUsd: 0.0058,
      tokensIn: 15_000,
      tokensOut: 900,
      durationMs: 180_000,
    });
  });
});

describe("run_costs row", () => {
  async function start() {
    const u = await makeUser();
    const r = await startInvestigation(u, { query: "cost query", depth: "quick" });
    return r.id;
  }

  it("is written when a completed event carries metrics (compute + LLM), once", async () => {
    const id = await start();
    expect((await postEvent(id, 1, { type: "stage", stage: "refine", status: "start" })).status).toBe(200);
    expect((await postEvent(id, 2, { type: "completed", metrics })).status).toBe(200);
    // a retried delivery of the same event must not duplicate or change the row
    await postEvent(id, 2, { type: "completed", metrics: { ...metrics, llm_cost_usd: 9 } });
    const [row, ...rest] = await rows(id);
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({
      investigationId: id,
      llmUsd: 0.0058,
      tokensIn: 15_000,
      tokensOut: 900,
      durationMs: 180_000,
    });
    expect(row!.computeUsd).toBeCloseTo(0.00396, 8);
  });

  it("is also written for a failed run that reports metrics (the spend happened)", async () => {
    const id = await start();
    await postEvent(id, 1, { type: "failed", reason: "deadline", stages_completed: [], metrics });
    expect(await rows(id)).toHaveLength(1);
  });

  it("is not written when the terminal event has no metrics, nor for non-terminal events", async () => {
    const id = await start();
    await postEvent(id, 1, { type: "stage", stage: "refine", status: "start" });
    expect(await rows(id)).toHaveLength(0);
    await postEvent(id, 2, { type: "failed", reason: "error", stages_completed: [] });
    expect(await rows(id)).toHaveLength(0);
  });
});
