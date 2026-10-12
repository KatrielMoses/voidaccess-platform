/**
 * Admin read models. All reads go through withSystem with a specific reason (the app role has no access to events,
 * run_costs, abuse_flags or other users' rows). Reads that expose users' query text or content also write an audit row.
 * Credential values are never selected: only display (masked) forms, counts and metadata.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { CREDIT_LIST_VALUE_USD, DEPTHS, FOUNDING, PLANS, type Depth } from "@voidaccess/config";
import {
  abuseFlags,
  auditLog,
  blockedEmailDomains,
  creditLedger,
  foundingNotices,
  foundingSeats,
  getDatabase,
  investigations,
  payments,
  paidMonthsInWindow,
  sessions,
  subscriptions,
  topupLots,
  users,
  type Database,
  type Tx,
} from "@voidaccess/db";
import { writeAudit } from "./audit";
import {
  ABUSE_BLOCKED_THRESHOLD,
  ABUSE_WINDOW_DAYS,
  AUDIT_ON_USER_DETAIL,
  COST_DEFAULT_DAYS,
  COST_MAX_DAYS,
  COST_WORST_RUNS,
  FIRST_INVESTIGATION_WINDOW_HOURS,
  INVESTIGATIONS_ON_USER_DETAIL,
  OVERVIEW_COHORT_WEEKS,
  OVERVIEW_RUN_DAYS,
  USERS_PAGE_SIZE,
} from "./constants";
import { AdminError } from "./errors";

type Opts = { database?: Database; now?: Date };
const dbOf = (o?: Opts) => o?.database ?? getDatabase();
const nowOf = (o?: Opts) => o?.now ?? new Date();
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
const DAY = 86_400_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const num = (v: unknown) => Number(v ?? 0);

/** What one credit is worth at the Pro plan's subscription rate (credits come ~2.2x cheaper than the top-up list value). */
export const PRO_USD_PER_CREDIT = PLANS.pro.monthlyUsd / PLANS.pro.monthlyCredits;

// ---- overview -------------------------------------------------------------------------------------------------------

export interface CohortRow {
  weekStart: string;
  verified: number;
  matured: number;
  converted: number;
  rate: number | null;
}
export interface Overview {
  signups: { d7: number; d30: number; verifiedD7: number; verifiedD30: number };
  cohorts: CohortRow[];
  runsByDay: Array<{ day: string; depth: string; status: string; n: number }>;
  failureReasons: Array<{ reason: string; n: number }>;
  credits: { granted: number; reserved: number; refunded: number; spentNet: number; expired: number };
  subscriptions: {
    byPlan: Array<{ plan: string; active: number; pastDue: number; cancelling: number; founding: number }>;
    mrrUsd: number;
  };
  founding: { held: number; available: number };
}

/** Monthly recurring revenue of one active subscription, in USD, from config (founding seats pay the founding price). */
export function monthlyUsdOf(
  plan: "free" | "pro" | "pro_plus",
  interval: "month" | "year",
  founding: boolean,
): number {
  if (plan === "free") return 0;
  if (founding) return FOUNDING.monthlyUsd;
  const p = PLANS[plan];
  return interval === "year" ? (p.annualUsd ?? p.monthlyUsd * 12) / 12 : p.monthlyUsd;
}

