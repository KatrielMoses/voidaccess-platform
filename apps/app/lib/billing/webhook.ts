/**
 * Dodo webhook processing. Guarantees:
 *  - only verified (signature + fresh timestamp) events are processed;
 *  - each event id is processed exactly once: the event row and every effect commit in ONE transaction, and a
 *    duplicate delivery hits the unique event id and is acknowledged without effects;
 *  - credits move only through idempotent ledger keys derived from the payment / subscription period, so a replay
 *    under a different event id still can't double-grant;
 *  - events are applied as state snapshots, so out-of-order delivery (renewal before activation) converges;
 *  - the user is found only through billing_customers (customer id -> exactly one user); metadata.user_id, when
 *    present, must agree. Anything else is rejected, never applied to a guessed user.
 */
import { and, eq, sql } from "drizzle-orm";
import { PLANS, type PlanId } from "@voidaccess/config";
import {
  abuseFlags,
  auditLog,
  billingCustomers,
  billingEvents,
  claimFoundingSeat,
  getDatabase,
  grantMonthly,
  payments,
  releaseFoundingSeat,
  subscriptions,
  topup,
  users,
  type Database,
  type Tx,
} from "@voidaccess/db";
import { getEnv } from "../../env";
import { catalogByProductId, FOUNDING_KEY, productRank, planRank, type Interval } from "./catalog";
import { grantPlanDifference } from "./ledger-ext";
import { billingMode } from "./provider";
import { verifyWebhook } from "./webhook-verify";

export interface DodoEvent {
  business_id?: string;
  type: string;
  timestamp: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any>;
}

/** Work to do after the transaction commits (emails, analytics): never inside it. */
export type PostEffect =
  | { kind: "welcome"; userId: string; plan: PlanId }
  | { kind: "payment_failed"; userId: string }
  | { kind: "subscribed"; userId: string; plan: PlanId; interval: Interval; founding: boolean }
  | { kind: "topup_purchased"; userId: string; usd: number };

export interface WebhookResult {
  status: number;
  body: { ok: boolean; outcome?: string; reason?: string };
  post: PostEffect[];
}

interface Handled {
  outcome: "applied" | "ignored" | "rejected";
  userId?: string | null;
  detail?: Record<string, unknown>;
}

const d = (v: unknown): Date | null => {
  if (typeof v !== "string") return null;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? null : t;
};
const s = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

const STATUS_MAP: Record<string, "active" | "past_due" | "cancelled" | "expired" | "paused"> = {
  active: "active",
  past_due: "past_due",
  on_hold: "past_due",
  paused: "paused",
  cancelled: "cancelled",
  expired: "expired",
  failed: "expired",
};

export interface WebhookDeps {
  database?: Database;
  now?: () => Date;
  secret?: string;
  mode?: "test" | "live";
}

