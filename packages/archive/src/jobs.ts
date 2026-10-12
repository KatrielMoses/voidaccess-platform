/**
 * The archive work queue. A row holds only a run id and bookkeeping and is deleted as soon as the run has been
 * archived (nothing here outlives the work). Archiving happens AFTER the user's run is completed and charged; a
 * failure here retries with backoff and never touches the run, its results or the ledger.
 */
import { sql } from "drizzle-orm";
import { archiveJobs, getDatabase, type Database } from "@voidaccess/db";
import { archiveRun } from "./archive";
import type { ArchiveDeps, ArchiveResult } from "./types";

/** Enqueue a run for archiving. Never throws: the caller is the run lifecycle and must not be affected. */
export async function enqueueArchive(runId: string, database?: Database): Promise<boolean> {
  try {
    await (database ?? getDatabase()).withSystem(
      "archive.enqueue",
      (tx) => tx.insert(archiveJobs).values({ runId }).onConflictDoNothing(),
      { audit: false },
    );
    return true;
  } catch (e) {
    console.error("archive: enqueue failed", e instanceof Error ? e.message : e);
    return false;
  }
}

export interface ProcessOptions {
  database?: Database;
  depsFor: (runId: string) => ArchiveDeps | Promise<ArchiveDeps>;
  /** jobs per call */
  batch?: number;
  /** stop starting new jobs after this many ms */
  budgetMs?: number;
  now?: () => Date;
  maxAttempts?: number;
  /** test hook; defaults to archiveRun */
  run?: (runId: string, deps: ArchiveDeps) => Promise<ArchiveResult>;
}

export interface ProcessReport {
  processed: number;
  failed: number;
  results: ArchiveResult[];
}

const backoffMinutes = (attempts: number) => Math.min(2 ** attempts, 360);

async function claim(
  database: Database,
  now: Date,
  maxAttempts: number,
): Promise<{ id: string; runId: string; attempts: number } | null> {
  const iso = now.toISOString();
  return database.withSystem(
    "archive.queue.claim",
    async (tx) => {
      const res = await tx.execute<{ id: string; run_id: string; attempts: number }>(sql`
        with picked as (
          select id from archive_jobs
          where next_attempt_at <= ${iso}::timestamptz and attempts < ${maxAttempts}
            and (locked_at is null or locked_at < ${iso}::timestamptz - interval '15 minutes')
          order by enqueued_at limit 1 for update skip locked)
        update archive_jobs j set locked_at = ${iso}::timestamptz, attempts = j.attempts + 1
        from picked where j.id = picked.id returning j.id, j.run_id, j.attempts`);
      const r = res.rows[0];
      return r ? { id: r.id, runId: r.run_id, attempts: Number(r.attempts) } : null;
    },
    { audit: false },
  );
}

/** Process due jobs with bounded batch size and time. Safe to run concurrently: a job is claimed by exactly one worker. */
export async function processArchiveQueue(opts: ProcessOptions): Promise<ProcessReport> {
  const database = opts.database ?? getDatabase();
  const batch = opts.batch ?? 10;
  const budget = opts.budgetMs ?? 25_000;
  const maxAttempts = opts.maxAttempts ?? 8;
  const started = Date.now();
  const report: ProcessReport = { processed: 0, failed: 0, results: [] };
  while (report.processed + report.failed < batch && Date.now() - started < budget) {
    const now = opts.now?.() ?? new Date();
    const job = await claim(database, now, maxAttempts);
    if (!job) break;
    try {
      const deps = await opts.depsFor(job.runId);
      const result = await (opts.run ?? archiveRun)(job.runId, deps, { database });
      await database.withSystem(
        "archive.queue.done",
        (tx) => tx.delete(archiveJobs).where(sql`${archiveJobs.id} = ${job.id}`),
        { audit: false },
      );
      report.processed++;
      report.results.push(result);
    } catch (e) {
      const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      console.error(`archive: job ${job.runId} failed (attempt ${job.attempts}): ${message}`);
      const next = new Date(now.getTime() + backoffMinutes(job.attempts) * 60_000);
      await database.withSystem(
        "archive.queue.fail",
        (tx) =>
          tx
            .update(archiveJobs)
            .set({ lastError: message, lockedAt: null, nextAttemptAt: next })
            .where(sql`${archiveJobs.id} = ${job.id}`),
        { audit: false },
      );
      report.failed++;
    }
  }
  return report;
}
