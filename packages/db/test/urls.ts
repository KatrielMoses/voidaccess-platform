// TEST_DATABASE_URL: a superuser connection to a Postgres server (any database). Tests create `voidaccess_test`.
const admin = new URL(process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/postgres");
export const TEST_DB = "voidaccess_test";
export const APP_PASSWORD = "va_app_test_pw";

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
