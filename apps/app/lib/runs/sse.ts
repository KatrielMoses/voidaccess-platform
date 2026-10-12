/**
 * SSE stream of run progress, read from the database (runs continue server-side when the page closes).
 * Per stream: poll run_events every SSE_POLL_INTERVAL_MS under withUser (RLS: another user's id is a 404 before
 * any bytes are sent). Frames: `id: <seq>` + `event: progress` for each run_events row, `event: status` whenever
 * status/refined queries change, and a final `status` frame (with credits refunded) before the stream closes
 * after the run reaches a terminal state. Resume with the `Last-Event-ID` header (or ?lastEventId=).
 * The stream aborts with the request signal.
 */
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { creditLedger, getDatabase, investigations, runEvents } from "@voidaccess/db";
import { SSE_POLL_INTERVAL_MS } from "../limits";
import { RunError } from "./errors";
import { isTerminalStatus } from "./settle";

// Per-instance "is someone watching this run" marker, used to decide whether to send the results-ready email.
const lastSeen = new Map<string, number>();
export function touchViewer(runId: string) {
  lastSeen.set(runId, Date.now());
  if (lastSeen.size > 5000) for (const [k, t] of lastSeen) if (Date.now() - t > 3_600_000) lastSeen.delete(k);
}
export function viewerActive(runId: string, withinMs = SSE_POLL_INTERVAL_MS * 6): boolean {
  const t = lastSeen.get(runId);
  return t !== undefined && Date.now() - t < withinMs;
}

export function parseLastEventId(raw: string | null): number {
  if (raw === null || !/^\d{1,9}$/.test(raw.trim())) return -1;
  return Number(raw.trim());
}

type Row = typeof runEvents.$inferSelect;
const progressFrame = (r: Row) => {
  const stage = r.type.startsWith("stage") ? "stage" : r.type;
  const status = r.type === "stage" ? "start" : r.type.startsWith("stage_") ? r.type.slice(6) : undefined;
  return `id: ${r.seq}\nevent: progress\ndata: ${JSON.stringify({
    seq: r.seq,
    type: stage,
    stage: r.stage,
    status,
    counts: r.counts,
    at: r.at.toISOString(),
  })}\n\n`;
};

export async function openEventStream(
  userId: string,
  id: string,
  signal: AbortSignal,
  lastEventId: number,
): Promise<Response> {
  const db = getDatabase();
  const poll = (after: number) =>
    db.withUser(userId, async (tx) => {
      // run first, events second: a terminal status implies all of its events are already committed
      const [run] = await tx.select().from(investigations).where(eq(investigations.id, id));
      if (!run) return null;
      const evs = await tx
        .select()
        .from(runEvents)
        .where(and(eq(runEvents.runId, id), gt(runEvents.seq, after)))
        .orderBy(asc(runEvents.seq));
      let refunded = 0;
      if (isTerminalStatus(run.status)) {
        const l = await tx
          .select({ amount: creditLedger.amount })
          .from(creditLedger)
          .where(and(eq(creditLedger.investigationId, id), inArray(creditLedger.reason, ["refund"])));
        refunded = l.reduce((a, x) => a + x.amount, 0);
      }
      return { run, evs, refunded };
    });

  const first = await poll(lastEventId);
  touchViewer(id);
  if (!first) throw new RunError("not_found", "Investigation not found.");

  const enc = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          closed = true;
        }
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      signal.addEventListener("abort", finish, { once: true });
      send("retry: 3000\n\n");

      let after = lastEventId;
      let statusKey = "";
      let snap: Awaited<ReturnType<typeof poll>> = first;
      let ticks = 0;
      try {
        while (!closed && snap) {
          touchViewer(id);
          for (const r of snap.evs) {
            send(progressFrame(r));
            after = Math.max(after, r.seq);
          }
          const terminal = isTerminalStatus(snap.run.status);
          const status = {
            status: snap.run.status,
            refinedQueries: snap.run.refinedQueries,
            failureReason: snap.run.failureReason,
            cancelRequested: snap.run.cancelRequestedAt != null,
            ...(terminal ? { creditsRefunded: snap.refunded } : {}),
          };
          const key = JSON.stringify(status);
          if (key !== statusKey) {
            statusKey = key;
            send(`event: status\ndata: ${key}\n\n`);
          }
          if (terminal) break;
          if (++ticks % 10 === 0) send(": ping\n\n");
          await new Promise<void>((r) => {
            const t = setTimeout(r, SSE_POLL_INTERVAL_MS);
            signal.addEventListener("abort", () => (clearTimeout(t), r()), { once: true });
          });
          if (closed) break;
          snap = await poll(after);
        }
      } catch (e) {
        console.error("sse stream error:", e instanceof Error ? e.message : e);
      } finally {
        finish();
      }
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
