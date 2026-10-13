import pg from "pg";
import { runMigrations } from "@voidaccess/db/migrate";
import { prepareLocalRolesAt } from "@voidaccess/db/local";

export const OPS_DB = `${process.env.VA_TEST_DB ?? "voidaccess_test"}_ops_e2e`;
const admin = new URL(process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/postgres");
const withDb = (db: string, auth?: [string, string]) => {
  const u = new URL(admin.toString());
  u.pathname = `/${db}`;
  if (auth) [u.username, u.password] = auth;
  return u.toString();
};
export const ownerUrl = () => withDb(OPS_DB);
export const appUrl = () => withDb(OPS_DB, ["va_app", process.env.VA_APP_LOCAL_PASSWORD ?? "va_app_local"]);

/** Fresh database and migrations for the ops end-to-end run. */
export default async function setup() {
  const a = new pg.Client({ connectionString: withDb("postgres") });
  await a.connect();
  await a.query(`DROP DATABASE IF EXISTS ${OPS_DB} WITH (FORCE)`);
  await a.query(`CREATE DATABASE ${OPS_DB}`);
  await runMigrations(ownerUrl());
  await prepareLocalRolesAt(ownerUrl()); // va_app and va_worker logins plus the RLS context key (H1)
  await a.end();
}
