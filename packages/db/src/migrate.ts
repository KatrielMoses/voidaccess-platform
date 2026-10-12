// Applies drizzle migrations as the OWNER role (MIGRATE_DATABASE_URL), never as va_app.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { fileURLToPath } from "node:url";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

export async function runMigrations(url: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    // Roles are cluster-wide, so parallel test suites migrating their own databases can race on CREATE/GRANT of
    // va_app and va_system. Migrations run in one transaction, so a retry after such a collision is safe.
    for (let attempt = 1; ; attempt++) {
      try {
        await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
        return;
      } catch (e) {
        const code =
          (e as { code?: string; cause?: { code?: string } }).code ??
          (e as { cause?: { code?: string } }).cause?.code;
        if (attempt >= 5 || (code !== "23505" && code !== "XX000" && code !== "40001")) throw e;
        await new Promise((r) => setTimeout(r, 200 * attempt));
      }
    }
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("MIGRATE_DATABASE_URL is not set");
  await runMigrations(url);
  console.log("migrations applied");
}
