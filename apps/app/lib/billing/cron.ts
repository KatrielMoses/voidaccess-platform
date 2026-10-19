/**
 * Scheduled billing work. Every job is idempotent (ledger keys, unique notice rows, set-once timestamps), so a
 * re-run or an overlapping run changes nothing. Auth is the same as P2's watchdog (see lib/runs/cron-auth.ts).
 */
import { and, eq, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { FOUNDING, PLANS } from "@voidaccess/config";
import {
  addMonths,
  creditLedger,
  expireLots,
  foundingNotices,
  getDatabase,
  runFoundingChecks,
  subscriptions,
  users,
  type Database,
  type FoundingAction,
} from "@voidaccess/db";
import { sendEmail } from "@voidaccess/emails";
import { billingCopy as copy, fill } from "../../content/billing";
import { sendDueAlerts } from "./alerts";
import { grantPlanPeriod } from "./ledger-ext";
import { activeCatalogEntry } from "./catalog";
import { CARD_PROVIDERS, CRYPTO_PROVIDER_ID } from "./crypto/passes";
import { dateFmt, usd } from "./format";
import { billingUrl, userContact } from "./post-effects";
import { getBillingProvider, type BillingProvider } from "./provider";

type Deps = { database?: Database; provider?: BillingProvider };
const DAY = 86_400_000;

/** Daily: Free, annual-plan and crypto-pass monthly grants, ended subscriptions and passes, top-up expiry. */
export async function runGrants(now: Date, deps: Deps = {}) {
  const database = deps.database ?? getDatabase();
  const cutoff = addMonths(now, -1);

  // Free users, annual subscribers (their provider event only fires yearly) and crypto passes (no provider events
  // at all), whose last monthly grant is a month old
  const due = await database.withSystem(
    "cron.grants.select",
    async (tx) => {
      const lastGrant = sql<Date | null>`(select max(l.created_at) from credit_ledger l where l.user_id = ${users.id} and l.bucket = 'grant' and l.reason = 'grant')`;
      const free = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.plan, "free"),
            eq(users.status, "active"),
            sql`${lastGrant} <= ${cutoff.toISOString()}::timestamptz`,
          ),
        )
        .limit(1000);
      const annual = await tx
        .select({ id: subscriptions.userId, plan: subscriptions.plan })
        .from(subscriptions)
        .innerJoin(users, eq(users.id, subscriptions.userId))
        .where(
          and(
            eq(subscriptions.status, "active"),
            eq(subscriptions.interval, "year"),
            ne(subscriptions.provider, CRYPTO_PROVIDER_ID),
            sql`${subscriptions.currentPeriodEnd} > ${now.toISOString()}::timestamptz`,
            eq(users.status, "active"),
            sql`${lastGrant} <= ${cutoff.toISOString()}::timestamptz`,
          ),
        )
        .limit(1000);
      // crypto passes, monthly and annual: credited at purchase, then monthly while the pass hasn't ended
      const passes = await tx
        .select({ id: subscriptions.userId, plan: subscriptions.plan, subId: subscriptions.id })
        .from(subscriptions)
        .innerJoin(users, eq(users.id, subscriptions.userId))
        .where(
          and(
            eq(subscriptions.status, "active"),
            eq(subscriptions.provider, CRYPTO_PROVIDER_ID),
            sql`${subscriptions.currentPeriodEnd} > ${now.toISOString()}::timestamptz`,
            eq(users.status, "active"),
            sql`${lastGrant} <= ${cutoff.toISOString()}::timestamptz`,
          ),
        )
        .limit(1000);
      return { free, annual, passes };
    },
    { audit: false },
  );
  let granted = 0;
  for (const u of due.free)
    if (
      (
        await database.withSystem("cron.grants.free", (tx) => grantPlanPeriod(tx, u.id, "free", now), {
          audit: false,
        })
      ).granted
    )
      granted++;
  for (const u of due.annual)
    if (
      (
        await database.withSystem("cron.grants.annual", (tx) => grantPlanPeriod(tx, u.id, u.plan, now), {
          audit: false,
        })
      ).granted
    )
      granted++;

  for (const p of due.passes)
    if (
      (
        await database.withSystem(
          "cron.grants.pass",
          async (tx) => {
            const g = await grantPlanPeriod(tx, p.id, p.plan, now);
            if (g.granted)
              await tx
                .update(subscriptions)
                .set({ lastGrantPeriodStart: now })
                .where(eq(subscriptions.id, p.subId));
            return g;
          },
          { audit: false },
        )
      ).granted
    )
      granted++;

  const ended = await endCancelledSubscriptions(now, database);
  const endedPasses = await endExpiredPasses(now, database);
  const expired = await expireLots(now, { database });
  return {
    granted,
    endedSubscriptions: ended,
    endedPasses,
    expiredLots: expired.lots,
    expiredCredits: expired.credits,
  };
}

