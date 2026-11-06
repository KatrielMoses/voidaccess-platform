import pg from "pg";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { adminGrant, investigations, reserve, topup, users, type Database } from "@voidaccess/db";
import type { Depth, PlanId } from "@voidaccess/config";
import { ingestBundle } from "@voidaccess/ingest";
import { bundleDeps } from "@voidaccess/ingest/test-support";
import type { ResultBundle } from "@voidaccess/engine-client";
import { createLocalDatabase } from "@voidaccess/db/local";
import { appUrl, ownerUrl } from "./urls";

let app: Database | undefined;
let owner: pg.Pool | undefined;
export const appDb = () => (app ??= createLocalDatabase(appUrl, { max: 10 }));
export const ownerPool = () => (owner ??= new pg.Pool({ connectionString: ownerUrl, max: 3 }));

export async function makeUser(plan: PlanId = "pro") {
  const id = randomUUID();
  await appDb().withSystem("test.makeUser", (tx) =>
    tx.insert(users).values({
      id,
      name: "T " + id.slice(0, 4),
      email: `${id}@test.local`,
      plan,
      emailVerified: true,
      aupAcceptedAt: new Date(),
    }),
  );
  return id;
}

export const ARTIFACTS = {
  stix: '{"type":"bundle","id":"bundle--test","objects":[]}',
  sigma: "title: test\n",
};

/** Creates an investigation for `userId` and ingests `bundle` into it. */
export async function seedInvestigation(
  userId: string,
  bundle: ResultBundle,
  artifacts: Record<string, string> = ARTIFACTS,
) {
  const id = randomUUID();
  await appDb().withSystem("test.seed", (tx) =>
    tx.insert(investigations).values({
      id,
      userId,
      query: bundle.query,
      depth: bundle.depth,
      status: "completed",
      engineRunId: `run-${id}`,
      creditsCharged: 40,
      refinedQueries: bundle.refined_queries,
    }),
  );
  await ingestBundle(`run-${id}`, bundleDeps(bundle, artifacts), { database: appDb() });
  return id;
}

/**
 * Like seedInvestigation, but the run is paid from a PURCHASED top-up lot (a real `topup` + `reserve`), the case
 * that unlocks the full report on the Free plan. `adminLot` uses an admin grant instead (no dollars: stays a preview).
 */
export async function seedTopupPaidInvestigation(
  userId: string,
  bundle: ResultBundle,
  opts: { adminLot?: boolean; artifacts?: Record<string, string> } = {},
) {
  const ctx = { database: appDb() };
  if (opts.adminLot) await adminGrant(userId, 500, userId, `grant-${randomUUID()}`, {}, ctx);
  else await topup(userId, 5, `pay-${randomUUID()}`, ctx);
  const id = await seedInvestigation(userId, bundle, opts.artifacts);
  const r = await reserve(userId, id, bundle.depth as Depth, ctx);
  if (!r.ok) throw new Error(`test reserve failed: ${r.reason}`);
  return id;
}

/** Move a user to another plan (an upgrade or downgrade as billing would apply it). */
export async function setPlan(userId: string, plan: PlanId) {
  await appDb().withSystem("test.setPlan", (tx) =>
    tx.update(users).set({ plan }).where(eq(users.id, userId)),
  );
}
