/**
 * One-time Neon provisioning for VoidAccess Cloud. Run it yourself:
 *   cd platform/packages/db && npx tsx scripts/neon-provision.ts
 *
 * Reads the owner connection string from Secret Manager (database-url-owner), then:
 *   1. switches to Neon's DIRECT host (migrations and SET LOCAL ROLE need it, not the pooler)
 *   2. applies all platform migrations (P0 schema + RLS, P2 run lifecycle, H1 role split) as the owner
 *   3. applies the site's waitlist table
 *   4. gives the RLS-bound app role va_app a login with a random password
 *   5. gives the system login va_worker (member of va_system; creates no privileges of its own) a random password
 *   6. installs the tenant-context key in the database (app_ctx_key), reusing the key already in Secret Manager
 *   7. creates va_site: a login that can ONLY select/insert/update the waitlist table
 *   8. stores database-url (va_app), database-url-system (va_worker), rls-context-key, database-url-site (va_site)
 *      and database-url-owner-direct
 * Never prints a password, key or connection string. Safe to re-run: rotates the three passwords and keeps the
 * context key (a new key is generated only when the rls-context-key secret has no version).
 *
 * CUTOVER (H1): migration 0006 revokes va_system from va_app and replaces app_user_id(), so a revision of the app
 * built BEFORE H1 stops working the moment this script migrates (it can neither SET ROLE va_system nor sign
 * the tenant context). Run this script, then deploy the H1 revision straight away; there are no other steps.
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
console.log("1/5 platform migrations applied");

const c = new pg.Client({ connectionString: owner });
await c.connect();
const waitlistSql = fileURLToPath(
  new URL("../../../apps/site/drizzle/0000_waitlist_init.sql", import.meta.url),
);
await c.query(readFileSync(waitlistSql, "utf8"));
console.log("2/5 waitlist table applied");

const appPw = randomBytes(24).toString("hex");
const workerPw = randomBytes(24).toString("hex");
const sitePw = randomBytes(24).toString("hex");
await c.query(`ALTER ROLE va_app LOGIN PASSWORD '${appPw}'`);
await c.query(`ALTER ROLE va_worker LOGIN PASSWORD '${workerPw}'`);

// Tenant-context key: keep the one already issued so a re-run never invalidates running instances.
let contextKey = "";
try {
  contextKey = gcloud(["secrets", "versions", "access", "latest", "--secret=rls-context-key"]).trim();
} catch {
  /* no version yet */
}
if (contextKey.length < 32) contextKey = randomBytes(32).toString("hex");
await c.query(
  `INSERT INTO app_ctx_key (singleton, key) VALUES (true, $1)
   ON CONFLICT (singleton) DO UPDATE SET key = excluded.key, rotated_at = now()`,
  [contextKey],
);
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
  (SELECT count(*) FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = 'va_app')::int AS app_role_memberships,
  pg_has_role('va_worker', 'va_system', 'USAGE') AS worker_acts_as_system,
  (SELECT count(*) FROM app_ctx_key)::int AS context_keys,
  (SELECT count(*) FROM founding_seats)::int AS founding_seats`);
console.log("3/5 roles ready:", check.rows[0]);
if (
  check.rows[0].app_role_memberships !== 0 ||
  check.rows[0].app_bypasses_rls ||
  !check.rows[0].worker_acts_as_system
)
  throw new Error(
    "role check failed: va_app must be a member of nothing and va_worker must act as va_system",
  );
console.log("4/5 role design verified (nothing is stored before this passes)");
await c.end();

const withUser = (user: string, pw: string) => {
  const u = new URL(owner);
  u.username = user;
  u.password = pw;
  return u.toString();
};
for (const [name, value] of [
  ["database-url", withUser("va_app", appPw)],
  ["database-url-system", withUser("va_worker", workerPw)],
  ["rls-context-key", contextKey],
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
console.log(
  "5/5 stored database-url, database-url-system, rls-context-key, database-url-site, database-url-owner-direct",
);
