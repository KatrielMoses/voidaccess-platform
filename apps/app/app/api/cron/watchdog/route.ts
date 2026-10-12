import { authorizeCron } from "@/lib/runs/cron-auth";
import { json } from "@/lib/runs/http";
import { runWatchdog } from "@/lib/runs/watchdog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/cron/watchdog: Bearer CRON_SHARED_SECRET (dev) or Google OIDC (production). withSystem('cron.watchdog'). */
export async function POST(req: Request) {
  if (!(await authorizeCron(req))) return json({ error: "unauthorized" }, 401);
  return json(await runWatchdog());
}
