// TEST_DATABASE_URL: a superuser connection to a Postgres server (any database).
// Tests DROP and recreate VA_TEST_DB (default `voidaccess_test`); parallel lanes must each set their own.
const admin = new URL(process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/postgres");
export const TEST_DB = process.env.VA_TEST_DB ?? "voidaccess_test";
if (!/^[a-z0-9_]+$/.test(TEST_DB)) throw new Error("VA_TEST_DB must be [a-z0-9_]+");
// va_app is a cluster-wide role: dev-setup and tests must agree on its local password.
export const APP_PASSWORD = process.env.VA_APP_LOCAL_PASSWORD ?? "va_app_local";

function withDb(u: URL, db: string, auth?: { user: string; password: string }) {
  const c = new URL(u.toString());
  c.pathname = `/${db}`;
  if (auth) {
    c.username = auth.user;
    c.password = auth.password;
  }
  return c.toString();
}
export const adminUrl = withDb(admin, "postgres");
/** owner/superuser connection to the test database (migrations, raw inspection) */
export const ownerUrl = withDb(admin, TEST_DB);
/** the non-owner app role (subject to RLS) */
export const appUrl = withDb(admin, TEST_DB, { user: "va_app", password: APP_PASSWORD });
