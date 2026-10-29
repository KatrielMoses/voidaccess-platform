import { mkdirSync, writeFileSync } from "node:fs";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { runMigrations } from "@voidaccess/db/migrate";
import { investigations, users } from "@voidaccess/db";
import { createLocalDatabase, prepareLocalRolesAt } from "@voidaccess/db/local";
import { ingestBundle } from "@voidaccess/ingest";
import { bundleDeps, fixtureBundle, generateBundle, withTiers } from "@voidaccess/ingest/test-support";
import { ENTITY_TYPES, isSecretType, isSensitiveType, type ResultBundle } from "@voidaccess/engine-client";

/**
 * The P9 large fixture: >= 1,500 entities, >= 4,000 relationships and every entity type (so every sidebar group),
 * built on the synthetic generator. Values are shaped like their type; secrets arrive already redacted
 * (`len:N sha256:…`, as the runner sends them) and ingest masks the rest exactly as it does for real runs.
 */
function allCategoriesBundle(): ResultBundle {
  const b = generateBundle({ entities: 1600, relationships: 4200, sources: 120, seed: 9 });
  const hex = (i: number, n: number) => (i * 2654435761).toString(16).padStart(n, "0").slice(-n);
  b.entities.forEach((e, i) => {
    if (i % 7 !== 0) return;
    const type = ENTITY_TYPES[(i / 7) % ENTITY_TYPES.length]!;
    const value = isSecretType(type)
      ? `len:${20 + (i % 9)} sha256:${hex(i, 8)}`
      : type === "EMAIL_ADDRESS"
        ? `analyst${i}@example.org`
        : type === "PHONE_NUMBER"
          ? `+1 555 01${String(i % 100).padStart(2, "0")}`
          : type === "PERSON_NAME"
            ? `Person Example ${i}`
            : type.endsWith("_ADDRESS") && !type.startsWith("IP")
              ? `${type.slice(0, 3).toLowerCase()}1${hex(i, 8)}${hex(i + 1, 8)}${hex(i + 2, 8)}`
              : `${type.toLowerCase().replace(/_/g, "-")}-${i}`;
    Object.assign(e, { type, value, display_value: value, sensitive: isSensitiveType(type) });
  });
  return {
    ...b,
    query: "synthetic all-categories bundle",
    refined_queries: ["synthetic all-categories bundle"],
  };
}

/** Password for every seeded results-e2e user (local test database only). */
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
  await prepareLocalRolesAt(withDb(E2E_DB));
  await a.end();

  process.env.VA_FINGERPRINT_KEY ??= "e2e-fp";
  process.env.VA_LOCAL_KEK ??= Buffer.alloc(32, 5).toString("base64");
  const db = createLocalDatabase(appUrl());
  const pro = randomUUID();
  const free = randomUUID();
  const other = randomUUID();
  // Verified, AUP accepted: the spec signs them in with an emailed code like a user would.
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
    allCats: await seed(pro, allCategoriesBundle()),
    // 2.2 relevance tiers (22R-shaped): a tiered run, and one where nothing collected mentions the query
    tiered: await seed(pro, withTiers(fixtureBundle("lockbit-deep"))),
    noDirect: await seed(pro, withTiers(fixtureBundle("dprk-deep-typed"), { direct: false })),
    appUrl: appUrl(),
  };
  await db.close();
  mkdirSync(new URL("./.state", import.meta.url).pathname, { recursive: true });
  writeFileSync(new URL("./.state/state.json", import.meta.url).pathname, JSON.stringify(state));
}
