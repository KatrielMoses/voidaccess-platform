import { sql } from "drizzle-orm";
import { getDatabase, type Database, type Tx } from "./client";

/**
 * Shared options for ledger/founding operations.
 * - `tx`: run inside the caller's transaction (e.g. reserve in the same tx as the investigation insert).
 * - `database`: inject a Database (tests); defaults to the DATABASE_URL singleton.
 * - `now`: clock injection for tests and cron.
 */
export interface Ctx {
  database?: Database;
  tx?: Tx;
  now?: Date;
}

export const nowOf = (ctx: Ctx) => ctx.now ?? new Date();

/** Run as the system role, reusing the caller's tx if one was passed. */
export function inSystem<T>(ctx: Ctx, reason: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (ctx.tx) return fn(ctx.tx);
  return (ctx.database ?? getDatabase()).withSystem(reason, fn);
}

export function inUser<T>(ctx: Ctx, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (ctx.tx) return fn(ctx.tx);
  return (ctx.database ?? getDatabase()).withUser(userId, fn);
}

export async function lockUserCredits(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"credits:" + userId}, 0))`);
}

export function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + n);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
