// Dev seeding: create a user + a completed investigation and ingest a fixture (or "generated").
//   DATABASE_URL=postgres://va_app:...@localhost/voidaccess_p3_dev \
//   VA_FINGERPRINT_KEY=... VA_LOCAL_KEK=... \
//   pnpm --filter @voidaccess/ingest seed:fixture blackcat-standard-onion [--plan free|pro|pro_plus] [--user <uuid>] [--clean]
// Prints the results URL. Refuses to run against a non-local database. Fixtures are redacted; no real data.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase, investigations, users } from "@voidaccess/db";
import { PLANS, depthCredits, type PlanId } from "@voidaccess/config";
import { FIXTURE_NAMES } from "@voidaccess/engine-mock";
import { ingestBundle } from "./ingest";
import { bundleDeps, fixtureBundle, generateBundle } from "./test-support";

const args = process.argv.slice(2);
const name = args.find(
  (a) => !a.startsWith("--") && !["free", "pro", "pro_plus"].includes(a) && !/^[0-9a-f-]{36}$/.test(a),
);
const opt = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!name || (name !== "generated" && !(FIXTURE_NAMES as readonly string[]).includes(name))) {
  console.error(
    `usage: seed:fixture <${[...FIXTURE_NAMES, "generated"].join("|")}> [--plan free|pro|pro_plus] [--user <uuid>]`,
  );
  process.exit(2);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
if (!["localhost", "127.0.0.1", ""].includes(new URL(url).hostname))
  throw new Error("seed only runs against a local database");
const plan = (opt("--plan") ?? "pro") as PlanId;
if (!(plan in PLANS)) throw new Error(`unknown plan ${plan}`);
const userId = opt("--user") ?? process.env.DEV_AS_USER ?? randomUUID();

const database = createDatabase(url);
const bundle =
  name === "generated" ? generateBundle() : fixtureBundle(name as (typeof FIXTURE_NAMES)[number]);
const invId = randomUUID();
await database.withSystem("seed.fixture", async (tx) => {
  const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!u) await tx.insert(users).values({ id: userId, name: "Dev User", email: `${userId}@dev.local`, plan });
  else await tx.update(users).set({ plan }).where(eq(users.id, userId));
  await tx.insert(investigations).values({
    id: invId,
    userId,
    query: bundle.query,
    depth: bundle.depth,
    status: "completed",
    engineRunId: `seed-${invId}`,
    creditsCharged: depthCredits(bundle.depth),
    refinedQueries: bundle.refined_queries,
    startedAt: new Date(bundle.started_at),
    completedAt: new Date(bundle.completed_at),
  });
});
const artifacts = {
  stix: JSON.stringify({ type: "bundle", id: `bundle--${invId}`, objects: [] }),
  sigma: "title: seeded placeholder\nstatus: experimental\n",
};
await ingestBundle(`seed-${invId}`, bundleDeps(bundle, artifacts), { database });
await database.close();
console.log(`seeded ${name} for user ${userId} (${plan})`);
console.log(`DEV_AS_USER=${userId}`);
console.log(`http://localhost:3200/investigations/${invId}/results`);