/** Verify, then apply. Returns an HTTP status Dodo understands: 2xx = done (never retried), 4xx = bad request, 5xx = retry. */
export async function handleDodoWebhook(
  rawBody: string,
  headers: { get(n: string): string | null },
  deps: WebhookDeps = {},
): Promise<WebhookResult> {
  const now = deps.now?.() ?? new Date();
  const v = verifyWebhook(
    deps.secret ?? getEnv().DODO_WEBHOOK_SECRET,
    headers,
    rawBody,
    Math.floor(now.getTime() / 1000),
  );
  if (!v.ok)
    return { status: v.reason === "no_secret" ? 503 : 400, body: { ok: false, reason: v.reason }, post: [] };

  let ev: DodoEvent;
  try {
    ev = JSON.parse(rawBody) as DodoEvent;
    if (typeof ev.type !== "string" || typeof ev.data !== "object" || ev.data === null)
      throw new Error("shape");
  } catch {
    return { status: 400, body: { ok: false, reason: "bad_payload" }, post: [] };
  }

  const database = deps.database ?? getDatabase();
  const mode = deps.mode ?? billingMode();
  const post: PostEffect[] = [];
  try {
    const res = await database.withSystem("billing.webhook", async (tx) => {
      const ins = await tx
        .insert(billingEvents)
        .values({ eventId: v.id, type: ev.type, eventAt: d(ev.timestamp), outcome: "processing" })
        .onConflictDoNothing()
        .returning({ id: billingEvents.id });
      if (ins.length === 0) return { duplicate: true as const };
      const handled = await dispatch(tx, ev, mode, post);
      await tx
        .update(billingEvents)
        .set({ outcome: handled.outcome, userId: handled.userId ?? null, detail: handled.detail ?? {} })
        .where(eq(billingEvents.id, ins[0]!.id));
      if (handled.outcome === "rejected")
        await tx.insert(auditLog).values({
          actor: "webhook:dodo",
          action: "billing.webhook.rejected",
          target: v.id,
          meta: { type: ev.type, ...handled.detail },
        });
      return { duplicate: false as const, handled };
    });
    if (res.duplicate) return { status: 200, body: { ok: true, outcome: "duplicate" }, post: [] };
    return {
      status: 200,
      body: { ok: true, outcome: res.handled.outcome },
      post: res.handled.outcome === "applied" ? post : [],
    };
  } catch (e) {
    console.error("billing webhook failed", ev.type, v.id, e instanceof Error ? e.message : e);
    return { status: 500, body: { ok: false, reason: "processing_failed" }, post: [] };
  }
}

async function dispatch(tx: Tx, ev: DodoEvent, mode: string, post: PostEffect[]): Promise<Handled> {
  const type = ev.type;
  if (type.startsWith("subscription.")) {
    if (["subscription.update_payment_method", "subscription.unpaused"].includes(type) && !ev.data.product_id)
      return { outcome: "ignored", detail: { reason: "no_snapshot" } };
    return applySubscription(tx, ev, mode, post);
  }
  if (type === "payment.succeeded") return applyPaymentSucceeded(tx, ev, mode, post);
  if (type === "payment.failed") return applyPaymentFailed(tx, ev, mode, post);
  if (type === "refund.succeeded" || type === "refund.failed" || type.startsWith("dispute."))
    return flagForReview(tx, ev, mode);
  return { outcome: "ignored", detail: { reason: "unhandled_type" } };
}

/** customer id -> user, with metadata.user_id cross-check. Null means: reject. */
async function resolveUser(
  tx: Tx,
  mode: string,
  data: DodoEvent["data"],
): Promise<{ userId: string } | { reject: string }> {
  const customerId = s(data.customer?.customer_id);
  if (!customerId) return { reject: "no_customer" };
  const [m] = await tx
    .select({ userId: billingCustomers.userId })
    .from(billingCustomers)
    .where(and(eq(billingCustomers.mode, mode), eq(billingCustomers.dodoCustomerId, customerId)));
  if (!m) return { reject: "unknown_customer" };
  const meta = s(data.metadata?.user_id);
  if (meta && meta !== m.userId) return { reject: "metadata_user_mismatch" };
  return { userId: m.userId };
}

