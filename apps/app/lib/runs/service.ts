/** Run lifecycle service: start, launch, cancel, rename, delete, read. All user paths go through withUser. */
import { and, count, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { DEPTHS, type Depth, type PlanId } from "@voidaccess/config";
import { creditLedger, getDatabase, investigations, reserve, runEvents, users } from "@voidaccess/db";
import { trackEvent } from "../analytics";
import { getEnv } from "../../env";
import { getLauncher } from "../launcher";
import {
  DAILY_RUN_CAP,
  MAX_CONCURRENT_RUNS,
  QUERY_MAX_LENGTH,
  QUERY_MIN_LENGTH,
  RUN_DEADLINE_MINUTES,
  SPEC_TOKEN_TTL_MINUTES,
  TITLE_MAX_LENGTH,
} from "../limits";
import { RunError } from "./errors";
import { hashSpecToken, mintSpecToken } from "./secrets";
import { ACTIVE_STATUSES, TERMINAL_STATUSES, isTerminalStatus, settleRun, type SettleResult } from "./settle";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);

export interface StartUser {
  id: string;
  emailVerified: boolean;
  status: string;
}

export interface StartResult {
  id: string;
  status: string;
  creditsCharged: number;
}

export function parseQuery(raw: unknown): string {
  const q = typeof raw === "string" ? raw.trim() : "";
  if (q.length < QUERY_MIN_LENGTH || q.length > QUERY_MAX_LENGTH)
    throw new RunError(
      "invalid_query",
      `Enter between ${QUERY_MIN_LENGTH} and ${QUERY_MAX_LENGTH} characters.`,
      {
        min: QUERY_MIN_LENGTH,
        max: QUERY_MAX_LENGTH,
      },
    );
  return q;
}

export function parseDepth(raw: unknown): Depth {
  if (typeof raw !== "string" || !Object.hasOwn(DEPTHS, raw) || !DEPTHS[raw as Depth].launched)
    throw new RunError("depth_unavailable", "That depth is not available.");
  return raw as Depth;
}

/**
 * Validate, then in ONE withUser transaction insert the investigation (`reserved`) and reserve the exact
 * config price. A failed check rolls the whole transaction back: no run, no ledger row, never a negative
 * balance. The launcher is invoked OUTSIDE that transaction (launchRun).
 */
export async function startInvestigation(
  user: StartUser,
  input: { query: unknown; depth: unknown },
): Promise<StartResult> {
  const query = parseQuery(input.query);
  const depth = parseDepth(input.depth);
  if (user.status !== "active") throw new RunError("account_inactive", "This account is not active.");
  if (!user.emailVerified)
    throw new RunError("unverified_email", "Verify your email address before starting an investigation.");

  const db = getDatabase();
  const created = await db.withUser(user.id, async (tx) => {
    // Serialise this user's run creation so the concurrency and daily caps cannot be raced past.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"runs:" + user.id}, 0))`);
    const [row] = await tx
      .select({ plan: users.plan, status: users.status, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, user.id));
    // Authoritative values from the database, not the (possibly stale) session.
    if (!row || row.status !== "active")
      throw new RunError("account_inactive", "This account is not active.");
    if (!row.emailVerified)
      throw new RunError("unverified_email", "Verify your email address before starting an investigation.");

    const [active] = await tx
      .select({ n: count() })
      .from(investigations)
      .where(and(eq(investigations.userId, user.id), inArray(investigations.status, [...ACTIVE_STATUSES])));
    if ((active?.n ?? 0) >= MAX_CONCURRENT_RUNS)
      throw new RunError(
        "rate_limited_concurrent",
        `You can have ${MAX_CONCURRENT_RUNS} investigations running at once. Wait for one to finish or cancel it.`,
        { limit: MAX_CONCURRENT_RUNS },
      );
    const cap = DAILY_RUN_CAP[row.plan as PlanId];
    const since = new Date(Date.now() - 24 * 3_600_000);
    const [day] = await tx
      .select({ n: count() })
      .from(investigations)
      .where(and(eq(investigations.userId, user.id), gte(investigations.createdAt, since)));
    if ((day?.n ?? 0) >= cap)
      throw new RunError(
        "rate_limited_daily",
        `Daily limit of ${cap} investigations reached. Try again tomorrow.`,
        {
          limit: cap,
        },
      );
    const [total] = await tx
      .select({ n: count() })
      .from(investigations)
      .where(eq(investigations.userId, user.id));

    const [inv] = await tx
      .insert(investigations)
      .values({ userId: user.id, query, depth, status: "reserved" })
      .returning({ id: investigations.id });
    const r = await reserve(user.id, inv!.id, depth, { tx });
    if (!r.ok) {
      if (r.reason === "insufficient_credits")
        throw new RunError(
          "insufficient_credits",
          `This needs ${r.needed} credits and you have ${r.balance}.`,
          { balance: r.balance, needed: r.needed },
        );
      throw new RunError("depth_unavailable", "That depth is not available on your plan.");
    }
    return { id: inv!.id, charged: r.charged, first: (total?.n ?? 0) === 0 };
  });

  if (created.first)
    await trackEvent("first_investigation_started", {
      userId: user.id,
      props: { investigationId: created.id, depth },
    });
  const status = await launchRun(created.id);
  return { id: created.id, status, creditsCharged: created.charged };
}

