/**
 * "Replay run" (P8-5): every stored event of a finished investigation, in seq order, for the live view to play back.
 * withUser: RLS scopes the read, so another user's id is simply not found. Only finished runs replay; a running one
 * is watched live through the SSE stream instead.
 */
import { asc, eq } from "drizzle-orm";
import { getDatabase, investigations, runEvents } from "@voidaccess/db";
import { isTerminalStatus } from "./settle";
import { accessMarker, redactTraceData, type AccessMarker } from "../access";

export interface ReplayEvent {
  seq: number;
  type: string;
  stage: string | null;
  status?: string;
  counts?: Record<string, number> | null;
  kind?: string;
  data?: Record<string, unknown>;
  at: string;
}

/** The replay with its `access` marker; for a preview account trace data loses hosts, values and query text. */
export async function getReplay(
  userId: string,
  id: string,
): Promise<{ status: string; events: ReplayEvent[]; access: AccessMarker } | null> {
  const replay = await readReplay(userId, id);
  if (!replay) return null;
  const access = await accessMarker(userId, id);
  if (access.level === "full") return { ...replay, access };
  return {
    ...replay,
    events: replay.events.map((e) =>
      e.type === "trace" ? { ...e, data: redactTraceData(e.kind ?? null, e.data ?? null, e.seq) } : e,
    ),
    access,
  };
}

async function readReplay(
  userId: string,
  id: string,
): Promise<{ status: string; events: ReplayEvent[] } | null> {
  return getDatabase().withUser(userId, async (tx) => {
    const [run] = await tx
      .select({ status: investigations.status })
      .from(investigations)
      .where(eq(investigations.id, id));
    if (!run || !isTerminalStatus(run.status)) return null;
    const rows = await tx.select().from(runEvents).where(eq(runEvents.runId, id)).orderBy(asc(runEvents.seq));
    return {
      status: run.status,
      events: rows.map((r) =>
        r.type === "trace"
          ? {
              seq: r.seq,
              type: r.type,
              stage: r.stage,
              kind: r.kind ?? "",
              data: r.data ?? {},
              at: r.at.toISOString(),
            }
          : {
              seq: r.seq,
              type: r.type,
              stage: r.stage,
              status: r.status ?? undefined,
              counts: r.counts,
              at: r.at.toISOString(),
            },
      ),
    };
  });
}