/** Crypto passes whose end date has passed: expired, and the plan moves to Free unless another subscription is live. */
export async function endExpiredPasses(now: Date, database: Database = getDatabase()): Promise<number> {
  const rows = await database.withSystem(
    "cron.passes.select",
    (tx) =>
      tx
        .select({ id: subscriptions.id, userId: subscriptions.userId })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.status, "active"),
            eq(subscriptions.provider, CRYPTO_PROVIDER_ID),
            isNotNull(subscriptions.currentPeriodEnd),
            lte(subscriptions.currentPeriodEnd, now),
          ),
        ),
    { audit: false },
  );
  let n = 0;
  for (const r of rows) {
    const ended = await database.withSystem("cron.passes.apply", async (tx) => {
      const [u] = await tx
        .select({ plan: users.plan })
        .from(users)
        .where(eq(users.id, r.userId))
        .for("update");
      const done = await tx
        .update(subscriptions)
        .set({ status: "expired" })
        .where(
          and(
            eq(subscriptions.id, r.id),
            eq(subscriptions.status, "active"),
            lte(subscriptions.currentPeriodEnd, now),
          ),
        )
        .returning({ id: subscriptions.id });
      if (done.length === 0) return false; // extended or ended by a concurrent run
      const live = await tx
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(and(eq(subscriptions.userId, r.userId), eq(subscriptions.status, "active")));
      if (live.length === 0 && u && u.plan !== "free") {
        await tx.update(users).set({ plan: "free" }).where(eq(users.id, r.userId));
        await grantPlanPeriod(tx, r.userId, "free", now);
      }
      return true;
    });
    if (ended) n++;
  }
  return n;
}

/** Subscriptions cancelled "at period end" whose period is over: the plan follows to Free now. */
export async function endCancelledSubscriptions(now: Date, database: Database): Promise<number> {
  const rows = await database.withSystem(
    "cron.ended.select",
    (tx) =>
      tx
        .select({ id: subscriptions.id, userId: subscriptions.userId })
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.status, "cancelled"),
            isNotNull(subscriptions.cancelAt),
            lte(subscriptions.cancelAt, now),
          ),
        ),
    { audit: false },
  );
  let n = 0;
  for (const r of rows) {
    const moved = await database.withSystem("cron.ended.apply", async (tx) => {
      const live = await tx
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(and(eq(subscriptions.userId, r.userId), eq(subscriptions.status, "active")));
      const [u] = await tx
        .select({ plan: users.plan })
        .from(users)
        .where(eq(users.id, r.userId))
        .for("update");
      if (live.length > 0 || !u || u.plan === "free") return false;
      await tx.update(users).set({ plan: "free" }).where(eq(users.id, r.userId));
      await grantPlanPeriod(tx, r.userId, "free", now);
      return true;
    });
    if (moved) n++;
  }
  return n;
}

/**
 * Pending downgrades: shortly before the period ends, ask Creem to switch the product without billing, so the
 * renewal charges the lower price and the new period starts on the lower plan (applied by the webhook).
 */