/**
 * reserved -> launching, mint the single-use spec token (only its sha256 is stored), call the launcher.
 * On launcher failure the run is failed and refunded in full. Returns the resulting status.
 */
export async function launchRun(runId: string): Promise<string> {
  const token = mintSpecToken();
  const expires = new Date(Date.now() + SPEC_TOKEN_TTL_MINUTES * 60_000);
  const moved = await getDatabase().withSystem("runs.launch", async (tx) => {
    const rows = await tx
      .update(investigations)
      .set({ status: "launching", specTokenHash: hashSpecToken(token), specTokenExpiresAt: expires })
      .where(and(eq(investigations.id, runId), eq(investigations.status, "reserved")))
      .returning({ id: investigations.id });
    return rows.length > 0;
  });
  if (!moved) return (await currentStatus(runId)) ?? "missing";

  const base = getEnv().APP_URL.replace(/\/$/, "");
  const specUrl = `${base}/api/engine/runs/${runId}/spec?t=${encodeURIComponent(token)}`;
  const deadlineAt = new Date(Date.now() + RUN_DEADLINE_MINUTES * 60_000).toISOString();
  const launcher = getLauncher();
  try {
    const { executionId } = await launcher.launch({ runId, specUrl, deadlineAt });
    const cancelRequested = await getDatabase().withSystem(
      "runs.launch",
      async (tx) => {
        const [r] = await tx
          .update(investigations)
          .set({ executionId })
          .where(eq(investigations.id, runId))
          .returning({ cancelRequestedAt: investigations.cancelRequestedAt });
        return r?.cancelRequestedAt != null;
      },
      { audit: false },
    );
    // A cancel that arrived before we knew the execution id.
    if (cancelRequested) await safeCancel(executionId);
  } catch (e) {
    console.error(`launch failed for ${runId}:`, e instanceof Error ? e.message : e);
    await settleRun(runId, { kind: "failed", reason: "launcher_failure" }, { reason: "runs.launch" });
  }
  return (await currentStatus(runId)) ?? "missing";
}

async function currentStatus(runId: string): Promise<string | undefined> {
  const [r] = await getDatabase().withSystem(
    "runs.launch",
    (tx) => tx.select({ s: investigations.status }).from(investigations).where(eq(investigations.id, runId)),
    { audit: false },
  );
  return r?.s;
}

export async function safeCancel(executionId: string | null): Promise<void> {
  if (!executionId) return;
  try {
    await getLauncher().cancel(executionId);
  } catch (e) {
    console.error("launcher cancel failed:", e instanceof Error ? e.message : e);
  }
}

/**
 * Cancel. `reserved` runs (engine never started) settle immediately with a full refund; launching/running
 * runs get cancelRequestedAt + launcher.cancel and settle when the engine's `cancelled` event arrives, or via
 * the watchdog after CANCEL_SETTLE_TIMEOUT_SECONDS. Ingesting and terminal runs cannot be cancelled.
 */
export async function cancelInvestigation(userId: string, id: string) {
  const db = getDatabase();
  const run = await db.withUser(userId, async (tx) => {
    const [r] = await tx.select().from(investigations).where(eq(investigations.id, id)).for("update");
    if (!r) return null;
    if (r.status === "ingesting" || isTerminalStatus(r.status)) return r;
    if (!r.cancelRequestedAt)
      await tx.update(investigations).set({ cancelRequestedAt: new Date() }).where(eq(investigations.id, id));
    return r;
  });
  if (!run) throw new RunError("not_found", "Investigation not found.");
  if (run.status === "ingesting" || isTerminalStatus(run.status))
    throw new RunError("not_cancellable", "This investigation has already finished.", { status: run.status });

  if (run.status === "reserved") {
    const s = await settleRun(id, { kind: "cancelled", stagesCompleted: [] }, { from: ["reserved"] });
    if (s.settled) return { status: s.status, refunded: s.refunded };
  }
  await safeCancel(run.executionId);
  return { status: run.status, cancelRequested: true as const };
}

