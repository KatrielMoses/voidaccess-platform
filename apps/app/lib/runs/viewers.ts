/**
 * "Is someone watching this run?" shared by every instance through investigations.last_viewed_at (DB clock).
 * The SSE stream records a view at most every VIEW_TOUCH_SECONDS; the results-ready email is skipped when a view
 * was recorded within VIEWER_ACTIVE_SECONDS.
 */
import { eq, sql } from "drizzle-orm";
import { getDatabase, investigations, type Database } from "@voidaccess/db";

export const VIEW_TOUCH_SECONDS = 30;
export const VIEWER_ACTIVE_SECONDS = 60;

/** Record that the run is being viewed. At most one write per run per VIEW_TOUCH_SECONDS across all instances. */
export async function markViewed(runId: string, database: Database = getDatabase()): Promise<void> {
  await database.withSystem(
    "runs.viewed",
    (tx) =>
      tx
        .update(investigations)
        .set({ lastViewedAt: sql`now()` })
        .where(
          sql`${investigations.id} = ${runId} and (${investigations.lastViewedAt} is null
            or ${investigations.lastViewedAt} < now() - make_interval(secs => ${VIEW_TOUCH_SECONDS}))`,
        ),
    { audit: false },
  );
}

/** True when any instance's SSE stream served this run within the last `withinSeconds`. */
export async function viewedRecently(
  runId: string,
  withinSeconds = VIEWER_ACTIVE_SECONDS,
  database: Database = getDatabase(),
): Promise<boolean> {
  const rows = await database.withSystem(
    "runs.viewed",
    (tx) =>
      tx
        .select({
          active: sql<boolean>`${investigations.lastViewedAt} is not null
            and ${investigations.lastViewedAt} > now() - make_interval(secs => ${withinSeconds})`,
        })
        .from(investigations)
        .where(eq(investigations.id, runId)),
    { audit: false },
  );
  return rows[0]?.active === true;
}
