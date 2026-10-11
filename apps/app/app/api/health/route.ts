import { healthCheck } from "@voidaccess/db/client";
import { getEnv } from "../../../env";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = getEnv();
  let db: "up" | "down" | "unconfigured" = "down";
  try {
    db = (await healthCheck()).db;
  } catch {
    db = "down";
  }
  const status = db === "down" ? "degraded" : "ok";
  return Response.json(
    { status, version: env.APP_VERSION, commit: env.COMMIT_SHA, db },
    { status: db === "down" ? 503 : 200, headers: { "cache-control": "no-store" } },
  );
}
