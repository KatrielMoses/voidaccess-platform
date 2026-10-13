/**
 * POST /api/cron/lifecycle (hourly). Picks the users due each lifecycle email and sends it once:
 *  - welcome: backstop for verified accounts whose verification hook didn't send it (e.g. GitHub sign-in)
 *  - first_investigation_nudge: 24 h after sign-up, still no investigation
 *  - what_next: after the first completed investigation (a short delay after results-ready)
 * `sendLifecycle` makes each send idempotent, so overlapping or repeated runs are harmless.
 */
import { sql } from "drizzle-orm";
import { getDatabase, type Database } from "@voidaccess/db";
import {
  BATCH,
  NUDGE_AFTER_HOURS,
  NUDGE_MAX_AGE_DAYS,
  WELCOME_BACKSTOP_HOURS,
  WHAT_NEXT_DELAY_MINUTES,
  WHAT_NEXT_MAX_AGE_DAYS,
} from "./constants";
import { sendLifecycle, type LifecycleKind, type LifecycleResult } from "./send";

const ago = (now: Date, ms: number) => new Date(now.getTime() - ms).toISOString();
const H = 3_600_000;
const D = 24 * H;

async function dueUsers(database: Database, now: Date, kind: LifecycleKind): Promise<string[]> {
  return database.withSystem(
    "lifecycle.due",
    async (tx) => {
      const t = (d: Date | string) => sql`${typeof d === "string" ? d : d.toISOString()}::timestamptz`;
      const base = sql`u.status = 'active' AND u.email_verified AND NOT EXISTS (
        SELECT 1 FROM lifecycle_emails l WHERE l.user_id = u.id AND l.kind = ${kind})`;
      let res;
      if (kind === "welcome")
        res = await tx.execute<{ id: string }>(sql`SELECT u.id FROM users u
          WHERE ${base} AND u.created_at >= ${t(ago(now, WELCOME_BACKSTOP_HOURS * H))}
          ORDER BY u.created_at LIMIT ${BATCH}`);
      else if (kind === "first_investigation_nudge")
        res = await tx.execute<{ id: string }>(sql`SELECT u.id FROM users u
          WHERE ${base}
            AND u.created_at <= ${t(ago(now, NUDGE_AFTER_HOURS * H))}
            AND u.created_at >= ${t(ago(now, NUDGE_MAX_AGE_DAYS * D))}
            AND NOT EXISTS (SELECT 1 FROM investigations i WHERE i.user_id = u.id)
          ORDER BY u.created_at LIMIT ${BATCH}`);
      else
        res = await tx.execute<{ id: string }>(sql`SELECT u.id FROM users u
          JOIN (SELECT user_id, min(completed_at) AS first_done FROM investigations
                WHERE status = 'completed' AND completed_at IS NOT NULL GROUP BY user_id) f ON f.user_id = u.id
          WHERE ${base}
            AND f.first_done <= ${t(ago(now, WHAT_NEXT_DELAY_MINUTES * 60_000))}
            AND f.first_done >= ${t(ago(now, WHAT_NEXT_MAX_AGE_DAYS * D))}
          ORDER BY f.first_done LIMIT ${BATCH}`);
      return res.rows.map((r) => r.id);
    },
    { audit: false },
  );
}

export type LifecycleReport = Record<LifecycleKind, Partial<Record<LifecycleResult, number>>>;

export async function runLifecycle(now: Date, database: Database = getDatabase()): Promise<LifecycleReport> {
  const report: LifecycleReport = { welcome: {}, first_investigation_nudge: {}, what_next: {} };
  for (const kind of Object.keys(report) as LifecycleKind[]) {
    for (const id of await dueUsers(database, now, kind)) {
      const r = await sendLifecycle(kind, id, database);
      report[kind][r] = (report[kind][r] ?? 0) + 1;
    }
  }
  return report;
}
