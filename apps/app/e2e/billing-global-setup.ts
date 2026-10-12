import pg from "pg";
import { runMigrations } from "@voidaccess/db/migrate";
import { createLocalDatabase, prepareLocalRolesAt } from "@voidaccess/db/local";
import { FakeProvider } from "../lib/billing/provider";
import { syncCatalog } from "../lib/billing/sync";

export const BILLING_DB = `${process.env.VA_TEST_DB ?? "voidaccess_test"}_billing_e2e`;
const admin = new URL(process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/postgres");
const withDb = (db: string, auth?: [string, string]) => {
  const u = new URL(admin.toString());
  u.pathname = `/${db}`;
  if (auth) [u.username, u.password] = auth;
  return u.toString();
};
export const ownerUrl = () => withDb(BILLING_DB);
export const appUrl = () =>
  withDb(BILLING_DB, ["va_app", process.env.VA_APP_LOCAL_PASSWORD ?? "va_app_local"]);
export const WEBHOOK_SECRET = "whsec_" + Buffer.from("e2e-webhook-secret-0123456789abc").toString("base64");

/** Fresh database, migrations, and the (fake-provider) Dodo catalogue so checkout has products to point at. */
export default async function setup() {
  const a = new pg.Client({ connectionString: withDb("postgres") });
  await a.connect();
  await a.query(`DROP DATABASE IF EXISTS ${BILLING_DB} WITH (FORCE)`);
  await a.query(`CREATE DATABASE ${BILLING_DB}`);
  await runMigrations(ownerUrl());
  await prepareLocalRolesAt(ownerUrl());
  await a.end();
  const db = createLocalDatabase(appUrl());
  await syncCatalog(new FakeProvider(), db);
  await db.close();
}
