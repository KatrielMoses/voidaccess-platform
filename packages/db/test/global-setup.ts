import pg from "pg";
import { runMigrations } from "../src/migrate";
import { TEST_DB, adminUrl, ownerUrl, APP_PASSWORD } from "./urls";

export default async function setup() {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await runMigrations(ownerUrl);
  // roles are created NOLOGIN by the migration; the harness gives the app role a login
  await admin.query(`ALTER ROLE va_app LOGIN PASSWORD '${APP_PASSWORD}'`);
  await admin.end();
}
