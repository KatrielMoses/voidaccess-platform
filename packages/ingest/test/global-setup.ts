import pg from "pg";
import { runMigrations } from "@voidaccess/db/migrate";
import { TEST_DB, adminUrl, ownerUrl, APP_PASSWORD } from "./urls";

export default async function setup() {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await runMigrations(ownerUrl);
  await admin.query(`ALTER ROLE va_app LOGIN PASSWORD '${APP_PASSWORD}'`);
  await admin.end();
}
