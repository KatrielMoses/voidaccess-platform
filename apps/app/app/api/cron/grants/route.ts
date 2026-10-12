import { NextResponse } from "next/server";
import { authorizeBillingCron } from "@/lib/billing/cron-auth";
import { runGrants } from "@/lib/billing/cron";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/cron/grants: Bearer CRON_SHARED_SECRET (dev) or Cloud Scheduler OIDC (production). Idempotent. */
export async function POST(req: Request) {
  if (!(await authorizeBillingCron(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runGrants(new Date()));
}
