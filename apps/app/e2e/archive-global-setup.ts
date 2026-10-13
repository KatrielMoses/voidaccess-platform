import pg from "pg";
import { prepareLocalRolesAt } from "@voidaccess/db/local";
import { runMigrations } from "@voidaccess/db/migrate";

export const ARCHIVE_DB = `${process.env.VA_TEST_DB ?? "voidaccess_test"}_archive_e2e`;
const admin = new URL(process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/postgres");
const withDb = (db: string, auth?: [string, string]) => {
  const u = new URL(admin.toString());
  u.pathname = `/${db}`;
  if (auth) [u.username, u.password] = auth;
  return u.toString();
};
export const ownerUrl = () => withDb(ARCHIVE_DB);
export const appUrl = () =>
  withDb(ARCHIVE_DB, ["va_app", process.env.VA_APP_LOCAL_PASSWORD ?? "va_app_local"]);

/** Fresh database and migrations for the archive end-to-end run. */
export default async function setup() {
  const a = new pg.Client({ connectionString: withDb("postgres") });
  await a.connect();
  await a.query(`DROP DATABASE IF EXISTS ${ARCHIVE_DB} WITH (FORCE)`);
  await a.query(`CREATE DATABASE ${ARCHIVE_DB}`);
  await runMigrations(ownerUrl());
  await prepareLocalRolesAt(ownerUrl());
  await a.end();
}
