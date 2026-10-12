/**
 * Engine callbacks: HMAC verification, dedupe on (run_id, seq), run_events writes and state transitions.
 *
 * State machine: reserved -> launching -> running -> ingesting -> completed | failed | cancelled.
 *  - the first accepted event moves reserved/launching -> running; status never moves backwards;
 *  - events for a run that is already terminal are ignored (200, no write, no ledger change);
 *  - terminal events settle inside the same transaction as the event insert, so a crash cannot leave an
 *    event recorded but unsettled (the engine's retry would otherwise be deduped away);
 *  - `completed` moves to `ingesting` in that transaction and runs the ingest hook afterwards (complete.ts).
 * Stage events are stored as type `stage` (start) or `stage_<status>` (end/skipped/failed) so the cancel
 * timeout can derive completed stages without a schema change; the SSE stream maps them back.
 */
import { eq } from "drizzle-orm";
import { ProgressEvent, isTerminalEvent, verifyCallback } from "@voidaccess/engine-client";
import { getDatabase, investigations, runEvents } from "@voidaccess/db";
import { finishIngest } from "./complete";
import { deriveCallbackSecret } from "./secrets";
import { isTerminalStatus, lockRun, settleLockedRun } from "./settle";

export type CallbackResult = { status: number; body: Record<string, unknown> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function storedEventType(e: ProgressEvent): string {
  if (e.type === "stage" && e.status && e.status !== "start") return `stage_${e.status}`;
  return e.type;
}

export async function handleEngineCallback(
  runId: string,
  headers: Headers,
  rawBody: string,
  now?: number,
): Promise<CallbackResult> {
  if (!UUID_RE.test(runId)) return { status: 401, body: { error: "unauthorized" } };
  const v = verifyCallback({ secret: deriveCallbackSecret(runId), headers, rawBody, now });
  if (!v.ok) return { status: 401, body: { error: "unauthorized" } };
  if (v.runId !== runId) return { status: 400, body: { error: "run id mismatch" } };

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "invalid json" } };
  }
  const parsed = ProgressEvent.safeParse(json);
  if (!parsed.success) return { status: 400, body: { error: "invalid event" } };
  const ev = parsed.data;
  if (ev.run_id !== runId || ev.seq !== v.seq)
    return { status: 400, body: { error: "event does not match headers" } };

  const terminal = isTerminalEvent(ev);
  const res = await getDatabase().withSystem(
    "engine.callback",
    async (tx) => {
      const run = await lockRun(tx, runId);
      if (!run) return { kind: "unknown" as const };
      if (isTerminalStatus(run.status) || (run.status === "ingesting" && terminal))
        return { kind: "ignored" as const };

      const inserted = await tx
        .insert(runEvents)
        .values({
          runId,
          userId: run.userId,
          seq: ev.seq,
          type: storedEventType(ev),
          stage: ev.stage ?? null,
          counts: ev.counts ?? null,
          at: new Date(ev.at),
        })
        .onConflictDoNothing()
        .returning({ seq: runEvents.seq });
      if (inserted.length === 0) return { kind: "duplicate" as const };

      const now = new Date();
      const patch: Partial<typeof investigations.$inferInsert> = { lastEventAt: now };
      if (run.status === "reserved" || run.status === "launching") {
        patch.status = "running";
        patch.startedAt = run.startedAt ?? now;
      }
      if (ev.type === "refined") patch.refinedQueries = ev.refined_queries ?? [];
      await tx.update(investigations).set(patch).where(eq(investigations.id, runId));

      if (ev.type === "failed") {
        await settleLockedRun(tx, run, { kind: "failed", reason: ev.reason ?? "error" });
        return { kind: "settled" as const };
      }
      if (ev.type === "cancelled") {
        await settleLockedRun(tx, run, { kind: "cancelled", stagesCompleted: ev.stages_completed ?? null });
        return { kind: "settled" as const };
      }
      if (ev.type === "completed") {
        await tx
          .update(investigations)
          .set({ status: "ingesting", startedAt: patch.startedAt ?? run.startedAt ?? now })
          .where(eq(investigations.id, runId));
        return { kind: "ingest" as const };
      }
      return { kind: "recorded" as const };
    },
    { audit: terminal },
  );

  if (res.kind === "unknown") return { status: 404, body: { error: "not found" } };
  if (res.kind === "ingest") await finishIngest(runId);
  return { status: 200, body: { ok: true, result: res.kind } };
}
