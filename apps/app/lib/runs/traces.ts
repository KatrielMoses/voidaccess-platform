/**
 * Contract v2 trace events (P8): validation, per-run caps and storage in run_events.
 *
 * Traces share run_events with progress events (type 'trace', kind + data jsonb) so they live in the run's single
 * seq space: one ordered read serves the SSE stream and its Last-Event-ID resume, RLS (own_rows; va_app can only
 * SELECT) keeps them to the run's owner, and they are deleted with the investigation (ON DELETE CASCADE). They are
 * kept after the run for "Replay run".
 *
 * Every event is checked on its own (packages/engine-client/src/trace.ts): an unknown kind is ignored, a malformed
 * or oversized one rejected; the rest of its batch is still stored. Safety drops keep only the url id and reason,
 * and the matching url.found row loses its host, so a URL removed by the content-safety filter is never shown.
 * Traces never move a run's state except reserved/launching -> running, and are ignored once a run is ingesting.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  TRACE_CAPS,
  TRACE_KINDS,
  TRACE_TOTAL_CAP,
  TraceBatch,
  checkTrace,
  isSafetyDrop,
  type TraceEvent,
  type TraceKind,
} from "@voidaccess/engine-client";
import { getDatabase, investigations, runEvents, type Tx } from "@voidaccess/db";
import { isTerminalStatus, lockRun } from "./settle";
import type { CallbackResult } from "./callbacks";

/** True when a callback body is a trace (a batch, or a single `type: "trace"` event). */
export function isTraceBody(json: unknown): boolean {
  if (!json || typeof json !== "object") return false;
  const o = json as { events?: unknown; type?: unknown };
  return Array.isArray(o.events) || o.type === "trace";
}

export interface TraceTally {
  stored: number;
  duplicate: number;
  ignored: number;
  rejected: number;
  capped: number;
}

/** Split events into those within the per-kind and per-run caps and those over them. */
export function applyCaps(
  events: TraceEvent[],
  existing: Partial<Record<TraceKind, number>>,
): { keep: TraceEvent[]; capped: number } {
  const used = { ...existing };
  let total = Object.values(used).reduce((a, n) => a + (n ?? 0), 0);
  const keep: TraceEvent[] = [];
  let capped = 0;
  for (const e of events) {
    const n = used[e.kind] ?? 0;
    if (n >= TRACE_CAPS[e.kind] || total >= TRACE_TOTAL_CAP) {
      capped++;
      continue;
    }
    used[e.kind] = n + 1;
    total++;
    keep.push(e);
  }
  return { keep, capped };
}

async function traceCounts(tx: Tx, runId: string): Promise<Partial<Record<TraceKind, number>>> {
  const rows = await tx
    .select({ kind: runEvents.kind, n: sql<number>`count(*)::int` })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), eq(runEvents.type, "trace")))
    .groupBy(runEvents.kind);
  const out: Partial<Record<TraceKind, number>> = {};
  for (const r of rows)
    if (r.kind && (TRACE_KINDS as readonly string[]).includes(r.kind)) out[r.kind as TraceKind] = r.n;
  return out;
}

export async function handleTraceCallback(
  runId: string,
  headerSeq: number,
  json: unknown,
): Promise<CallbackResult> {
  const o = json as { events?: unknown; type?: unknown };
  let raw: unknown[];
  if (Array.isArray(o.events)) {
    const b = TraceBatch.safeParse(json);
    if (!b.success) return { status: 400, body: { error: "invalid batch" } };
    if (b.data.run_id !== runId) return { status: 400, body: { error: "event does not match headers" } };
    raw = b.data.events;
  } else raw = [json];

  // the header seq signs the last event; seqs strictly increase and every event belongs to this run
  const seqs = raw.map((e) => (e && typeof e === "object" ? (e as { seq?: unknown }).seq : undefined));
  if (seqs.some((s) => typeof s !== "number" || !Number.isInteger(s) || s < 0))
    return { status: 400, body: { error: "invalid event" } };
  const nums = seqs as number[];
  if (nums.at(-1) !== headerSeq || nums.some((s, i) => i > 0 && s <= nums[i - 1]!))
    return { status: 400, body: { error: "event does not match headers" } };
  if (raw.some((e) => (e as { run_id?: unknown }).run_id !== runId))
    return { status: 400, body: { error: "event does not match headers" } };

  const tally: TraceTally = { stored: 0, duplicate: 0, ignored: 0, rejected: 0, capped: 0 };
  const valid: TraceEvent[] = [];
  for (const e of raw) {
    const c = checkTrace(e);
    if (c.ok) valid.push(c.event);
    else if (c.ignored) tally.ignored++;
    else tally.rejected++;
  }
  if (tally.rejected > 0) console.warn(`engine trace: rejected ${tally.rejected} event(s) for run ${runId}`);

  const res = await getDatabase().withSystem(
    "engine.callback.trace",
    async (tx) => {
      const run = await lockRun(tx, runId);
      if (!run) return "unknown" as const;
      if (isTerminalStatus(run.status) || run.status === "ingesting") return "ignored" as const;

      if (valid.length > 0) {
        const { keep, capped } = applyCaps(valid, await traceCounts(tx, runId));
        tally.capped = capped;
        if (keep.length > 0) {
          const inserted = await tx
            .insert(runEvents)
            .values(
              keep.map((e) => ({
                runId,
                userId: run.userId,
                seq: e.seq,
                type: "trace",
                stage: e.stage,
                kind: e.kind,
                data: e.data as Record<string, unknown>,
                at: new Date(e.at),
              })),
            )
            .onConflictDoNothing()
            .returning({ seq: runEvents.seq });
          tally.stored = inserted.length;
          tally.duplicate = keep.length - inserted.length;
        }
        // a URL removed by the content-safety filter keeps no host anywhere
        const unsafe = [
          ...new Set(valid.filter(isSafetyDrop).map((e) => (e.data as { url_id: string }).url_id)),
        ];
        if (unsafe.length > 0) await scrubSafetyHosts(tx, runId, unsafe);
      }

      const now = new Date();
      const patch: Partial<typeof investigations.$inferInsert> = { lastEventAt: now };
      if (run.status === "reserved" || run.status === "launching") {
        patch.status = "running";
        patch.startedAt = run.startedAt ?? now;
      }
      await tx.update(investigations).set(patch).where(eq(investigations.id, runId));
      return "recorded" as const;
    },
    { audit: false }, // high-frequency engine path (like progress events); terminal events stay audited
  );

  if (res === "unknown") return { status: 404, body: { error: "not found" } };
  return { status: 200, body: { ok: true, result: res, ...tally } };
}

/** Strip url.found rows of `urlIds` down to their id (no host, no engine). */
export async function scrubSafetyHosts(tx: Tx, runId: string, urlIds: string[]): Promise<void> {
  await tx
    .update(runEvents)
    .set({ data: sql`jsonb_build_object('url_id', ${runEvents.data}->'url_id')` })
    .where(
      and(
        eq(runEvents.runId, runId),
        eq(runEvents.type, "trace"),
        eq(runEvents.kind, "url.found"),
        inArray(sql`${runEvents.data}->>'url_id'`, urlIds),
      ),
    );
}