export async function getOverview(o?: Opts): Promise<Overview> {
  const now = nowOf(o);
  return dbOf(o).withSystem(
    "admin.overview",
    async (tx) => {
      const since = (days: number) => ts(new Date(now.getTime() - days * DAY));
      const [s] = (
        await tx.execute(sql`SELECT
          count(*) FILTER (WHERE created_at >= ${since(7)})::int AS d7,
          count(*) FILTER (WHERE created_at >= ${since(30)})::int AS d30,
          count(*) FILTER (WHERE created_at >= ${since(7)} AND email_verified)::int AS v7,
          count(*) FILTER (WHERE created_at >= ${since(30)} AND email_verified)::int AS v30
          FROM users`)
      ).rows as Array<Record<string, number>>;

      // The #1 metric, by signup week: of verified signups whose 24 h window has closed, how many completed an investigation inside it.
      const win = sql.raw(`interval '${FIRST_INVESTIGATION_WINDOW_HOURS} hours'`);
      const closed = sql`u.created_at <= ${ts(new Date(now.getTime() - FIRST_INVESTIGATION_WINDOW_HOURS * 3_600_000))}`;
      const cohortRows = (
        await tx.execute(sql`SELECT date_trunc('week', u.created_at AT TIME ZONE 'UTC')::date::text AS week,
          count(*) FILTER (WHERE u.email_verified)::int AS verified,
          count(*) FILTER (WHERE u.email_verified AND ${closed})::int AS matured,
          count(*) FILTER (WHERE u.email_verified AND ${closed} AND EXISTS (
            SELECT 1 FROM investigations i WHERE i.user_id = u.id AND i.status = 'completed'
              AND i.completed_at <= u.created_at + ${win}))::int AS converted
          FROM users u WHERE u.created_at >= ${since(OVERVIEW_COHORT_WEEKS * 7)}
          GROUP BY 1 ORDER BY 1 DESC`)
      ).rows as Array<{ week: string; verified: number; matured: number; converted: number }>;

      const runsByDay = (
        await tx.execute(sql`SELECT (created_at AT TIME ZONE 'UTC')::date::text AS day, depth::text AS depth,
          status::text AS status, count(*)::int AS n FROM investigations
          WHERE created_at >= ${since(OVERVIEW_RUN_DAYS)} GROUP BY 1, 2, 3 ORDER BY 1 DESC, 2, 3`)
      ).rows as Overview["runsByDay"];

      const failureReasons = (
        await tx.execute(sql`SELECT coalesce(failure_reason, 'unknown') AS reason, count(*)::int AS n
          FROM investigations WHERE status = 'failed' AND created_at >= ${since(30)}
          GROUP BY 1 ORDER BY 2 DESC`)
      ).rows as Overview["failureReasons"];

      const [c] = (
        await tx.execute(sql`SELECT
          coalesce(sum(amount) FILTER (WHERE reason IN ('grant','topup','bonus','admin')), 0)::int AS granted,
          coalesce(-sum(amount) FILTER (WHERE reason = 'reserve'), 0)::int AS reserved,
          coalesce(sum(amount) FILTER (WHERE reason = 'refund'), 0)::int AS refunded,
          coalesce(-sum(amount) FILTER (WHERE reason = 'expiry'), 0)::int AS expired
          FROM credit_ledger WHERE created_at >= ${since(30)}`)
      ).rows as Array<Record<string, number>>;

      const subs = await tx
        .select({
          plan: subscriptions.plan,
          interval: subscriptions.interval,
          status: subscriptions.status,
          founding: subscriptions.isFounding,
          cancelAt: subscriptions.cancelAt,
        })
        .from(subscriptions)
        .where(inArray(subscriptions.status, ["active", "past_due"]));
      const byPlan = new Map<string, Overview["subscriptions"]["byPlan"][number]>();
      let mrr = 0;
      for (const r of subs) {
        const row = byPlan.get(r.plan) ?? { plan: r.plan, active: 0, pastDue: 0, cancelling: 0, founding: 0 };
        if (r.status === "active") {
          row.active++;
          mrr += monthlyUsdOf(r.plan, r.interval, r.founding);
          if (r.cancelAt) row.cancelling++;
          if (r.founding) row.founding++;
        } else row.pastDue++;
        byPlan.set(r.plan, row);
      }

      const [f] = (
        await tx.execute(sql`SELECT count(*) FILTER (WHERE holder_user_id IS NOT NULL)::int AS held,
          count(*) FILTER (WHERE holder_user_id IS NULL)::int AS available FROM founding_seats`)
      ).rows as Array<{ held: number; available: number }>;

      return {
        signups: { d7: num(s?.d7), d30: num(s?.d30), verifiedD7: num(s?.v7), verifiedD30: num(s?.v30) },
        cohorts: cohortRows.map((r) => ({
          weekStart: r.week,
          verified: num(r.verified),
          matured: num(r.matured),
          converted: num(r.converted),
          rate: num(r.matured) > 0 ? num(r.converted) / num(r.matured) : null,
        })),
        runsByDay,
        failureReasons,
        credits: {
          granted: num(c?.granted),
          reserved: num(c?.reserved),
          refunded: num(c?.refunded),
          spentNet: num(c?.reserved) - num(c?.refunded),
          expired: num(c?.expired),
        },
        subscriptions: { byPlan: [...byPlan.values()], mrrUsd: Math.round(mrr * 100) / 100 },
        founding: { held: num(f?.held), available: num(f?.available) },
      };
    },
    { audit: false },
  );
}

