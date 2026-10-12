import pg from "pg";
import { randomUUID } from "node:crypto";
import { createDatabase, investigations, users, type Database } from "@voidaccess/db";
import type { PlanId } from "@voidaccess/config";
import { ingestBundle } from "@voidaccess/ingest";
import { bundleDeps } from "@voidaccess/ingest/test-support";
import type { ResultBundle } from "@voidaccess/engine-client";
import { appUrl, ownerUrl } from "./urls";

let app: Database | undefined;
let owner: pg.Pool | undefined;
export const appDb = () => (app ??= createDatabase(appUrl, { max: 10 }));
export const ownerPool = () => (owner ??= new pg.Pool({ connectionString: ownerUrl, max: 3 }));

export async function makeUser(plan: PlanId = "pro") {
  const id = randomUUID();
  await appDb().withSystem("test.makeUser", (tx) =>
    tx.insert(users).values({ id, name: "T " + id.slice(0, 4), email: `${id}@test.local`, plan }),
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
