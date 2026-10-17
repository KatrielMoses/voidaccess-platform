/**
 * SSE stream of run progress, read from the database (runs continue server-side when the page closes).
 * Per stream: poll run_events every SSE_POLL_INTERVAL_MS under withUser (RLS: another user's id is a 404 before
 * any bytes are sent). Frames: `id: <seq>` + `event: progress` for each run_events row, `event: status` whenever
 * status/refined queries change, and a final `status` frame (with credits refunded) before the stream closes
 * after the run reaches a terminal state. Resume with the `Last-Event-ID` header (or ?lastEventId=).
 * Contract v2 trace rows go out as `event: trace` frames in the same seq order (one id space, so resume covers both).
 * Once the backlog that existed when the stream opened has been sent, one `event: live` frame marks "now": the live
 * view applies everything before it without motion (late joiners and reloads fast-forward, then go live).
 * At most SSE_BATCH_ROWS rows are read per poll; a full read is followed immediately by the next one.
 * The stream aborts with the request signal.
 */
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { creditLedger, getDatabase, investigations, runEvents } from "@voidaccess/db";
import { SSE_POLL_INTERVAL_MS } from "../limits";
import { RunError } from "./errors";
import { isTerminalStatus } from "./settle";
import { VIEW_TOUCH_SECONDS, markViewed } from "./viewers";

/**
 * "Someone is watching" is recorded in investigations.last_viewed_at (lib/runs/viewers.ts), so every instance sees
 * it. This stream writes it when it opens and then at most every VIEW_TOUCH_SECONDS; failures never break the stream.
 */
function touchViewer(runId: string, lastTouch: { at: number }) {
  if (Date.now() - lastTouch.at < VIEW_TOUCH_SECONDS * 1000) return;
  lastTouch.at = Date.now();
  markViewed(runId).catch((e) => console.error("markViewed failed:", e instanceof Error ? e.message : e));
}

export function parseLastEventId(raw: string | null): number {
  if (raw === null || !/^\d{1,9}$/.test(raw.trim())) return -1;
  return Number(raw.trim());
}

/** Rows per poll: a 3000-event run catches up in a few quick reads instead of one large one. */
export const SSE_BATCH_ROWS = 1000;

type Row = typeof runEvents.$inferSelect;
export const traceFrame = (r: Row) =>
  `id: ${r.seq}\nevent: trace\ndata: ${JSON.stringify({
    seq: r.seq,
    stage: r.stage,
    kind: r.kind,
    data: r.data,
    at: r.at.toISOString(),
  })}\n\n`;
const progressFrame = (r: Row) => {
  return `id: ${r.seq}\nevent: progress\ndata: ${JSON.stringify({
    seq: r.seq,
    type: r.type,
    stage: r.stage,
    status: r.status ?? undefined,
    counts: r.counts,
    at: r.at.toISOString(),
  })}\n\n`;
};

export const eventFrame = (r: Row) => (r.type === "trace" ? traceFrame(r) : progressFrame(r));

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
        .orderBy(asc(runEvents.seq))
        .limit(SSE_BATCH_ROWS);
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
  const lastTouch = { at: 0 };
  if (first) touchViewer(id, lastTouch); // only a run the caller owns is marked as viewed
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
      let live = false;
      try {
        while (!closed && snap) {
          touchViewer(id, lastTouch);
          for (const r of snap.evs) {
            send(eventFrame(r));
            after = Math.max(after, r.seq);
          }
          const more = snap.evs.length >= SSE_BATCH_ROWS;
          if (!live && !more) {
            live = true;
            send(`event: live\ndata: ${JSON.stringify({ seq: after })}\n\n`);
          }
          if (more) {
            snap = await poll(after);
            continue;
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
