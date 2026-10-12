/**
 * Measured cost per run (`run_costs`, feeds the admin cost-vs-charge view): compute from the runner's duration and the
 * job's size at the Cloud Run rates below, plus the runner's LLM estimate. Written when a terminal event carries
 * `metrics`; the first write for a run wins.
 */
import type { RunMetrics } from "@voidaccess/engine-client";
import { getDatabase, runCosts } from "@voidaccess/db";
import { getEnv } from "../../env";

/**
 * Cloud Run jobs, instance-based billing, Tier 1 regions (us-central1), USD. Read from
 * https://cloud.google.com/run/pricing on 2026-10-11 and re-verified against the live page by the E0/E1B harness
 * (runner/baseline/constants.py CLOUD_RUN_VCPU_PER_S_USD / CLOUD_RUN_GIB_PER_S_USD). Update here, and only here.
 */
export const CLOUD_RUN_RATES = {
  vcpuPerSecondUsd: 0.000018,
  gibPerSecondUsd: 0.000002,
  sourceUrl: "https://cloud.google.com/run/pricing",
  readOn: "2026-10-11",
} as const;

/** compute_usd = seconds x (vCPU x vCPU-rate + GiB x GiB-rate). The job is billed for the whole execution. */
export function computeUsd(
  durationMs: number,
  vcpu: number,
  memoryGib: number,
  rates: Pick<typeof CLOUD_RUN_RATES, "vcpuPerSecondUsd" | "gibPerSecondUsd"> = CLOUD_RUN_RATES,
): number {
  const seconds = Math.max(0, durationMs) / 1000;
  return seconds * (vcpu * rates.vcpuPerSecondUsd + memoryGib * rates.gibPerSecondUsd);
}

export function runCostRow(m: RunMetrics, vcpu: number, memoryGib: number) {
  return {
    computeUsd: computeUsd(m.duration_ms, vcpu, memoryGib),
    llmUsd: m.llm_cost_usd,
    tokensIn: m.llm_tokens_in,
    tokensOut: m.llm_tokens_out,
    durationMs: Math.round(m.duration_ms),
  };
}

/** Never throws: a cost row is bookkeeping and must not fail a callback. */
export async function recordRunCost(runId: string, metrics: RunMetrics): Promise<void> {
  try {
    const env = getEnv();
    const row = runCostRow(metrics, env.RUNNER_VCPU, env.RUNNER_MEMORY_GIB);
    await getDatabase().withSystem(
      "runs.cost",
      (tx) =>
        tx
          .insert(runCosts)
          .values({ investigationId: runId, ...row })
          .onConflictDoNothing(),
      { audit: false },
    );
  } catch (e) {
    console.error(`run cost not recorded for ${runId}:`, e instanceof Error ? e.message : e);
  }
}
