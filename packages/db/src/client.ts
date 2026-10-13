import { createHmac } from "node:crypto";
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
  /** The app pool: connects as va_app (RLS applies, no escalation possible). Used by `withUser`. */
  pool: pg.Pool;
  /** The system pool: connects as va_worker. Used by `withSystem` and Better Auth, never for user-facing queries. */
  systemPool: pg.Pool;
  db: Db;
  /** Drizzle on the system pool. Only for code that is allowed to bypass tenant RLS (Better Auth's adapter). */
  systemDb: Db;
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

export interface DatabaseOptions {
  /** `va_worker` connection string for withSystem. Required: there is no fallback to the app login. */
  systemUrl: string;
  /** Secret that signs the tenant context (see migration 0006); must equal the key installed in `app_ctx_key`. */
  contextKey: string;
  max?: number;
  systemMax?: number;
}

/** HMAC of a user id under the context key; `app_user_id()` recomputes it in the database. */
export function signUserContext(contextKey: string, userId: string): string {
  return createHmac("sha256", contextKey).update(userId.toLowerCase()).digest("hex");
}

export function createDatabase(url: string, opts: DatabaseOptions): Database {
  if (!opts.systemUrl) throw new Error("createDatabase: systemUrl (the va_worker connection) is required");
  if (!opts.contextKey) throw new Error("createDatabase: contextKey is required");
  const pool = new pg.Pool({ connectionString: url, max: opts.max ?? 10 });
  const db = drizzle(pool, { schema });
  const systemPool = new pg.Pool({ connectionString: opts.systemUrl, max: opts.systemMax ?? 10 });
  const systemDb = drizzle(systemPool, { schema });
  return {
    pool,
    db,
    systemPool,
    systemDb,
    async withUser(userId, fn) {
      if (!UUID_RE.test(userId)) throw new Error("withUser: userId must be a uuid");
      const sig = signUserContext(opts.contextKey, userId);
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.user_id', ${userId}, true), set_config('app.user_sig', ${sig}, true)`,
        );
        return fn(tx);
      });
    },
    async withSystem(reason, fn, o = {}) {
      if (!reason) throw new Error("withSystem requires a reason");
      return systemDb.transaction(async (tx) => {
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
    close: async () => {
      await Promise.all([pool.end(), systemPool.end()]);
    },
  };
}

let singleton: Database | undefined;
/** Context key used outside production when RLS_CONTEXT_KEY is unset; the local harness installs the same one. */
export const DEV_CONTEXT_KEY = "dev-only-rls-context-key-not-a-secret-0123456789";

/**
 * Default connections from the environment:
 *  - DATABASE_URL         the va_app login (RLS applies; never the owner, never va_worker)
 *  - DATABASE_URL_SYSTEM  the va_worker login, for withSystem and Better Auth
 *  - RLS_CONTEXT_KEY      signs the tenant context (production requires it)
 */
export function getDatabase(): Database {
  if (!singleton) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const systemUrl = process.env.DATABASE_URL_SYSTEM;
    if (!systemUrl) throw new Error("DATABASE_URL_SYSTEM is not set");
    const prod = process.env.NODE_ENV === "production";
    const contextKey = process.env.RLS_CONTEXT_KEY || (prod ? "" : DEV_CONTEXT_KEY);
    if (!contextKey) throw new Error("RLS_CONTEXT_KEY is not set");
    if (prod && contextKey.length < 32) throw new Error("RLS_CONTEXT_KEY must be at least 32 characters");
    singleton = createDatabase(url, { systemUrl, contextKey });
  }
  return singleton;
}

export async function healthCheck(): Promise<{ ok: boolean; db: "up" | "down" | "unconfigured" }> {
  if (!process.env.DATABASE_URL) return { ok: true, db: "unconfigured" };
  try {
    const d = getDatabase();
    await Promise.all([d.pool.query("select 1"), d.systemPool.query("select 1")]);
    return { ok: true, db: "up" };
  } catch {
    return { ok: false, db: "down" };
  }
}
