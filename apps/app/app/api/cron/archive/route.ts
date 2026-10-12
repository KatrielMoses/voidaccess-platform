import { NextResponse } from "next/server";
import { processArchiveQueue } from "@voidaccess/archive";
import { archiveDepsFor } from "@/lib/archive/deps";
import { authorizeArchiveCron } from "@/lib/archive/cron-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/cron/archive: files finished runs into the archive. Bounded batch and time, retries with backoff,
 * deletes a job row once its run is archived. Failures never touch the user's run (it was completed before the job existed).
 */
export async function POST(req: Request) {
  if (!(await authorizeArchiveCron(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const r = await processArchiveQueue({ depsFor: () => archiveDepsFor(), batch: 10, budgetMs: 25_000 });
  return NextResponse.json({ processed: r.processed, failed: r.failed });
}
