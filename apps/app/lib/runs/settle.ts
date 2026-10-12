/**
 * Settlement: every terminal state settles the ledger exactly once.
 *
 * - completed: no ledger change
 * - failed (blocked_query, no_results, deadline, error, watchdog, launcher/ingest failure): full refund
 * - cancelled: refund ceil(charged x weight of stages NOT completed / 100)
 *
 * Exactly-once comes from three layers: the investigation row is locked (FOR UPDATE) and its status checked
 * in the same transaction as the refund; refund() is once-per-investigation; ledger idempotency keys are unique.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { STAGES, STAGE_WEIGHTS, type Stage } from "@voidaccess/config";
import { creditLedger, getDatabase, investigations, refund, runEvents, type Tx } from "@voidaccess/db";

export const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;
export const ACTIVE_STATUSES = ["reserved", "launching", "running", "ingesting"] as const;
export type RunStatus = (typeof ACTIVE_STATUSES)[number] | (typeof TERMINAL_STATUSES)[number];
export const isTerminalStatus = (s: string) => (TERMINAL_STATUSES as readonly string[]).includes(s);

export type Run = typeof investigations.$inferSelect;

export type Outcome =
  | { kind: "failed"; reason: string }
  /** `stagesCompleted: null` means "derive from the stored stage events". */
  | { kind: "cancelled"; stagesCompleted: readonly string[] | null };

export interface SettleResult {
  settled: boolean;
  status: string;
  refunded: number;
  executionId: string | null;
}

/** Lock the investigation row for the rest of the transaction. */
export async function lockRun(tx: Tx, runId: string): Promise<Run | undefined> {
  const [r] = await tx.select().from(investigations).where(eq(investigations.id, runId)).for("update");
  return r;
}

/** Stage-end events are stored with type `stage_end` (see lib/runs/events.ts). */
export async function stagesCompletedFromEvents(tx: Tx, runId: string): Promise<Stage[]> {
  const rows = await tx
    .select({ stage: runEvents.stage })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), eq(runEvents.type, "stage_end")));
  const seen = new Set(rows.map((r) => r.stage));
  return STAGES.filter((s) => seen.has(s));
}

/** ceil(charged x weight of stages not completed / 100). Unknown stage names count as not completed. */
export function cancelRefundAmount(charged: number, stagesCompleted: readonly string[]): number {
  const done = new Set(stagesCompleted);
  const notRun = STAGES.filter((s) => !done.has(s)).reduce((a, s) => a + STAGE_WEIGHTS[s], 0);
  return Math.ceil((charged * notRun) / 100);
}

/**
 * Settle a locked, non-terminal run inside the caller's system transaction.
 * The caller must hold the row lock (lockRun) and have checked the status is not terminal.
 */
export async function settleLockedRun(tx: Tx, run: Run, outcome: Outcome): Promise<number> {
  const now = new Date();
  let refunded: number;
  if (outcome.kind === "failed") {
    refunded = (await refund(run.userId, run.id, {}, { tx })).refunded;
    await tx
      .update(investigations)
      .set({ status: "failed", completedAt: now, failureReason: outcome.reason })
      .where(eq(investigations.id, run.id));
  } else {
    const stages = outcome.stagesCompleted ?? (await stagesCompletedFromEvents(tx, run.id));
    const [c] = await tx
      .select({ charged: sql<number>`coalesce(-sum(${creditLedger.amount}), 0)::int` })
      .from(creditLedger)
      .where(and(eq(creditLedger.investigationId, run.id), eq(creditLedger.reason, "reserve")));
    const charged = c?.charged ?? 0;
    refunded = (
      await refund(run.userId, run.id, { refundAmount: cancelRefundAmount(charged, stages) }, { tx })
    ).refunded;
    await tx
      .update(investigations)
      .set({ status: "cancelled", completedAt: now, failureReason: "cancelled" })
      .where(eq(investigations.id, run.id));
  }
  return refunded;
}

/**
 * Settle a run as failed or cancelled, once. A no-op (`settled: false`) when the run is already terminal,
 * missing, or `when(run)` (evaluated under the row lock against fresh data) says no.
 * `reason` is the withSystem reason string ('runs.settle', 'cron.watchdog', ...).
 */
export async function settleRun(
  runId: string,
  outcome: Outcome,
  opts: { reason?: string; from?: readonly string[]; when?: (run: Run) => boolean } = {},
): Promise<SettleResult> {
  return getDatabase().withSystem(opts.reason ?? "runs.settle", async (tx) => {
    const run = await lockRun(tx, runId);
    if (!run) return { settled: false, status: "missing", refunded: 0, executionId: null };
    const skip =
      isTerminalStatus(run.status) ||
      (opts.from && !opts.from.includes(run.status)) ||
      (opts.when && !opts.when(run));
    if (skip) return { settled: false, status: run.status, refunded: 0, executionId: run.executionId };
    const refunded = await settleLockedRun(tx, run, outcome);
    return {
      settled: true,
      status: outcome.kind === "failed" ? "failed" : "cancelled",
      refunded,
      executionId: run.executionId,
    };
  });
}

export const NON_TERMINAL = inArray(investigations.status, [...ACTIVE_STATUSES]);
