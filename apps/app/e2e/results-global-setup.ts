import { mkdirSync, writeFileSync } from "node:fs";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { runMigrations } from "@voidaccess/db/migrate";
import { hashPassword } from "better-auth/crypto";
import { accounts, createDatabase, investigations, users } from "@voidaccess/db";
import { ingestBundle } from "@voidaccess/ingest";
import { bundleDeps, fixtureBundle, generateBundle } from "@voidaccess/ingest/test-support";
import type { ResultBundle } from "@voidaccess/engine-client";

/** Password for every seeded results-e2e user (local test database only). */
export const E2E_PASSWORD = "results e2e correct horse battery";
export const E2E_DB = `${process.env.VA_TEST_DB ?? "voidaccess_test"}_e2e`;
const admin = new URL(process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/postgres");
const withDb = (db: string, auth?: [string, string]) => {
  const u = new URL(admin.toString());
  u.pathname = `/${db}`;
  if (auth) [u.username, u.password] = auth;
  return u.toString();
};
export const appUrl = () => withDb(E2E_DB, ["va_app", process.env.VA_APP_LOCAL_PASSWORD ?? "va_app_local"]);

export default async function setup() {
  const a = new pg.Client({ connectionString: withDb("postgres") });
  await a.connect();
  await a.query(`DROP DATABASE IF EXISTS ${E2E_DB} WITH (FORCE)`);
  await a.query(`CREATE DATABASE ${E2E_DB}`);
  await runMigrations(withDb(E2E_DB));
  await a.query(`ALTER ROLE va_app LOGIN PASSWORD '${process.env.VA_APP_LOCAL_PASSWORD ?? "va_app_local"}'`);
  await a.end();

  process.env.VA_FINGERPRINT_KEY ??= "e2e-fp";
  process.env.VA_LOCAL_KEK ??= Buffer.alloc(32, 5).toString("base64");
  const db = createDatabase(appUrl());
  const pro = randomUUID();
  const free = randomUUID();
  const other = randomUUID();
  // Real Better Auth credentials (verified, AUP accepted) so the spec signs in like a user would.
  const passwordHash = await hashPassword(E2E_PASSWORD);
  const seeded = [
    { id: pro, name: "Pro", plan: "pro" as const },
    { id: free, name: "Free", plan: "free" as const },
    { id: other, name: "Other", plan: "pro" as const },
  ];
  await db.withSystem("e2e.users", async (tx) => {
    await tx.insert(users).values(
      seeded.map((u) => ({
        id: u.id,
        name: u.name,
        email: `${u.id}@e2e.local`,
        plan: u.plan,
        emailVerified: true,
        aupAcceptedAt: new Date(),
      })),
    );
    await tx.insert(accounts).values(
      seeded.map((u) => ({
        id: randomUUID(),
        accountId: u.id,
        providerId: "credential",
        userId: u.id,
        password: passwordHash,
      })),
    );
  });
  const seed = async (userId: string, bundle: ResultBundle) => {
    const id = randomUUID();
    await db.withSystem("e2e.inv", (tx) =>
      tx.insert(investigations).values({
        id,
        userId,
        query: bundle.query,
        depth: bundle.depth,
        status: "completed",
        engineRunId: `e2e-${id}`,
        creditsCharged: 40,
        refinedQueries: bundle.refined_queries,
        completedAt: new Date(bundle.completed_at),
      }),
    );
    await ingestBundle(`e2e-${id}`, bundleDeps(bundle, { stix: "{}", sigma: "title: x\n" }), {
      database: db,
    });
    return id;
  };
  const state = {
    pro,
    free,
    other,
    big: await seed(pro, fixtureBundle("blackcat-standard-onion")),
    small: await seed(pro, fixtureBundle("dprk-deep-typed")),
    freeInv: await seed(free, fixtureBundle("dprk-deep-typed")),
    huge: await seed(pro, generateBundle()),
    appUrl: appUrl(),
  };
  await db.close();
  mkdirSync(new URL("./.state", import.meta.url).pathname, { recursive: true });
  writeFileSync(new URL("./.state/state.json", import.meta.url).pathname, JSON.stringify(state));
}
