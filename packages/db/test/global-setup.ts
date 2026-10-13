import pg from "pg";
import { prepareLocalRolesAt } from "../src/local";
import { runMigrations } from "../src/migrate";
import { TEST_DB, adminUrl, ownerUrl } from "./urls";

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
