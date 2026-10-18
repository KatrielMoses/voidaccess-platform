/**
 * Shared rate limiting (H1-2): counters live in Postgres so limits hold across Cloud Run instances, and every
 * request that hits a limit is recorded in `rate_limit_events` for the admin abuse queue.
 *  - auth paths: Better Auth's rate limiter, via a custom storage over the `rate_limits` table
 *  - run creation: the concurrency and daily caps are DB counts under an advisory lock (lib/runs/service.ts);
 *    a refusal is recorded here
 * Raw IPs are never stored: only a keyed hash (HMAC key derived from BETTER_AUTH_SECRET), good for "same
 * address" correlation in the abuse queue and nothing else.
 */
import { createHmac } from "node:crypto";
import type { BetterAuthOptions } from "better-auth";
import { sql } from "drizzle-orm";
import { getDatabase, rateLimitEvents, type Database } from "@voidaccess/db";

type RateLimitStorage = NonNullable<NonNullable<BetterAuthOptions["rateLimit"]>["customStorage"]>;

export type RateLimitSource = "auth" | "run_create";

function ipHashKey(): string {
  const base = process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-dev-only-secret-dev-only-secret";
  return createHmac("sha256", base).update("rate-limit-events:ip-hash:v1").digest("hex");
}

/** Keyed hash of an IP address (first 32 hex chars). Never log or store the address itself. */
export function hashIp(ip: string): string {
  return createHmac("sha256", ipHashKey()).update(ip).digest("hex").slice(0, 32);
}

/** Keyed hash of a normalised email address, for per-address limits. Never store or log the address itself. */
export function hashEmail(email: string): string {
  const key = createHmac("sha256", ipHashKey()).update("rate-limit:email-hash:v1").digest("hex");
  return createHmac("sha256", key).update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
}

/**
 * The client address for abuse correlation only (never for enforcement). A single X-Forwarded-For value is taken
 * as is; with several, the LAST one, which the Google front end appended and the client cannot forge.
 */
export function clientIp(headers: Headers): string | undefined {
  const xff = headers.get("x-forwarded-for");
  if (!xff) return undefined;
  const parts = xff
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.at(-1);
}

export async function recordRateLimitEvent(
  e: { source: RateLimitSource; path: string; userId?: string | null; ip?: string | null },
  database: Database = getDatabase(),
): Promise<void> {
  try {
    await database.withSystem(
      "rate-limit.event",
      (tx) =>
        tx.insert(rateLimitEvents).values({
          source: e.source,
          path: e.path,
          userId: e.userId ?? null,
          ipHash: e.ip ? hashIp(e.ip) : null,
        }),
      { audit: false },
    );
  } catch (err) {
    // recording is best-effort: it must never turn a refused request into a 500
    console.error("rate_limit_events insert failed:", err instanceof Error ? err.message : err);
  }
}

/** Better Auth keys are `<ip>|<path>`. */
export function splitKey(key: string): { ip: string | null; path: string } {
  const i = key.lastIndexOf("|");
  if (i < 0) return { ip: null, path: key };
  const ip = key.slice(0, i);
  return { ip: ip && ip !== "no-trusted-ip" ? ip : null, path: key.slice(i + 1) };
}

const PRUNE_ONE_IN = 200;
const PRUNE_OLDER_THAN_MS = 10 * 60_000;

/**
 * One statement records the request and decides: it inserts the first hit, resets an elapsed window, or counts
 * within the window while below `max`; at the limit the conflicting UPDATE is filtered out and nothing is
 * returned (= refused, and a refused request does not extend the window). The clock is the database's, so
 * instances with skewed clocks agree.
 */
export function createAuthRateLimitStorage(database: () => Database = getDatabase): RateLimitStorage {
  return {
    async consume(key, rule) {
      const windowMs = rule.window * 1000;
      const db = database();
      const res = await db.withSystem(
        "rate-limit.auth",
        async (tx) => {
          const hit = await tx.execute<{ count: number }>(sql`
            with t as (select (extract(epoch from clock_timestamp()) * 1000)::bigint as now)
            insert into rate_limits (key, count, last_request)
            select ${key}, 1, t.now from t
            on conflict (key) do update set
              count = case when rate_limits.last_request <= (select now from t) - ${windowMs}::bigint
                           then 1 else rate_limits.count + 1 end,
              last_request = (select now from t)
            where rate_limits.last_request <= (select now from t) - ${windowMs}::bigint
               or rate_limits.count < ${rule.max}::int
            returning count`);
          if (hit.rows.length > 0) return { allowed: true as const };
          const row = await tx.execute<{ retry: number }>(sql`
            select greatest(1, ceil((last_request + ${windowMs}::bigint
              - (extract(epoch from clock_timestamp()) * 1000)::bigint) / 1000.0))::int as retry
            from rate_limits where key = ${key}`);
          return { allowed: false as const, retryAfter: row.rows[0]?.retry ?? rule.window };
        },
        { audit: false },
      );
      if (!res.allowed) {
        const { ip, path } = splitKey(key);
        await recordRateLimitEvent({ source: "auth", path, ip }, db);
        return { allowed: false, retryAfter: res.retryAfter };
      }
      if (Math.floor(Math.random() * PRUNE_ONE_IN) === 0) {
        void db
          .withSystem(
            "rate-limit.prune",
            (tx) =>
              tx.execute(sql`delete from rate_limits where last_request <
                (extract(epoch from clock_timestamp()) * 1000)::bigint - ${PRUNE_OLDER_THAN_MS}::bigint`),
            { audit: false },
          )
          .catch(() => {});
      }
      return { allowed: true, retryAfter: null };
    },
  };
}