export async function renameInvestigation(userId: string, id: string, rawTitle: unknown) {
  if (rawTitle !== null && typeof rawTitle !== "string")
    throw new RunError("invalid_body", "title must be a string or null");
  const title = rawTitle === null ? null : rawTitle.trim() || null;
  if (title && title.length > TITLE_MAX_LENGTH)
    throw new RunError("invalid_body", `Title can be at most ${TITLE_MAX_LENGTH} characters.`);
  const rows = await getDatabase().withUser(userId, (tx) =>
    tx
      .update(investigations)
      .set({ title })
      .where(eq(investigations.id, id))
      .returning({ id: investigations.id, title: investigations.title }),
  );
  if (rows.length === 0) throw new RunError("not_found", "Investigation not found.");
  return rows[0]!;
}

/**
 * Delete an investigation. Snapshot rows (inv_*), run_events and run_costs go by ON DELETE CASCADE; ledger
 * rows keep the plain investigation_id (immutable history). Non-terminal runs must be cancelled first.
 */
export async function deleteInvestigation(userId: string, id: string): Promise<void> {
  await getDatabase().withUser(userId, async (tx) => {
    const [r] = await tx
      .select({ status: investigations.status })
      .from(investigations)
      .where(eq(investigations.id, id))
      .for("update");
    if (!r) throw new RunError("not_found", "Investigation not found.");
    if (!isTerminalStatus(r.status))
      throw new RunError("not_terminal", "Cancel this investigation before deleting it.", {
        status: r.status,
      });
    await tx.delete(investigations).where(eq(investigations.id, id));
  });
}

export async function getInvestigation(userId: string, id: string) {
  return getDatabase().withUser(userId, async (tx) => {
    const [r] = await tx.select().from(investigations).where(eq(investigations.id, id));
    if (!r) return null;
    const ledger = await tx
      .select({ reason: creditLedger.reason, amount: creditLedger.amount })
      .from(creditLedger)
      .where(and(eq(creditLedger.investigationId, id), inArray(creditLedger.reason, ["reserve", "refund"])));
    const reserved = -ledger.filter((l) => l.reason === "reserve").reduce((a, l) => a + l.amount, 0);
    const refunded = ledger.filter((l) => l.reason === "refund").reduce((a, l) => a + l.amount, 0);
    const events = await tx
      .select({ type: runEvents.type, stage: runEvents.stage, counts: runEvents.counts, seq: runEvents.seq })
      .from(runEvents)
      .where(eq(runEvents.runId, id))
      .orderBy(runEvents.seq);
    const stagesCompleted = [...new Set(events.filter((e) => e.type === "stage_end").map((e) => e.stage!))];
    const stageEvents = events.filter((e) => e.type === "stage" || e.type === "stage_end");
    const currentStage = isTerminalStatus(r.status) ? null : (stageEvents.at(-1)?.stage ?? null);
    const counts = [...events].reverse().find((e) => e.counts)?.counts ?? null;
    return {
      id: r.id,
      title: r.title ?? r.query,
      customTitle: r.title,
      query: r.query,
      depth: r.depth,
      status: r.status,
      failureReason: r.failureReason,
      refinedQueries: r.refinedQueries,
      createdAt: r.createdAt,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      cancelRequested: r.cancelRequestedAt != null,
      creditsReserved: reserved,
      creditsRefunded: refunded,
      creditsNet: reserved - refunded,
      stagesCompleted,
      currentStage,
      counts,
      eventCount: events.length,
    };
  });
}

export interface ListOptions {
  q?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export async function listInvestigations(userId: string, opts: ListOptions = {}) {
  const limit = Math.min(100, Math.max(1, Math.floor(opts.limit ?? 20)));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));
  const conds = [];
  if (opts.status) {
    const all: readonly string[] = [...ACTIVE_STATUSES, ...TERMINAL_STATUSES];
    if (opts.status === "active") conds.push(inArray(investigations.status, [...ACTIVE_STATUSES]));
    else if (all.includes(opts.status))
      conds.push(eq(investigations.status, opts.status as (typeof ACTIVE_STATUSES)[number]));
    else throw new RunError("invalid_body", "Unknown status filter.");
  }
  const q = opts.q?.trim();
  if (q) {
    const pat = `%${escapeLike(q)}%`;
    conds.push(or(ilike(investigations.title, pat), ilike(investigations.query, pat)));
  }
  const where = conds.length ? and(...conds) : undefined;
  return getDatabase().withUser(userId, async (tx) => {
    const rows = await tx
      .select({
        id: investigations.id,
        title: investigations.title,
        query: investigations.query,
        depth: investigations.depth,
        status: investigations.status,
        creditsCharged: investigations.creditsCharged,
        createdAt: investigations.createdAt,
        completedAt: investigations.completedAt,
      })
      .from(investigations)
      .where(where)
      .orderBy(desc(investigations.createdAt), desc(investigations.id))
      .limit(limit)
      .offset(offset);
    const [t] = await tx.select({ n: count() }).from(investigations).where(where);
    return {
      items: rows.map((r) => ({ ...r, title: r.title ?? r.query })),
      total: t?.n ?? 0,
      limit,
      offset,
    };
  });
}

export type { SettleResult };
