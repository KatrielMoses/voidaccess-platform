// Better Auth's own database handle. Better Auth reads sessions before any user is known and writes
// users/accounts/verifications, which RLS (rightly) denies to va_app. It therefore uses the SYSTEM pool
// (the va_worker login, which inherits va_system), never the app pool. See docs/DATA-MODEL.md §3.
// Used ONLY by Better Auth.
import { getDatabase, type Database } from "@voidaccess/db";

export function getAuthDb(database: Database = getDatabase()) {
  const { systemPool, systemDb } = database;
  return { pool: systemPool, db: systemDb };
}
