import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { prepareLocalRolesAt } from "@voidaccess/db/local";
import { runMigrations } from "@voidaccess/db/migrate";
import { TEST_DB, adminUrl, ownerUrl } from "./urls";

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
  // roles are created NOLOGIN by the migration; the harness gives them logins and installs the context key
  await prepareLocalRolesAt(ownerUrl);
  await admin.end();
}