export async function applyPendingChanges(now: Date, deps: Deps = {}): Promise<number> {
  const database = deps.database ?? getDatabase();
  const provider = deps.provider ?? getBillingProvider();
  const rows = await database.withSystem(
    "cron.pending.select",
    (tx) =>
      tx
        .select()
        .from(subscriptions)
        .where(
          and(
            eq(subscriptions.status, "active"),
            inArray(subscriptions.provider, [...CARD_PROVIDERS]), // never ask the card provider about a crypto pass
            isNotNull(subscriptions.pendingProductKey),
            isNull(subscriptions.pendingRequestedAt),
            lte(subscriptions.pendingEffectiveAt, new Date(now.getTime() + DAY)),
          ),
        ),
    { audit: false },
  );
  let n = 0;
  for (const s of rows) {
    const entry = await database.withSystem(
      "cron.pending.catalog",
      (tx) => activeCatalogEntry(tx, provider.mode, s.pendingProductKey!),
      { audit: false },
    );
    if (!entry) continue;
    await provider.changePlan({
      subscriptionId: s.providerSubscriptionId,
      productId: entry.providerProductId,
      billing: "do_not_bill",
    });
    await database.withSystem(
      "cron.pending.mark",
      (tx) => tx.update(subscriptions).set({ pendingRequestedAt: now }).where(eq(subscriptions.id, s.id)),
      { audit: false },
    );
    n++;
  }
  return n;
}

/** Daily: founding checks, the plan moves they imply (at the renewal, never mid-period), and the due notices. */
export async function runFounding(now: Date, deps: Deps = {}) {
  const database = deps.database ?? getDatabase();
  const actions: FoundingAction[] = await runFoundingChecks(now, { database });
  for (const a of actions) {
    if (a.action !== "released") continue;
    await database.withSystem(
      "cron.founding.apply",
      async (tx) => {
        // (b) a paying founder moves to standard Pro at the next renewal; the pending change is applied just before it
        await tx
          .update(subscriptions)
          .set({ isFounding: false })
          .where(and(eq(subscriptions.userId, a.userId), eq(subscriptions.isFounding, true)));
        if (a.targetPlan === "pro") {
          await tx
            .update(subscriptions)
            .set({
              pendingProductKey: "pro_month",
              pendingEffectiveAt: a.effectiveAt,
              pendingRequestedAt: null,
            })
            .where(
              and(
                eq(subscriptions.userId, a.userId),
                eq(subscriptions.status, "active"),
                eq(subscriptions.productKey, "founding_pro_month"),
              ),
            );
        }
      },
      { audit: false },
    );
  }
  const pending = await applyPendingChanges(now, deps).catch((e) => {
    console.error("applyPendingChanges failed", e instanceof Error ? e.message : e);
    return 0;
  });
  const noticesSent = await sendDueFoundingNotices(now, database);
  return {
    renewed: actions.filter((a) => a.action === "renewed").length,
    released: actions.filter((a) => a.action === "released").length,
    noticesScheduled: actions.filter((a) => a.action === "notice_scheduled").length,
    noticesSent,
    pendingChangesRequested: pending,
  };
}

