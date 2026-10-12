/** The RunSpec endpoint's logic: single-use token consumption. */
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { RunSpec } from "@voidaccess/engine-client";
import { auditLog, getDatabase, investigations } from "@voidaccess/db";
import { getEnv } from "../../env";
import { launcherKind } from "../launcher";
import { gcsArtifactUrls } from "../launcher/artifact-paths";
import { RUN_DEADLINE_MINUTES } from "../limits";
import { deriveArtifactToken, deriveCallbackSecret, hashSpecToken } from "./secrets";

/**
 * Atomically consume the token: ONE statement that matches the stored sha256, requires it unused and
 * unexpired (database clock) and the run still launching/running, and marks it used. Zero rows means
 * wrong token, expired, reused, wrong run or unknown run, and the caller returns the same 404 for all of
 * them, so nothing reveals whether a run exists. Only a successful consume writes an audit row.
 */
export async function consumeSpecToken(runId: string, token: string): Promise<RunSpec | null> {
  const row = await getDatabase().withSystem(
    "engine.spec",
    async (tx) => {
      const [r] = await tx
        .update(investigations)
        .set({ specTokenUsedAt: sql`now()` })
        .where(
          and(
            eq(investigations.id, runId),
            eq(investigations.specTokenHash, hashSpecToken(token)),
            isNull(investigations.specTokenUsedAt),
            gt(investigations.specTokenExpiresAt, sql`now()`),
            inArray(investigations.status, ["launching", "running"]),
          ),
        )
        .returning({ query: investigations.query, depth: investigations.depth });
      if (r)
        await tx
          .insert(auditLog)
          .values({ actor: "engine", action: "spec_served", target: runId, meta: { reason: "engine.spec" } });
      return r;
    },
    { audit: false },
  );
  if (!row) return null;
  const base = getEnv().APP_URL.replace(/\/$/, "");
  return {
    run_id: runId,
    query: row.query,
    depth: row.depth,
    callback_url: `${base}/api/engine/runs/${runId}/events`,
    callback_secret: deriveCallbackSecret(runId),
    artifact_put_urls:
      launcherKind() === "cloudrun"
        ? // Production: the runner uploads to the runs bucket with its own identity (no presigned URLs).
          gcsArtifactUrls(runId)
        : {
            // Mock artifact route (dev/test only).
            bundle: `${base}/api/engine/runs/${runId}/artifacts/bundle?t=${deriveArtifactToken(runId)}`,
            exports: {},
          },
    deadline_at: new Date(Date.now() + RUN_DEADLINE_MINUTES * 60_000).toISOString(),
  };
}
