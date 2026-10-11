/** The `completed` path: ingesting -> (ingest hook) -> completed, or failed + full refund if ingest throws. */
import { and, eq, sql } from "drizzle-orm";
import { getDatabase, investigations } from "@voidaccess/db";
import { trackEvent } from "../analytics";
import { sendEmail } from "@voidaccess/emails";
import { users } from "@voidaccess/db/schema";
import { ingestBundle } from "./ingest";
import { viewerActive } from "./sse";
import { lockRun, settleLockedRun } from "./settle";

/** Called once the run is in status `ingesting`. Never throws. */
export async function finishIngest(runId: string): Promise<void> {
  let ingestError: unknown;
  try {
    await ingestBundle(runId);
  } catch (e) {
    ingestError = e;
    console.error(`ingest failed for ${runId}:`, e instanceof Error ? e.message : e);
  }
  const outcome = await getDatabase().withSystem("runs.settle", async (tx) => {
    const run = await lockRun(tx, runId);
    // The watchdog (or a cancel) may have settled the run while ingest was running: then there is nothing to do.
    if (!run || run.status !== "ingesting") return null;
    if (ingestError) {
      await settleLockedRun(tx, run, { kind: "failed", reason: "ingest_failure" });
      return null;
    }
    await tx
      .update(investigations)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(investigations.id, runId));
    const [n] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(investigations)
      .where(and(eq(investigations.userId, run.userId), eq(investigations.status, "completed")));
    return {
      userId: run.userId,
      query: run.title ?? run.query,
      first: (n?.n ?? 0) === 1,
      depth: run.depth,
      ms: run.startedAt ? Date.now() - run.startedAt.getTime() : null,
    };
  });
  if (outcome?.first) {
    await trackEvent("first_investigation_completed", {
      userId: outcome.userId,
      props: { investigationId: runId, depth: outcome.depth, durationMs: outcome.ms },
    });
  }
  // "Results ready" email, only when nobody is watching the run.
  if (outcome && !viewerActive(runId)) {
    try {
      const [u] = await getDatabase().withSystem(
        "runs.notify",
        (tx) =>
          tx.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, outcome.userId)),
        { audit: false },
      );
      if (u) {
        const base = process.env.APP_URL ?? "http://localhost:3000";
        await sendEmail("resultsReady", u.email, {
          name: u.name,
          query: outcome.query.slice(0, 120),
          resultsUrl: `${base}/investigations/${runId}/results`,
        });
      }
    } catch (e) {
      console.error("results-ready email failed", e instanceof Error ? e.message : e);
    }
  }
}