// ---- users ----------------------------------------------------------------------------------------------------------

export interface UserListRow {
  id: string;
  email: string;
  name: string;
  plan: string;
  status: string;
  role: string;
  emailVerified: boolean;
  createdAt: Date;
  investigations: number;
  credits: number;
}

/** Search by email substring or exact id. No user content is shown here, so it isn't an audited read. */
export async function searchUsers(
  q: string,
  page: number,
  o?: Opts,
): Promise<{ rows: UserListRow[]; hasMore: boolean }> {
  const term = q.trim().slice(0, 200);
  const offset = Math.max(0, Math.floor(page)) * USERS_PAGE_SIZE;
  const where = !term
    ? sql`true`
    : UUID_RE.test(term)
      ? sql`u.id = ${term}::uuid`
      : sql`u.email ilike ${"%" + likeEscape(term) + "%"}`;
  const rows = await dbOf(o).withSystem(
    "admin.users.search",
    async (tx) =>
      (
        await tx.execute(sql`SELECT u.id, u.email, u.name, u.plan::text AS plan, u.status::text AS status,
          u.role::text AS role, u.email_verified, u.created_at,
          (SELECT count(*) FROM investigations i WHERE i.user_id = u.id)::int AS investigations,
          (coalesce((SELECT sum(amount) FROM credit_ledger l WHERE l.user_id = u.id AND l.bucket = 'grant'), 0)
           + coalesce((SELECT sum(remaining) FROM topup_lots t WHERE t.user_id = u.id AND t.expires_at > ${ts(nowOf(o))}), 0))::int AS credits
          FROM users u WHERE ${where} ORDER BY u.created_at DESC LIMIT ${USERS_PAGE_SIZE + 1} OFFSET ${offset}`)
      ).rows as Array<Record<string, unknown>>,
    { audit: false },
  );
  return {
    hasMore: rows.length > USERS_PAGE_SIZE,
    rows: rows.slice(0, USERS_PAGE_SIZE).map((r) => ({
      id: r.id as string,
      email: r.email as string,
      name: r.name as string,
      plan: r.plan as string,
      status: r.status as string,
      role: r.role as string,
      emailVerified: Boolean(r.email_verified),
      createdAt: new Date(r.created_at as string),
      investigations: num(r.investigations),
      credits: num(r.credits),
    })),
  };
}

