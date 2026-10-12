/**
 * One-time Neon provisioning for VoidAccess Cloud. Run it yourself:
 *   cd platform/packages/db && npx tsx scripts/neon-provision.ts
 *
 * Reads the owner connection string from Secret Manager (database-url-owner), then:
 *   1. switches to Neon's DIRECT host (migrations and SET LOCAL ROLE need it, not the pooler)
 *   2. applies all platform migrations (P0 schema + RLS, P2 run lifecycle) as the owner
 *   3. applies the site's waitlist table
 *   4. gives the RLS-bound app role va_app a login with a random password
 *   5. creates va_site: a login that can ONLY select/insert/update the waitlist table
 *   6. stores database-url (va_app), database-url-site (va_site) and database-url-owner-direct
 * Never prints a password or connection string. Safe to re-run (rotates the two passwords).
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runMigrations } from "../src/migrate";

const gcloud = (args: string[], input?: string) =>
  execFileSync("gcloud", args, {
    input,
    stdio: [input ? "pipe" : "ignore", "pipe", "ignore"],
    env: { ...process.env, CLOUDSDK_ACTIVE_CONFIG_NAME: "voidaccess" },
  }).toString();

const ownerPooled = gcloud(["secrets", "versions", "access", "latest", "--secret=database-url-owner"]).trim();
const direct = new URL(ownerPooled);
direct.hostname = direct.hostname.replace("-pooler", "");
const owner = direct.toString();

await runMigrations(owner);
console.log("1/4 platform migrations applied");

const c = new pg.Client({ connectionString: owner });
await c.connect();
const waitlistSql = fileURLToPath(
  new URL("../../../apps/site/drizzle/0000_waitlist_init.sql", import.meta.url),
);
await c.query(readFileSync(waitlistSql, "utf8"));
console.log("2/4 waitlist table applied");

const appPw = randomBytes(24).toString("hex");
const sitePw = randomBytes(24).toString("hex");
await c.query(`ALTER ROLE va_app LOGIN PASSWORD '${appPw}'`);
await c.query(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'va_site') THEN
    CREATE ROLE va_site LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF; END $$`);
await c.query(`ALTER ROLE va_site LOGIN PASSWORD '${sitePw}'`);
await c.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM va_site`);
await c.query(`GRANT USAGE ON SCHEMA public TO va_site`);
await c.query(`GRANT SELECT, INSERT, UPDATE ON waitlist TO va_site`);
const check = await c.query(`SELECT
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public')::int AS tables,
  (SELECT rolbypassrls FROM pg_roles WHERE rolname = 'va_app') AS app_bypasses_rls,
  (SELECT count(*) FROM founding_seats)::int AS founding_seats`);
console.log("3/4 roles ready:", check.rows[0]);
await c.end();

const withUser = (user: string, pw: string) => {
  const u = new URL(owner);
  u.username = user;
  u.password = pw;
  return u.toString();
};
for (const [name, value] of [
  ["database-url", withUser("va_app", appPw)],
  ["database-url-site", withUser("va_site", sitePw)],
  ["database-url-owner-direct", owner],
] as const) {
  try {
    gcloud(["secrets", "describe", name]);
  } catch {
    gcloud(["secrets", "create", name, "--replication-policy=automatic"]);
  }
  gcloud(["secrets", "versions", "add", name, "--data-file=-"], value);
}
console.log("4/4 stored database-url, database-url-site, database-url-owner-direct");