async function applyPaymentSucceeded(
  tx: Tx,
  ev: DodoEvent,
  mode: string,
  post: PostEffect[],
): Promise<Handled> {
  const data = ev.data;
  const who = await resolveUser(tx, mode, data);
  if ("reject" in who) return { outcome: "rejected", detail: { reason: who.reject } };
  const userId = who.userId;
  const paymentId = s(data.payment_id);
  if (!paymentId) return { outcome: "ignored", detail: { reason: "no_payment_id" } };
  const paidAt = d(data.created_at) ?? d(ev.timestamp) ?? new Date();
  const amountCents = Number(data.total_amount ?? 0);
  const subRef = s(data.subscription_id) ?? s(data.subscription_ids?.[0]);
  const productId = s(data.product_cart?.[0]?.product_id);
  const cat = productId ? await catalogByProductId(tx, mode, productId) : null;

  if (!subRef) {
    // one-time payment: a top-up
    if (!cat || cat.kind !== "topup" || cat.topupUsd === null)
      return { outcome: "ignored", userId, detail: { reason: "not_a_known_topup" } };
    await tx
      .insert(payments)
      .values({
        userId,
        providerPaymentId: paymentId,
        amountCents,
        kind: "topup",
        paidAt,
        meta: { key: cat.key },
      })
      .onConflictDoNothing();
    const r = await topup(userId, cat.topupUsd, paymentId, { tx, now: paidAt });
    if (!r.duplicate) post.push({ kind: "topup_purchased", userId, usd: cat.topupUsd });
    return {
      outcome: "applied",
      userId,
      detail: { topup: cat.topupUsd, credits: r.credits, duplicate: r.duplicate },
    };
  }

  // subscription payment: record it (the founding 3-of-12 rule reads these rows); the grant comes from the subscription event
  const [sub] = await tx
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.provider, "dodo"), eq(subscriptions.providerSubscriptionId, subRef)));
  if (sub && sub.userId !== userId)
    return { outcome: "rejected", detail: { reason: "subscription_owner_mismatch" } };
  await tx
    .insert(payments)
    .values({
      userId,
      providerPaymentId: paymentId,
      amountCents,
      kind: "subscription",
      subscriptionId: sub?.id ?? null,
      paidAt,
      periodStart: sub?.currentPeriodStart ?? null,
      periodEnd: sub?.currentPeriodEnd ?? null,
      meta: { providerSubscriptionId: subRef },
    })
    .onConflictDoNothing();
  return { outcome: "applied", userId, detail: { subscriptionPayment: true } };
}

async function applyPaymentFailed(tx: Tx, ev: DodoEvent, mode: string, post: PostEffect[]): Promise<Handled> {
  const who = await resolveUser(tx, mode, ev.data);
  if ("reject" in who) return { outcome: "rejected", detail: { reason: who.reject } };
  post.push({ kind: "payment_failed", userId: who.userId });
  return {
    outcome: "applied",
    userId: who.userId,
    detail: { note: "banner and email only; the plan changes on the subscription's final state" },
  };
}

/** Refunds and disputes never move credits: they raise an admin flag and an audit row. */
async function flagForReview(tx: Tx, ev: DodoEvent, mode: string): Promise<Handled> {
  const who = await resolveUser(tx, mode, ev.data);
  const userId = "userId" in who ? who.userId : null;
  const ref = s(ev.data.refund_id) ?? s(ev.data.dispute_id) ?? s(ev.data.payment_id);
  await tx.insert(abuseFlags).values({
    userId,
    kind: ev.type.startsWith("dispute") ? "billing_dispute" : "billing_refund",
    detail: {
      event: ev.type,
      reference: ref,
      paymentId: s(ev.data.payment_id),
      note: "No credits were moved; review and decide manually.",
    },
  });
  await tx.insert(auditLog).values({
    actor: "webhook:dodo",
    action: `billing.${ev.type}`,
    target: userId,
    meta: { reference: ref },
  });
  return { outcome: "applied", userId, detail: { flagged: true } };
}

const monthlyCredits = (p: PlanId) => PLANS[p].monthlyCredits;
const day = (dt: Date) => dt.toISOString().slice(0, 10);