export async function getUserDetail(adminId: string, userId: string, o?: Opts) {
  if (!UUID_RE.test(userId)) throw new AdminError(404, "User not found");
  const now = nowOf(o);
  return dbOf(o).withSystem(
    "admin.user.view",
    async (tx) => {
      const [u] = await tx.select().from(users).where(eq(users.id, userId));
      if (!u) throw new AdminError(404, "User not found");
      // reading someone's queries is an audited read
      await writeAudit(tx, {
        actor: adminId,
        action: "admin.user.view",
        target: userId,
        meta: { targetUserId: userId },
      });

      const [grant] = await tx
        .select({ n: sql<number>`coalesce(sum(${creditLedger.amount}), 0)::int` })
        .from(creditLedger)
        .where(and(eq(creditLedger.userId, userId), eq(creditLedger.bucket, "grant")));
      const lots = await tx
        .select({
          id: topupLots.id,
          remaining: topupLots.remaining,
          initial: topupLots.creditsInitial,
          expiresAt: topupLots.expiresAt,
          ref: topupLots.paymentRef,
        })
        .from(topupLots)
        .where(eq(topupLots.userId, userId))
        .orderBy(desc(topupLots.purchasedAt));
      const invs = await tx
        .select({
          id: investigations.id,
          query: investigations.query,
          status: investigations.status,
          depth: investigations.depth,
          credits: investigations.creditsCharged,
          failureReason: investigations.failureReason,
          createdAt: investigations.createdAt,
        })
        .from(investigations)
        .where(eq(investigations.userId, userId))
        .orderBy(desc(investigations.createdAt))
        .limit(INVESTIGATIONS_ON_USER_DETAIL);
      const pays = await tx
        .select({
          id: payments.id,
          kind: payments.kind,
          amountCents: payments.amountCents,
          currency: payments.currency,
          paidAt: payments.paidAt,
        })
        .from(payments)
        .where(eq(payments.userId, userId))
        .orderBy(desc(payments.paidAt))
        .limit(25);
      const subs = await tx
        .select({
          plan: subscriptions.plan,
          interval: subscriptions.interval,
          status: subscriptions.status,
          founding: subscriptions.isFounding,
          periodEnd: subscriptions.currentPeriodEnd,
          cancelAt: subscriptions.cancelAt,
        })
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId))
        .orderBy(desc(subscriptions.createdAt));
      const flags = await tx
        .select({
          id: abuseFlags.id,
          kind: abuseFlags.kind,
          status: abuseFlags.status,
          detail: abuseFlags.detail,
          createdAt: abuseFlags.createdAt,
        })
        .from(abuseFlags)
        .where(eq(abuseFlags.userId, userId))
        .orderBy(desc(abuseFlags.createdAt))
        .limit(25);
      const trail = await tx
        .select({
          id: auditLog.id,
          actor: auditLog.actor,
          action: auditLog.action,
          at: auditLog.at,
          meta: auditLog.meta,
        })
        .from(auditLog)
        .where(
          and(
            sql`(${auditLog.target} = ${userId} OR ${auditLog.meta}->>'targetUserId' = ${userId})`,
            sql`${auditLog.action} <> 'system_tx'`,
          ),
        )
        .orderBy(desc(auditLog.at))
        .limit(AUDIT_ON_USER_DETAIL);
      const [sess] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(sessions)
        .where(and(eq(sessions.userId, userId), sql`${sessions.expiresAt} > ${ts(now)}`));
      const [seat] = await tx.select().from(foundingSeats).where(eq(foundingSeats.holderUserId, userId));
      return {
        user: u,
        credits: {
          grant: Math.max(0, grant?.n ?? 0),
          topup: lots.filter((l) => l.expiresAt > now).reduce((a, l) => a + l.remaining, 0),
          lots,
        },
        investigations: invs,
        payments: pays,
        subscriptions: subs,
        flags,
        trail,
        activeSessions: sess?.n ?? 0,
        foundingSeat: seat?.seatNo ?? null,
      };
    },
    { actor: adminId },
  );
}

// ---- abuse queue ----------------------------------------------------------------------------------------------------

export interface AbuseQueue {
  blockedRuns: Array<{ id: string; userId: string; email: string; query: string; createdAt: Date }>;
  repeatUsers: Array<{ userId: string; email: string; blocked: number; lastAt: Date }>;
  flags: Array<{
    id: string;
    userId: string | null;
    email: string | null;
    kind: string;
    detail: Record<string, unknown>;
    createdAt: Date;
  }>;
  rateLimits: {
    available: boolean;
    rows: Array<{ userId: string; email: string | null; hits: number; lastAt: Date }>;
  };
}

/**
 * Sources: (1) investigations that failed with blocked_query and have no review yet, (2) users with at least
 * ABUSE_BLOCKED_THRESHOLD of them in ABUSE_WINDOW_DAYS and no review since their latest, (3) open abuse_flags rows
 * (P5 refunds/disputes, founding-claim races, anything written by hand), (4) per-account rate-limit hits, read from
 * H1's `rate_limit_hits` table when it exists (columns user_id, created_at), otherwise reported as unavailable.
 */
