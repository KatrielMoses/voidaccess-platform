// Applies drizzle migrations as the OWNER role (MIGRATE_DATABASE_URL), never as va_app.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { fileURLToPath } from "node:url";

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

export async function runMigrations(url: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
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
