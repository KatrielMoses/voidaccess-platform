import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@voidaccess/db/migrate";
import { APP_PASSWORD, TEST_DB, adminUrl, ownerUrl } from "./urls";

// `pg` is not a direct dependency of apps/app (pnpm is strict): load the copy @voidaccess/db uses.
const requireFromDb = createRequire(
  fileURLToPath(new URL("../../../packages/db/package.json", import.meta.url)),
);
const pg = requireFromDb("pg") as typeof import("pg");

export default async function setup() {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await runMigrations(ownerUrl);
  await admin.query(`ALTER ROLE va_app LOGIN PASSWORD '${APP_PASSWORD}'`);
  await admin.end();
}