export async function getAbuseQueue(adminId: string, o?: Opts): Promise<AbuseQueue> {
  const now = nowOf(o);
  const windowStart = ts(new Date(now.getTime() - ABUSE_WINDOW_DAYS * DAY));
  return dbOf(o).withSystem(
    "admin.abuse.queue",
    async (tx) => {
      // the queue shows users' query text: an audited read
      await writeAudit(tx, { actor: adminId, action: "admin.abuse.view" });
      const blockedRuns = (
        await tx.execute(sql`SELECT i.id, i.user_id, u.email, i.query, i.created_at FROM investigations i
          JOIN users u ON u.id = i.user_id
          WHERE i.failure_reason = 'blocked_query'
            AND NOT EXISTS (SELECT 1 FROM abuse_flags f WHERE f.investigation_id = i.id AND f.kind = 'blocked_query' AND f.status <> 'open')
          ORDER BY i.created_at DESC LIMIT 200`)
      ).rows as Array<Record<string, string>>;
      const repeat = (
        await tx.execute(sql`SELECT i.user_id, u.email, count(*)::int AS blocked, max(i.created_at) AS last_at
          FROM investigations i JOIN users u ON u.id = i.user_id
          WHERE i.failure_reason = 'blocked_query' AND i.created_at >= ${windowStart}
          GROUP BY i.user_id, u.email
          HAVING count(*) >= ${ABUSE_BLOCKED_THRESHOLD}
            AND NOT EXISTS (SELECT 1 FROM abuse_flags f WHERE f.user_id = i.user_id AND f.kind = 'repeated_blocked'
                            AND f.status <> 'open' AND f.created_at >= max(i.created_at))
          ORDER BY max(i.created_at) DESC LIMIT 100`)
      ).rows as Array<Record<string, string | number>>;
      const flagRows = (
        await tx.execute(sql`SELECT f.id, f.user_id, u.email, f.kind, f.detail, f.created_at FROM abuse_flags f
          LEFT JOIN users u ON u.id = f.user_id WHERE f.status = 'open' ORDER BY f.created_at DESC LIMIT 200`)
      ).rows as Array<Record<string, unknown>>;

      let rateLimits: AbuseQueue["rateLimits"] = { available: false, rows: [] };
      const exists = (await tx.execute(sql`SELECT to_regclass('public.rate_limit_hits') IS NOT NULL AS ok`))
        .rows[0] as { ok: boolean } | undefined;
      if (exists?.ok) {
        // a savepoint: if H1's columns differ from what we read, the queue still loads
        try {
          const rows = await tx.transaction(
            async (sp) =>
              (
                await sp.execute(sql`SELECT h.user_id, u.email, count(*)::int AS hits, max(h.created_at) AS last_at
                FROM rate_limit_hits h LEFT JOIN users u ON u.id = h.user_id
                WHERE h.user_id IS NOT NULL AND h.created_at >= ${windowStart}
                GROUP BY h.user_id, u.email ORDER BY hits DESC LIMIT 100`)
              ).rows,
          );
          rateLimits = {
            available: true,
            rows: (rows as Array<Record<string, unknown>>).map((r) => ({
              userId: r.user_id as string,
              email: (r.email as string | null) ?? null,
              hits: num(r.hits),
              lastAt: new Date(r.last_at as string),
            })),
          };
        } catch {
          rateLimits = { available: false, rows: [] };
        }
      }
      return {
        blockedRuns: blockedRuns.map((r) => ({
          id: r.id!,
          userId: r.user_id!,
          email: r.email!,
          query: r.query!,
          createdAt: new Date(r.created_at!),
        })),
        repeatUsers: repeat.map((r) => ({
          userId: r.user_id as string,
          email: r.email as string,
          blocked: num(r.blocked),
          lastAt: new Date(r.last_at as string),
        })),
        flags: flagRows.map((r) => ({
          id: r.id as string,
          userId: (r.user_id as string | null) ?? null,
          email: (r.email as string | null) ?? null,
          kind: r.kind as string,
          detail: (r.detail as Record<string, unknown>) ?? {},
          createdAt: new Date(r.created_at as string),
        })),
        rateLimits,
      };
    },
    { actor: adminId },
  );
}

// ---- costs ----------------------------------------------------------------------------------------------------------

export interface CostRun {
  id: string;
  depth: string;
  status: string;
  failureReason: string | null;
  at: Date;
  creditsReserved: number;
  creditsNet: number;
  computeUsd: number;
  llmUsd: number;
  costUsd: number;
  durationMs: number;
  /** what we kept for the run, at the credit's list value (top-up price) and at the Pro subscription rate */
  revenueListUsd: number;
  revenueProUsd: number;
  /** (revenue - cost) / revenue; null when nothing was kept (a refunded run) */
  marginList: number | null;
  marginPro: number | null;
}
export interface CostGroup {
  key: string;
  runs: number;
  costP50: number;
  costP90: number;
  costMax: number;
  costTotal: number;
  creditsNetTotal: number;
  marginPro: number | null;
  /** only for per-depth groups: the price check, margin on the depth's list credits at p90 cost and the Pro rate */
  marginAtP90Pro: number | null;
}
export interface CostReport {
  days: number;
  depth: Depth | "all";
  runs: CostRun[];
  byDepth: CostGroup[];
  byDay: CostGroup[];
  worstByCost: CostRun[];
  worstByMargin: CostRun[];
  /** cost of runs that were refunded or failed: money spent for no revenue */
  wastedUsd: number;
}