async function applySubscription(tx: Tx, ev: DodoEvent, mode: string, post: PostEffect[]): Promise<Handled> {
  const data = ev.data;
  const who = await resolveUser(tx, mode, data);
  if ("reject" in who) return { outcome: "rejected", detail: { reason: who.reject } };
  const userId = who.userId;
  const subRef = s(data.subscription_id);
  const productId = s(data.product_id);
  if (!subRef || !productId) return { outcome: "ignored", userId, detail: { reason: "incomplete_snapshot" } };
  const cat = await catalogByProductId(tx, mode, productId);
  if (!cat || cat.kind !== "subscription" || !cat.plan || !cat.interval)
    return { outcome: "ignored", userId, detail: { reason: "unknown_product" } };

  const eventAt = d(ev.timestamp) ?? new Date();
  const status = STATUS_MAP[String(data.status)] ?? "active";
  const periodStart = d(data.previous_billing_date);
  const periodEnd = d(data.next_billing_date);
  const cancelFlag = data.cancel_at_next_billing_date === true;

  const [existing] = await tx
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.provider, "dodo"), eq(subscriptions.providerSubscriptionId, subRef)))
    .for("update");
  if (existing && existing.userId !== userId)
    return { outcome: "rejected", detail: { reason: "subscription_owner_mismatch" } };
  const [u] = await tx.select({ plan: users.plan }).from(users).where(eq(users.id, userId)).for("update");
  if (!u) return { outcome: "rejected", detail: { reason: "unknown_user" } };

  const newer = !existing?.providerEventAt || eventAt >= existing.providerEventAt;
  const oldPlan = u.plan as PlanId;
  const currentRank = existing ? productRank(existing.plan, existing.interval) : planRank(oldPlan) * 10;
  const targetRank = productRank(cat.plan, cat.interval);
  const newPeriod = Boolean(
    existing?.currentPeriodStart && periodStart && periodStart > existing.currentPeriodStart,
  );

  let effPlan: PlanId = existing ? existing.plan : oldPlan;
  let effInterval: Interval = existing?.interval ?? cat.interval;
  let pendingKey = existing?.pendingProductKey ?? null;
  let pendingAt = existing?.pendingEffectiveAt ?? null;
  let upgraded = false;

  const live = status === "active" || status === "past_due" || status === "paused";
  if (newer && live) {
    if (targetRank > currentRank) {
      effPlan = cat.plan;
      effInterval = cat.interval;
      upgraded = planRank(cat.plan) > planRank(oldPlan);
      pendingKey = null;
      pendingAt = null;
    } else if (targetRank < currentRank) {
      if (newPeriod) {
        effPlan = cat.plan;
        effInterval = cat.interval;
        pendingKey = null;
        pendingAt = null;
      } else {
        pendingKey = cat.key; // the downgrade waits for the period end
        pendingAt = periodEnd;
      }
    } else if (pendingKey === cat.key) {
      pendingKey = null;
      pendingAt = null;
    }
  }

  const finalState = (status === "cancelled" || status === "expired") && newer;
  const endsLater = finalState && status === "cancelled" && periodEnd !== null && periodEnd > eventAt;

  const row = {
    userId,
    provider: "dodo",
    providerSubscriptionId: subRef,
    providerCustomerId: s(data.customer?.customer_id),
    plan: effPlan,
    interval: effInterval,
    status,
    currentPeriodStart: periodStart ?? existing?.currentPeriodStart ?? null,
    currentPeriodEnd: periodEnd ?? existing?.currentPeriodEnd ?? null,
    cancelAt: endsLater
      ? periodEnd
      : cancelFlag
        ? periodEnd
        : finalState
          ? null
          : (existing?.cancelAt ?? null),
    productKey: cat.key,
    providerEventAt: eventAt,
    pendingProductKey: finalState ? null : pendingKey,
    pendingEffectiveAt: finalState ? null : pendingAt,
  };
  let subId: string;
  if (!existing) {
    const [ins] = await tx.insert(subscriptions).values(row).returning({ id: subscriptions.id });
    subId = ins!.id;
  } else {
    subId = existing.id;
    if (newer) await tx.update(subscriptions).set(row).where(eq(subscriptions.id, subId));
  }

  // payments that arrived before this snapshot get their subscription link and billing period
  if (periodStart) {
    await tx.execute(sql`
      update payments set subscription_id = ${subId}, period_start = coalesce(period_start, ${periodStart.toISOString()}::timestamptz),
        period_end = coalesce(period_end, ${periodEnd?.toISOString() ?? null}::timestamptz)
      where user_id = ${userId} and kind = 'subscription' and meta->>'providerSubscriptionId' = ${subRef}
        and (subscription_id is null or period_start is null) and paid_at >= ${new Date(periodStart.getTime() - 86_400_000).toISOString()}::timestamptz`);
  }

  const detail: Record<string, unknown> = { productKey: cat.key, status, plan: effPlan };

  // ---- final states: the plan follows Dodo, inside this transaction ----
  if (finalState) {
    if (endsLater) {
      detail.endsAt = periodEnd!.toISOString(); // cron moves the user to Free at that time
    } else {
      const others = await tx
        .select({ id: subscriptions.id })
        .from(subscriptions)
        .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")));
      if (others.length === 0 && oldPlan !== "free") {
        await tx.update(users).set({ plan: "free" }).where(eq(users.id, userId));
        await grantMonthly(userId, "free", eventAt, { tx });
        detail.plan = "free";
      }
    }
    return { outcome: "applied", userId, detail };
  }
  if (!newer || !live)
    return {
      outcome: "applied",
      userId,
      detail: { ...detail, state: newer ? "status_only" : "stale_state_kept" },
    };

  // ---- plan follows the subscription ----
  if (effPlan !== oldPlan) await tx.update(users).set({ plan: effPlan }).where(eq(users.id, userId));

  // ---- credits ----
  if (status === "active" && periodStart) {
    const last = existing?.lastGrantPeriodStart ?? null;
    if (!last || periodStart > last) {
      const g = await grantMonthly(userId, effPlan, periodStart, { tx });
      await tx
        .update(subscriptions)
        .set({ lastGrantPeriodStart: periodStart })
        .where(eq(subscriptions.id, subId));
      detail.granted = g.granted ? g.credits : null;
    } else if (upgraded && periodStart.getTime() === last.getTime()) {
      const diff = monthlyCredits(effPlan) - monthlyCredits(oldPlan);
      const ok = await grantPlanDifference(
        tx,
        userId,
        diff,
        `${subId}:${day(periodStart)}:${effPlan}`,
        periodEnd ?? new Date(periodStart.getTime() + 31 * 86_400_000),
      );
      detail.upgradeDifference = ok ? diff : 0;
    } else if (periodStart < last) detail.grant = "skipped_older_period";
  }

  // ---- founding seat ----
  const isFoundingProduct = cat.key === FOUNDING_KEY;
  let isFounding = existing?.isFounding ?? false;
  if (status === "active" && isFoundingProduct && !isFounding) {
    const seat = await claimFoundingSeat(userId, { tx, now: periodStart ?? eventAt });
    if (seat !== null) {
      isFounding = true;
      detail.foundingSeat = seat;
    } else {
      // seats ran out between checkout and payment: keep them on Pro, move to the standard price at the period end, tell an admin
      await tx
        .update(subscriptions)
        .set({ pendingProductKey: "pro_month", pendingEffectiveAt: periodEnd })
        .where(eq(subscriptions.id, subId));
      await tx.insert(abuseFlags).values({
        userId,
        kind: "billing_founding_unavailable",
        detail: { subscription: subRef, note: "Paid the founding price but no seat was free." },
      });
      detail.foundingSeat = null;
    }
  }
  if (isFounding && !isFoundingProduct) {
    // moved off the founding product (Pro+ or annual): the seat is released, with the warning already shown in the app
    await releaseFoundingSeat(userId, "upgraded", { tx, now: eventAt });
    isFounding = false;
    detail.foundingReleased = true;
  }
  if (isFounding !== (existing?.isFounding ?? false))
    await tx.update(subscriptions).set({ isFounding }).where(eq(subscriptions.id, subId));

  const first =
    !existing || (existing.status !== "active" && status === "active" && !existing.lastGrantPeriodStart);
  if (status === "active" && first) {
    post.push({ kind: "welcome", userId, plan: effPlan });
    post.push({ kind: "subscribed", userId, plan: effPlan, interval: effInterval, founding: isFounding });
  }
  return { outcome: "applied", userId, detail };
}
