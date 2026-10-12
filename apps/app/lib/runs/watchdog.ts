/**
 * Watchdog (POST /api/cron/watchdog, every 5 minutes via Cloud Scheduler).
 *  1. cancel requested more than CANCEL_SETTLE_TIMEOUT_SECONDS ago and the engine never said `cancelled`
 *     (run still reserved/launching/running): settle as cancelled, stages derived from the stored stage events.
 *  2. running/ingesting with no engine callback for WATCHDOG_SILENCE_MINUTES: failed, full refund.
 *  3. launching with no callback for LAUNCHING_STUCK_MINUTES (engine never booted): failed, full refund.
 *  4. reserved for RESERVED_STUCK_MINUTES (process died between reserve and launch): failed, full refund.
 * Every decision is re-evaluated under the run's row lock, so a real terminal event racing the watchdog
 * settles exactly once (whoever locks first wins; the loser sees a terminal status and does nothing).
 */
import { getDatabase, investigations } from "@voidaccess/db";
import {
  CANCEL_SETTLE_TIMEOUT_SECONDS,
  LAUNCHING_STUCK_MINUTES,
  RESERVED_STUCK_MINUTES,
  WATCHDOG_SILENCE_MINUTES,
} from "../limits";
import { safeCancel } from "./service";
import { ACTIVE_STATUSES, settleRun, type Outcome, type Run } from "./settle";
import { inArray } from "drizzle-orm";

const min = (n: number) => n * 60_000;

export function evaluateRun(run: Run, now: Date): Outcome | null {
  const t = now.getTime();
  const last = (run.lastEventAt ?? run.startedAt ?? run.createdAt).getTime();
  const cancellable = run.status === "reserved" || run.status === "launching" || run.status === "running";
  if (
    run.cancelRequestedAt &&
    cancellable &&
    t - run.cancelRequestedAt.getTime() > CANCEL_SETTLE_TIMEOUT_SECONDS * 1000
  )
    return { kind: "cancelled", stagesCompleted: null };
  if ((run.status === "running" || run.status === "ingesting") && t - last > min(WATCHDOG_SILENCE_MINUTES))
    return { kind: "failed", reason: "watchdog" };
  if (
    run.status === "launching" &&
    t - (run.lastEventAt ?? run.createdAt).getTime() > min(LAUNCHING_STUCK_MINUTES)
  )
    return { kind: "failed", reason: "watchdog" };
  if (run.status === "reserved" && t - run.createdAt.getTime() > min(RESERVED_STUCK_MINUTES))
    return { kind: "failed", reason: "watchdog" };
  return null;
}

export interface WatchdogResult {
  scanned: number;
  failed: string[];
  cancelled: string[];
}

export async function runWatchdog(now: Date = new Date()): Promise<WatchdogResult> {
  const candidates = await getDatabase().withSystem(
    "cron.watchdog",
    (tx) =>
      tx
        .select()
        .from(investigations)
        .where(inArray(investigations.status, [...ACTIVE_STATUSES])),
    { actor: "cron" },
  );
  const out: WatchdogResult = { scanned: candidates.length, failed: [], cancelled: [] };
  for (const c of candidates) {
    const outcome = evaluateRun(c, now);
    if (!outcome) continue;
    const s = await settleRun(c.id, outcome, {
      reason: "cron.watchdog",
      when: (fresh) => evaluateRun(fresh, now) !== null,
    });
    if (!s.settled) continue;
    (outcome.kind === "failed" ? out.failed : out.cancelled).push(c.id);
    await safeCancel(s.executionId); // best effort: stop a container that is still burning compute
  }
  return out;
}