const margin = (rev: number, cost: number) => (rev > 0 ? (rev - cost) / rev : null);

function toCostRun(r: Record<string, unknown>): CostRun {
  const creditsNet = num(r.credits_net);
  const computeUsd = num(r.compute_usd);
  const llmUsd = num(r.llm_usd);
  const costUsd = computeUsd + llmUsd;
  const revenueListUsd = creditsNet * CREDIT_LIST_VALUE_USD;
  const revenueProUsd = creditsNet * PRO_USD_PER_CREDIT;
  return {
    id: r.id as string,
    depth: r.depth as string,
    status: r.status as string,
    failureReason: (r.failure_reason as string | null) ?? null,
    at: new Date(r.at as string),
    creditsReserved: num(r.credits_reserved),
    creditsNet,
    computeUsd,
    llmUsd,
    costUsd,
    durationMs: num(r.duration_ms),
    revenueListUsd,
    revenueProUsd,
    marginList: margin(revenueListUsd, costUsd),
    marginPro: margin(revenueProUsd, costUsd),
  };
}

export const parseDays = (raw: unknown) => {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, COST_MAX_DAYS) : COST_DEFAULT_DAYS;
};
export const parseDepth = (raw: unknown): Depth | "all" =>
  typeof raw === "string" && raw in DEPTHS ? (raw as Depth) : "all";

async function costRuns(tx: Tx, since: Date, depth: Depth | "all", limit: number): Promise<CostRun[]> {
  const rows = (
    await tx.execute(sql`SELECT i.id, i.depth::text AS depth, i.status::text AS status, i.failure_reason,
      c.measured_at AS at, i.credits_charged AS credits_net,
      coalesce((SELECT -sum(l.amount) FROM credit_ledger l WHERE l.investigation_id = i.id AND l.reason = 'reserve'), 0)::int AS credits_reserved,
      c.compute_usd, c.llm_usd, c.duration_ms
      FROM run_costs c JOIN investigations i ON i.id = c.investigation_id
      WHERE c.measured_at >= ${ts(since)} ${depth === "all" ? sql`` : sql`AND i.depth = ${depth}::depth`}
      ORDER BY c.measured_at DESC LIMIT ${limit}`)
  ).rows as Array<Record<string, unknown>>;
  return rows.map(toCostRun);
}

/** Percentile over a sorted-or-not array, linear interpolation (same as percentile_cont). */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const v = [...values].sort((a, b) => a - b);
  const idx = (v.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return v[lo]! + (v[hi]! - v[lo]!) * (idx - lo);
}

function group(key: string, rows: CostRun[], depth?: Depth): CostGroup {
  const done = rows.filter((r) => r.status === "completed");
  const costs = done.map((r) => r.costUsd);
  const costTotal = rows.reduce((a, r) => a + r.costUsd, 0);
  const p90 = percentile(costs, 0.9);
  return {
    key,
    runs: rows.length,
    costP50: percentile(costs, 0.5),
    costP90: p90,
    costMax: costs.length ? Math.max(...costs) : 0,
    costTotal,
    creditsNetTotal: rows.reduce((a, r) => a + r.creditsNet, 0),
    marginPro: margin(
      rows.reduce((a, r) => a + r.revenueProUsd, 0),
      costTotal,
    ),
    marginAtP90Pro: depth && done.length ? margin(DEPTHS[depth].credits * PRO_USD_PER_CREDIT, p90) : null,
  };
}

/**
 * The cost-vs-charge view: per run, credits kept against measured compute + LLM cost (run_costs), with the margin at the
 * credit's list value and at the Pro subscription rate. Percentiles are over completed runs (what a price must cover);
 * refunded/failed runs are reported as `wastedUsd`. Contains no query text, so it isn't an audited content read.
 */
