import { toCsv } from "@/lib/results/csv";
import type { CostRun } from "./queries";

const usd = (n: number) => n.toFixed(6);
const pct = (n: number | null) => (n === null ? "" : (n * 100).toFixed(1));

export function costsCsv(runs: CostRun[]): string {
  return toCsv(
    [
      "investigation_id",
      "measured_at",
      "depth",
      "status",
      "failure_reason",
      "credits_reserved",
      "credits_kept",
      "compute_usd",
      "llm_usd",
      "cost_usd",
      "duration_ms",
      "revenue_list_usd",
      "revenue_pro_usd",
      "margin_list_pct",
      "margin_pro_pct",
    ],
    runs.map((r) => [
      r.id,
      r.at.toISOString(),
      r.depth,
      r.status,
      r.failureReason,
      r.creditsReserved,
      r.creditsNet,
      usd(r.computeUsd),
      usd(r.llmUsd),
      usd(r.costUsd),
      r.durationMs,
      usd(r.revenueListUsd),
      usd(r.revenueProUsd),
      pct(r.marginList),
      pct(r.marginPro),
    ]),
  );
}
