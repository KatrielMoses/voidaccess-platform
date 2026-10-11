// Better Auth's own database handle. Better Auth reads sessions before any user is known and writes
// users/accounts/verifications, which RLS (rightly) denies to va_app. This pool therefore connects as va_app
// but runs every session as the system role (`-c role=va_system`), see docs/DATA-MODEL.md §3. Used ONLY by Better Auth.
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@voidaccess/db/schema";

let cached: ReturnType<typeof make> | undefined;

function make() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new pg.Pool({ connectionString: url, max: 5, options: "-c role=va_system" });
  return { pool, db: drizzle(pool, { schema }) };
}

export function getAuthDb() {
  return (cached ??= make());
}
