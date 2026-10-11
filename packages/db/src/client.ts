import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Anything you can run queries on: the pool-backed db or a transaction. */
export type Executor = Db | Tx;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Database {
  pool: pg.Pool;
  db: Db;
  /** Run `fn` in a transaction where Postgres RLS scopes every query to `userId`. The ONLY way to run tenant queries. */
  withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /**
   * Run `fn` as the system role (bypasses tenant RLS): webhooks, cron, admin, ingest.
   * Greppable by name and audited: every call writes an audit_log row carrying `reason`
   * unless `{ audit: false }` is passed explicitly (high-frequency, low-risk paths only).
   */
  withSystem<T>(
    reason: string,
    fn: (tx: Tx) => Promise<T>,
    opts?: { audit?: boolean; actor?: string },
  ): Promise<T>;
  close(): Promise<void>;
}

export function createDatabase(url: string, opts: { max?: number } = {}): Database {
  const pool = new pg.Pool({ connectionString: url, max: opts.max ?? 10 });
  const db = drizzle(pool, { schema });
  return {
    pool,
    db,
    async withUser(userId, fn) {
      if (!UUID_RE.test(userId)) throw new Error("withUser: userId must be a uuid");
      return db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
        return fn(tx);
      });
    },
    async withSystem(reason, fn, o = {}) {
      if (!reason) throw new Error("withSystem requires a reason");
      return db.transaction(async (tx) => {
        await tx.execute(sql`set local role va_system`);
        if (o.audit !== false) {
          await tx.insert(schema.auditLog).values({
            actor: o.actor ?? "system",
            action: "system_tx",
            meta: { reason },
          });
        }
        return fn(tx);
      });
    },
    close: () => pool.end(),
  };
}

let singleton: Database | undefined;
/** Default connection from DATABASE_URL (must be the va_app role, never the owner). */
export function getDatabase(): Database {
  if (!singleton) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    singleton = createDatabase(url);
  }
  return singleton;
}

export async function healthCheck(): Promise<{ ok: boolean; db: "up" | "down" | "unconfigured" }> {
  if (!process.env.DATABASE_URL) return { ok: true, db: "unconfigured" };
  try {
    await getDatabase().pool.query("select 1");
    return { ok: true, db: "up" };
  } catch {
    return { ok: false, db: "down" };
  }
}