export async function getCostReport(
  opts: { days?: number; depth?: Depth | "all" } = {},
  o?: Opts,
): Promise<CostReport> {
  const days = opts.days ?? COST_DEFAULT_DAYS;
  const depth = opts.depth ?? "all";
  const since = new Date(nowOf(o).getTime() - days * DAY);
  const runs = await dbOf(o).withSystem("admin.costs", (tx) => costRuns(tx, since, depth, 5000), {
    audit: false,
  });
  const byDepthKeys = (Object.keys(DEPTHS) as Depth[]).filter((d) => runs.some((r) => r.depth === d));
  const dayKey = (r: CostRun) => r.at.toISOString().slice(0, 10);
  const dayKeys = [...new Set(runs.map(dayKey))].sort().reverse();
  const done = runs.filter((r) => r.status === "completed");
  return {
    days,
    depth,
    runs: runs.slice(0, 200),
    byDepth: byDepthKeys.map((d) =>
      group(
        d,
        runs.filter((r) => r.depth === d),
        d,
      ),
    ),
    byDay: dayKeys.map((k) =>
      group(
        k,
        runs.filter((r) => dayKey(r) === k),
      ),
    ),
    worstByCost: [...runs].sort((a, b) => b.costUsd - a.costUsd).slice(0, COST_WORST_RUNS),
    worstByMargin: done
      .filter((r) => r.marginPro !== null)
      .sort((a, b) => a.marginPro! - b.marginPro!)
      .slice(0, COST_WORST_RUNS),
    wastedUsd: runs.filter((r) => r.creditsNet === 0).reduce((a, r) => a + r.costUsd, 0),
  };
}

/** Every run in range for the CSV export (capped). */
export async function getCostRunsForExport(
  opts: { days?: number; depth?: Depth | "all" } = {},
  o?: Opts,
): Promise<CostRun[]> {
  const since = new Date(nowOf(o).getTime() - (opts.days ?? COST_DEFAULT_DAYS) * DAY);
  return dbOf(o).withSystem("admin.costs.export", (tx) => costRuns(tx, since, opts.depth ?? "all", 50_000), {
    audit: false,
  });
}

// ---- founding -------------------------------------------------------------------------------------------------------

export interface FoundingRow {
  seatNo: number;
  userId: string;
  email: string;
  claimedAt: Date | null;
  termStart: Date | null;
  anniversaryAt: Date | null;
  paidMonths12: number;
  lastInvestigationAt: Date | null;
  pendingNotice: { kind: string; scheduledFor: Date } | null;
}

export async function getFounding(o?: Opts) {
  const now = nowOf(o);
  return dbOf(o).withSystem(
    "admin.founding",
    async (tx) => {
      const held = await tx
        .select({
          seatNo: foundingSeats.seatNo,
          userId: foundingSeats.holderUserId,
          email: users.email,
          claimedAt: foundingSeats.claimedAt,
          termStart: foundingSeats.termStart,
          anniversaryAt: foundingSeats.anniversaryAt,
        })
        .from(foundingSeats)
        .innerJoin(users, eq(users.id, foundingSeats.holderUserId))
        .orderBy(foundingSeats.seatNo);
      const rows: FoundingRow[] = [];
      for (const h of held) {
        const userId = h.userId!;
        const [last] = await tx
          .select({ at: sql<Date | null>`max(${investigations.createdAt})` })
          .from(investigations)
          .where(eq(investigations.userId, userId));
        const [notice] = await tx
          .select({ kind: foundingNotices.kind, scheduledFor: foundingNotices.scheduledFor })
          .from(foundingNotices)
          .where(and(eq(foundingNotices.userId, userId), sql`${foundingNotices.sentAt} IS NULL`))
          .orderBy(foundingNotices.scheduledFor)
          .limit(1);
        rows.push({
          seatNo: h.seatNo,
          userId,
          email: h.email,
          claimedAt: h.claimedAt,
          termStart: h.termStart,
          anniversaryAt: h.anniversaryAt,
          paidMonths12: await paidMonthsInWindow(tx, userId, new Date(now.getTime() - 365 * DAY), now),
          lastInvestigationAt: last?.at ? new Date(last.at) : null,
          pendingNotice: notice ?? null,
        });
      }
      const released = await tx
        .select({
          seatNo: foundingSeats.seatNo,
          releasedAt: foundingSeats.releasedAt,
          reason: foundingSeats.releaseReason,
        })
        .from(foundingSeats)
        .where(and(sql`${foundingSeats.holderUserId} IS NULL`, sql`${foundingSeats.releasedAt} IS NOT NULL`))
        .orderBy(desc(foundingSeats.releasedAt))
        .limit(20);
      return { seats: FOUNDING.seats, held: rows, available: FOUNDING.seats - rows.length, released };
    },
    { audit: false },
  );
}

// ---- archive --------------------------------------------------------------------------------------------------------