export async function sendDueFoundingNotices(now: Date, database: Database = getDatabase()): Promise<number> {
  const due = await database.withSystem(
    "cron.notices.select",
    (tx) =>
      tx
        .select()
        .from(foundingNotices)
        .where(and(isNull(foundingNotices.sentAt), lte(foundingNotices.scheduledFor, now))),
    { audit: false },
  );
  let sent = 0;
  for (const n of due) {
    const c = await userContact(n.userId);
    if (!c) continue;
    // claim the row first: only the process that flips sent_at sends, so a concurrent run can't double-send
    const claimed = await database.withSystem(
      "cron.notices.claim",
      (tx) =>
        tx
          .update(foundingNotices)
          .set({ sentAt: now })
          .where(and(eq(foundingNotices.id, n.id), isNull(foundingNotices.sentAt)))
          .returning({ id: foundingNotices.id }),
      { audit: false },
    );
    if (claimed.length === 0) continue;
    try {
      const p = n.payload as Record<string, unknown>;
      const vars = {
        foundingPrice: usd(FOUNDING.monthlyUsd),
        termMonths: String(FOUNDING.termMonths),
        renewalMonths: String(FOUNDING.renewalMinPaidMonthsInTrailing12),
        inactivityMonths: String(FOUNDING.inactivityReleaseMonths),
        proPrice: usd(PLANS[FOUNDING.plan].monthlyUsd),
      };
      const sub = await database.withSystem(
        "cron.notices.sub",
        (tx) =>
          tx
            .select({ id: subscriptions.id })
            .from(subscriptions)
            .where(and(eq(subscriptions.userId, n.userId), eq(subscriptions.status, "active")))
            .limit(1),
        { audit: false },
      );
      const subscribed = sub.length > 0;
      if (n.kind === "release_day") {
        const reason =
          p.reason === "inactivity"
            ? fill(copy.notices.releasedInactivity, vars)
            : p.reason === "renewal_failed"
              ? fill(copy.notices.releasedRenewal, vars)
              : "Your seat was released.";
        const eff = typeof p.effectiveAt === "string" ? new Date(p.effectiveAt) : null;
        const next =
          p.targetPlan === "pro"
            ? fill(copy.notices.nextPro, { ...vars, date: dateFmt(eff) })
            : copy.notices.nextFree;
        await sendEmail("foundingReleased", c.email, {
          name: c.name,
          reason,
          whatHappensNext: next,
          billingUrl: billingUrl(),
        });
      } else {
        const date = dateFmt(n.refAt);
        const reason =
          n.kind === "renewal_check_30d"
            ? fill(copy.notices.renewalReason, { ...vars, date, paidMonths: String(p.paidMonths ?? 0) })
            : fill(copy.notices.inactivityReason, vars);
        const howToKeep =
          n.kind === "renewal_check_30d"
            ? copy.notices.keepRenewal
            : fill(copy.notices.keepInactivity, { date });
        await sendEmail("foundingReleaseWarning", c.email, {
          name: c.name,
          date,
          reason,
          nextPlan: subscribed ? fill(copy.notices.nextPlanPro, vars) : copy.notices.nextPlanFree,
          howToKeep,
          foundingPrice: vars.foundingPrice,
          termMonths: vars.termMonths,
          renewalMonths: vars.renewalMonths,
          inactivityMonths: vars.inactivityMonths,
          billingUrl: billingUrl(),
        });
      }
      sent++;
    } catch (e) {
      // un-claim so the next run retries
      await database.withSystem(
        "cron.notices.unclaim",
        (tx) => tx.update(foundingNotices).set({ sentAt: null }).where(eq(foundingNotices.id, n.id)),
        { audit: false },
      );
      console.error("founding notice failed", n.kind, e instanceof Error ? e.message : e);
    }
  }
  return sent;
}

/** Hourly: send any 80% / 100% alert not yet sent this period, for users active in the last 35 days. */
export async function runCreditAlerts(now: Date, deps: Deps = {}) {
  const database = deps.database ?? getDatabase();
  const since = new Date(now.getTime() - 35 * DAY);
  const ids = await database.withSystem(
    "cron.alerts.select",
    (tx) =>
      tx
        .selectDistinct({ id: creditLedger.userId })
        .from(creditLedger)
        .where(
          and(
            eq(creditLedger.reason, "reserve"),
            sql`${creditLedger.createdAt} > ${since.toISOString()}::timestamptz`,
          ),
        )
        .limit(5000),
    { audit: false },
  );
  let sent = 0;
  for (const r of ids) sent += (await sendDueAlerts(r.id, database)).length;
  return { checked: ids.length, sent };
}
