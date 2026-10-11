import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "@voidaccess/db/schema";

export type Db = PgDatabase<any, typeof schema>;

let cached: { url: string; db: Db } | undefined;

/**
 * One adapter, two drivers: Neon HTTP on Workers/production (no sockets), node-postgres locally.
 * node-postgres is imported with bundler-ignore hints so it never enters the Worker bundle (it is only used
 * when running under Node). Chosen by DB_DRIVER, else by hostname (neon.tech => neon). No transactions are used, so both behave the same.
 */
export async function getDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (cached?.url === url) return cached.db;
  const driver = process.env.DB_DRIVER ?? (/neon\.tech/.test(url) ? "neon" : "pg");
  let db: Db;
  if (driver === "neon") {
    const [{ neon }, { drizzle }] = await Promise.all([import("@neondatabase/serverless"), import("drizzle-orm/neon-http")]);
    db = drizzle(neon(url), { schema }) as unknown as Db;
  } else {
    const [{ default: pg }, { drizzle }] = await Promise.all([import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "pg"), import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "drizzle-orm/node-postgres")]);
    db = drizzle(new pg.Pool({ connectionString: url, max: 5 }), { schema }) as unknown as Db;
  }
  cached = { url, db };
  return db;
}
