// Same convention as packages/db: TEST_DATABASE_URL is a superuser connection; the harness drops and
// recreates its own database. Suffixed so `turbo run test` can run db, ingest and app tests in parallel.
const admin = new URL(process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/postgres");
export const TEST_DB = `${process.env.VA_TEST_DB ?? "voidaccess_test"}_ingest`;
if (!/^[a-z0-9_]+$/.test(TEST_DB)) throw new Error("VA_TEST_DB must be [a-z0-9_]+");
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
export const ownerUrl = withDb(admin, TEST_DB);
export const appUrl = withDb(admin, TEST_DB, { user: "va_app", password: APP_PASSWORD });
