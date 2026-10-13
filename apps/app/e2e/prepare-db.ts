import { execFileSync } from "node:child_process";
import pg from "pg";
import { prepareLocalRolesAt } from "@voidaccess/db/local";

/**
 * Run by the webServer command before the app boots: drop and recreate the e2e database (only if its name says it is an e2e database), apply migrations as the owner,
 * then give the logins their local passwords and key. A fresh database per run means no other lane's migrations or
 * rows can leak into this suite.
 */
async function prepare() {
  const migrateUrl = process.env.MIGRATE_DATABASE_URL;
  if (!migrateUrl) throw new Error("MIGRATE_DATABASE_URL is not set");
  const target = new URL(migrateUrl);
  const dbName = target.pathname.replace(/^\//, "");
  if (!/^[a-z0-9_]+$/.test(dbName) || !dbName.includes("_e2e"))
    throw new Error(`refusing to recreate "${dbName}": e2e databases must contain "_e2e" in their name`);
  const admin = new URL(target.toString());
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await client.query(`CREATE DATABASE ${dbName}`);
  await client.end();
  execFileSync("pnpm", ["--filter", "@voidaccess/db", "db:migrate"], {
    env: process.env,
    stdio: "inherit",
  });
  await prepareLocalRolesAt(migrateUrl);
}

// Runs inside the webServer command (before the app starts): Playwright starts the web server before globalSetup,
// and the readiness check (/api/health) needs the database.
await prepare();