export interface ArchiveHit {
  kind: "entity" | "source" | "page";
  /** what to pass to removeFromArchive as `key`: the row's uuid, or the page hash */
  key: string;
  label: string;
  tier: string | null;
  firstSeen: Date | null;
  lastSeen: Date | null;
  observations: number;
  tombstoned: boolean;
  detail: string;
}

const HASH_RE = /^[0-9a-f]{64}$/i;

/** Search entities by canonical/display value or id, sources by URL or host, pages by content hash. Archive data has no tenant link. */
export async function searchArchive(q: string, o?: Opts): Promise<ArchiveHit[]> {
  const term = q.trim().slice(0, 300);
  if (!term) return [];
  const like = "%" + likeEscape(term) + "%";
  return dbOf(o).withSystem(
    "admin.archive.search",
    async (tx) => {
      const ents = (
        await tx.execute(sql`SELECT e.id, e.type, e.display_value, e.canonical_value, e.tier::text AS tier, e.sensitive,
          e.first_seen, e.last_seen, e.observation_count, e.independent_source_count, e.tombstoned_at
          FROM archive_entities e
          WHERE ${UUID_RE.test(term) ? sql`e.id = ${term}::uuid OR ` : sql``}e.canonical_value ILIKE ${like} OR e.display_value ILIKE ${like}
          ORDER BY e.last_seen DESC LIMIT 50`)
      ).rows as Array<Record<string, unknown>>;
      const srcs = (
        await tx.execute(sql`SELECT s.id, s.url, s.host, s.first_seen, s.last_seen, s.content_hash, s.tombstoned_at,
          (SELECT count(*) FROM archive_observations o WHERE o.source_id = s.id)::int AS obs
          FROM archive_sources s
          WHERE ${UUID_RE.test(term) ? sql`s.id = ${term}::uuid OR ` : sql``}s.url ILIKE ${like} OR s.host ILIKE ${like}
            ${HASH_RE.test(term) ? sql`OR s.content_hash = ${term.toLowerCase()}` : sql``}
          ORDER BY s.last_seen DESC LIMIT 50`)
      ).rows as Array<Record<string, unknown>>;
      const hits: ArchiveHit[] = [];
      for (const e of ents)
        hits.push({
          kind: "entity",
          key: e.id as string,
          label: `${e.type}: ${(e.display_value as string) || (e.canonical_value as string) || "(fingerprint only)"}`,
          tier: e.tier as string,
          firstSeen: new Date(e.first_seen as string),
          lastSeen: new Date(e.last_seen as string),
          observations: num(e.observation_count),
          tombstoned: e.tombstoned_at !== null,
          detail: `${num(e.independent_source_count)} independent source(s)${e.sensitive ? ", sensitive (masked)" : ""}`,
        });
      for (const s of srcs) {
        hits.push({
          kind: "source",
          key: s.id as string,
          label: s.url as string,
          tier: null,
          firstSeen: new Date(s.first_seen as string),
          lastSeen: new Date(s.last_seen as string),
          observations: num(s.obs),
          tombstoned: s.tombstoned_at !== null,
          detail: `host ${s.host as string}`,
        });
        if (s.content_hash)
          hits.push({
            kind: "page",
            key: s.content_hash as string,
            label: `page ${(s.content_hash as string).slice(0, 12)}… (snapshot of ${s.url as string})`,
            tier: null,
            firstSeen: new Date(s.first_seen as string),
            lastSeen: new Date(s.last_seen as string),
            observations: num(s.obs),
            tombstoned: false,
            detail: "stored page text",
          });
      }
      return hits;
    },
    { audit: false },
  );
}

export async function listArchiveRemovals(o?: Opts) {
  return dbOf(o).withSystem(
    "admin.archive.removals",
    (tx) =>
      tx
        .select({
          id: auditLog.id,
          actor: auditLog.actor,
          target: auditLog.target,
          at: auditLog.at,
          meta: auditLog.meta,
        })
        .from(auditLog)
        .where(eq(auditLog.action, "archive.remove"))
        .orderBy(desc(auditLog.at))
        .limit(100),
    { audit: false },
  );
}

// ---- blocked domains ------------------------------------------------------------------------------------------------

export async function listBlockedDomains(o?: Opts) {
  return dbOf(o).withSystem(
    "admin.blocked_domains.list",
    (tx) => tx.select().from(blockedEmailDomains).orderBy(desc(blockedEmailDomains.createdAt)),
    { audit: false },
  );
}
