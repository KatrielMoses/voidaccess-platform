/**
 * Creem webhook processing. Guarantees:
 *  - only signature-verified events are processed (HMAC over the raw body, constant-time compare);
 *  - each event id is processed exactly once per provider and mode: the event row and every effect commit in ONE
 *    transaction, and a duplicate delivery hits the unique (provider, mode, event id) and is acknowledged without
 *    effects;
 *  - credits move only through idempotent ledger keys derived from the order / subscription period, so a replay
 *    under a different event id still can't double-grant;
 *  - subscription events are applied as state snapshots, so out-of-order delivery (renewal before activation)
 *    converges;
 *  - the user is found only through billing_customers (customer id -> exactly one user); metadata.user_id, when
 *    present, must agree. Anything else is rejected and audited, never applied to a guessed user;
 *  - a top-up is credited only for a checkout our server created (billing_checkouts) for that user, and only if the
 *    price paid equals the amount recorded there; credits are topupCredits(paid dollars, plan at payment time);
 *  - refunds and disputes never move credits: they raise a review flag.
 */
import { and, eq, or } from "drizzle-orm";
import { PLANS, type PlanId } from "@voidaccess/config";
import {
  abuseFlags,
  auditLog,
  billingCheckouts,
  billingCustomers,
  billingEvents,
  claimFoundingSeat,
  getDatabase,
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
import { grantPlanDifference, grantPlanPeriod } from "./ledger-ext";
import { billingMode, type Mode } from "./provider";
import { verifyWebhook } from "./webhook-verify";

export const PROVIDER = "creem";
const ACTOR = "webhook:creem";

/** A Creem webhook body: `{ id: "evt_...", eventType, created_at (ms), object }`. */
export interface CreemEvent {
  id: string;
  eventType: string;
  created_at: number | string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  object: Record<string, any>;
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
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? null : t;
};
const s = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
/** Creem nests objects or sends just their id: `"cust_..."` or `{ id: "cust_...", ... }`. */
const idOf = (v: unknown): string | null =>
  s(v) ?? (v && typeof v === "object" ? s((v as { id?: unknown }).id) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Creem subscription status -> ours. scheduled_cancel is still active (with a cancel date); unpaid and expired keep
 * the plan while Creem retries the payment (Creem: "terminal only when status is changed to canceled").
 */
const STATUS_MAP: Record<string, "active" | "past_due" | "cancelled" | "paused"> = {
  active: "active",
  trialing: "active",
  scheduled_cancel: "active",
  past_due: "past_due",
  unpaid: "past_due",
  expired: "past_due",
  paused: "paused",
  canceled: "cancelled",
  cancelled: "cancelled",
};

export interface WebhookDeps {
  database?: Database;
  now?: () => Date;
  secret?: string;
  mode?: Mode;
}

/** Verify, then apply. HTTP status for Creem: 2xx = done (never retried), 4xx = bad request, 5xx = retry. */
export async function handleCreemWebhook(
  rawBody: string,
  headers: { get(n: string): string | null },
  deps: WebhookDeps = {},
): Promise<WebhookResult> {
  const v = verifyWebhook(deps.secret ?? getEnv().CREEM_WEBHOOK_SECRET, headers, rawBody);
  if (!v.ok)
    return { status: v.reason === "no_secret" ? 503 : 400, body: { ok: false, reason: v.reason }, post: [] };

  let ev: CreemEvent;
  try {
    ev = JSON.parse(rawBody) as CreemEvent;
    if (
      typeof ev.id !== "string" ||
      !ev.id ||
      typeof ev.eventType !== "string" ||
      typeof ev.object !== "object" ||
      ev.object === null
    )
      throw new Error("shape");
  } catch {
    return { status: 400, body: { ok: false, reason: "bad_payload" }, post: [] };
  }

  const database = deps.database ?? getDatabase();
  const mode = deps.mode ?? billingMode();
  const now = deps.now?.() ?? new Date();
  const post: PostEffect[] = [];
  try {
    const res = await database.withSystem("billing.webhook", async (tx) => {
      const ins = await tx
        .insert(billingEvents)
        .values({
          provider: PROVIDER,
          mode,
          eventId: ev.id,
          type: ev.eventType,
          eventAt: d(ev.created_at),
          outcome: "processing",
        })
        .onConflictDoNothing()
        .returning({ id: billingEvents.id });
      if (ins.length === 0) return { duplicate: true as const };
      const handled = await dispatch(tx, ev, mode, post, now);
      await tx
        .update(billingEvents)
        .set({ outcome: handled.outcome, userId: handled.userId ?? null, detail: handled.detail ?? {} })
        .where(eq(billingEvents.id, ins[0]!.id));
      if (handled.outcome === "rejected")
        await tx.insert(auditLog).values({
          actor: ACTOR,
          action: "billing.webhook.rejected",
          target: ev.id,
          meta: { type: ev.eventType, ...handled.detail },
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
    console.error("billing webhook failed", ev.eventType, ev.id, e instanceof Error ? e.message : e);
    return { status: 500, body: { ok: false, reason: "processing_failed" }, post: [] };
  }
}

/**
 * Creem marks objects with their environment ("test", "sandbox", "local" in the docs' samples; "prod" in the API
 * schema). Only known values are checked, so an unexpected label can't block real payments; the customer and
 * product lookups are keyed by mode anyway.
 */
const MODE_LABELS: Record<string, Mode> = {
  test: "test",
  sandbox: "test",
  local: "test",
  prod: "live",
  live: "live",
  production: "live",
};
const objectMode = (o: Record<string, unknown>): Mode | null =>
  typeof o.mode === "string" ? (MODE_LABELS[o.mode] ?? null) : null;

async function dispatch(tx: Tx, ev: CreemEvent, mode: Mode, post: PostEffect[], now: Date): Promise<Handled> {
  const om = objectMode(ev.object);
  if (om && om !== mode)
    return { outcome: "rejected", detail: { reason: "mode_mismatch", eventMode: ev.object.mode } };
  const type = ev.eventType;
  if (type === "checkout.completed") return applyCheckoutCompleted(tx, ev, mode, post, now);
  if (type.startsWith("subscription.")) return applySubscription(tx, ev, mode, post);
  if (type.startsWith("refund.") || type.startsWith("dispute.")) return flagForReview(tx, ev, mode);
  return { outcome: "ignored", detail: { reason: "unhandled_type" } };
}

/** customer id -> user, with the metadata.user_id cross-check. */
async function resolveUser(
  tx: Tx,
  mode: string,
  customerId: string | null,
  metadata: unknown,
): Promise<{ userId: string } | { reject: string }> {
  if (!customerId) return { reject: "no_customer" };
  const [m] = await tx
    .select({ userId: billingCustomers.userId })
    .from(billingCustomers)
    .where(and(eq(billingCustomers.mode, mode), eq(billingCustomers.providerCustomerId, customerId)));
  if (!m) return { reject: "unknown_customer" };
  const meta =
    metadata && typeof metadata === "object" ? s((metadata as { user_id?: unknown }).user_id) : null;
  if (meta && meta !== m.userId) return { reject: "metadata_user_mismatch" };
  return { userId: m.userId };
}

/**
 * checkout.completed. A subscription checkout only closes our checkout record (plan and credits follow the
 * subscription events). A one-time checkout is a top-up: credited once per order, for the paid amount, if and only
 * if it matches the checkout we recorded.
 */
async function applyCheckoutCompleted(
  tx: Tx,
  ev: CreemEvent,
  mode: Mode,
  post: PostEffect[],
  now: Date,
): Promise<Handled> {
  const o = ev.object;
  const order = (o.order ?? {}) as Record<string, unknown>;
  const who = await resolveUser(tx, mode, idOf(o.customer) ?? idOf(order.customer), o.metadata);
  if ("reject" in who) return { outcome: "rejected", detail: { reason: who.reject } };
  const userId = who.userId;
  const checkoutId = s(o.id);
  const ref = s(o.request_id) ?? s(o.metadata?.checkout_ref);
  const [row] = checkoutId
    ? await tx
        .select()
        .from(billingCheckouts)
        .where(
          and(
            eq(billingCheckouts.mode, mode),
            ref && /^[0-9a-f-]{36}$/i.test(ref)
              ? or(eq(billingCheckouts.providerCheckoutId, checkoutId), eq(billingCheckouts.id, ref))
              : eq(billingCheckouts.providerCheckoutId, checkoutId),
          ),
        )
        .for("update")
    : [];

  const productId = idOf(o.product) ?? idOf(order.product);
  const cat = productId ? await catalogByProductId(tx, mode, productId) : null;
  if (o.subscription || order.type === "recurring" || cat?.kind === "subscription") {
    if (row && row.userId === userId && !row.completedAt)
      await tx.update(billingCheckouts).set({ completedAt: now }).where(eq(billingCheckouts.id, row.id));
    return { outcome: "applied", userId, detail: { subscriptionCheckout: true } };
  }
  if (!cat || cat.kind !== "topup")
    return { outcome: "ignored", userId, detail: { reason: "not_a_known_topup" } };

  const orderId = s(order.id);
  if (!orderId) return { outcome: "ignored", userId, detail: { reason: "no_order" } };
  if (s(order.status) && order.status !== "paid")
    return { outcome: "ignored", userId, detail: { reason: "order_not_paid", status: order.status } };

  // what was paid, before tax (Creem: sub_total = price x units after any discount, amount_paid adds tax)
  const priceCents = num(order.sub_total) ?? num(order.amount);
  const discount = num(order.discount_amount) ?? 0;
  const currency = s(order.currency) ?? s(o.product?.currency);
  const customPrice = num(o.custom_price);
  const problems: string[] = [];
  if (!row) problems.push("unknown_checkout");
  else {
    if (row.userId !== userId) problems.push("checkout_user_mismatch");
    if (row.kind !== "topup" || row.topupUsd === null) problems.push("checkout_not_topup");
    if (priceCents === null || priceCents !== row.amountCents) problems.push("amount_mismatch");
    if (customPrice !== null && customPrice !== row.amountCents) problems.push("custom_price_mismatch");
    if (row.topupUsd !== null && row.topupUsd * 100 !== row.amountCents)
      problems.push("checkout_amount_corrupt");
  }
  if (discount > 0) problems.push("discounted");
  if (currency && currency !== "USD") problems.push("currency_mismatch");
  if (problems.length > 0) {
    // money was taken but we can't credit it safely: an admin decides (refund or manual grant)
    await tx.insert(abuseFlags).values({
      userId,
      kind: "billing_topup_mismatch",
      detail: {
        problems,
        order: orderId,
        checkout: checkoutId,
        paidCents: priceCents,
        expectedCents: row?.amountCents ?? null,
        note: "No credits were granted; review and refund or grant manually.",
      },
    });
    return { outcome: "rejected", userId, detail: { reason: problems[0], problems, order: orderId } };
  }

  const usd = row!.topupUsd!;
  const paidAt = d(order.created_at) ?? d(ev.created_at) ?? now;
  await tx
    .insert(payments)
    .values({
      userId,
      provider: PROVIDER,
      providerPaymentId: orderId,
      amountCents: num(order.amount_paid) ?? priceCents!,
      kind: "topup",
      paidAt,
      meta: { key: cat.key, usd, checkout: checkoutId, transaction: s(order.transaction) },
    })
    .onConflictDoNothing();
  const r = await topup(userId, usd, orderId, { tx, now: paidAt });
  if (!row!.completedAt)
    await tx.update(billingCheckouts).set({ completedAt: now }).where(eq(billingCheckouts.id, row!.id));
  if (!r.duplicate) post.push({ kind: "topup_purchased", userId, usd });
  return {
    outcome: "applied",
    userId,
    detail: { topupUsd: usd, credits: r.credits, duplicate: r.duplicate },
  };
}

/** Refunds and disputes never move credits: they raise an admin flag and an audit row. */
async function flagForReview(tx: Tx, ev: CreemEvent, mode: string): Promise<Handled> {
  const o = ev.object;
  const tr = (o.transaction ?? {}) as Record<string, unknown>;
  const order = (o.order ?? {}) as Record<string, unknown>;
  const who = await resolveUser(
    tx,
    mode,
    idOf(o.customer) ?? idOf(tr.customer) ?? idOf(order.customer),
    o.checkout?.metadata ?? o.subscription?.metadata,
  );
  const userId = "userId" in who ? who.userId : null;
  const ref = s(o.id);
  await tx.insert(abuseFlags).values({
    userId,
    kind: ev.eventType.startsWith("dispute") ? "billing_dispute" : "billing_refund",
    detail: {
      event: ev.eventType,
      reference: ref,
      transaction: idOf(o.transaction),
      order: idOf(o.order) ?? s(tr.order),
      amountCents: num(o.refund_amount) ?? num(o.amount),
      note: "No credits were moved; review and decide manually.",
    },
  });
  await tx.insert(auditLog).values({
    actor: ACTOR,
    action: `billing.${ev.eventType}`,
    target: userId,
    meta: { reference: ref },
  });
  return { outcome: "applied", userId, detail: { flagged: true } };
}

const monthlyCredits = (p: PlanId) => PLANS[p].monthlyCredits;
const day = (dt: Date) => dt.toISOString().slice(0, 10);

async function applySubscription(tx: Tx, ev: CreemEvent, mode: string, post: PostEffect[]): Promise<Handled> {
  const data = ev.object;
  const who = await resolveUser(tx, mode, idOf(data.customer), data.metadata);
  if ("reject" in who) return { outcome: "rejected", detail: { reason: who.reject } };
  const userId = who.userId;
  const subRef = s(data.id);
  const productId = idOf(data.product) ?? s(data.items?.[0]?.product_id);
  if (!subRef || !productId) return { outcome: "ignored", userId, detail: { reason: "incomplete_snapshot" } };
  const cat = await catalogByProductId(tx, mode, productId);
  if (!cat || cat.kind !== "subscription" || !cat.plan || !cat.interval)
    return { outcome: "ignored", userId, detail: { reason: "unknown_product" } };

  const eventAt = d(ev.created_at) ?? new Date();
  const rawStatus = ev.eventType === "subscription.expired" ? "expired" : String(data.status ?? "");
  const status = STATUS_MAP[rawStatus];
  if (!status) return { outcome: "ignored", userId, detail: { reason: "unknown_status", status: rawStatus } };
  const periodStart = d(data.current_period_start_date);
  const periodEnd = d(data.current_period_end_date);
  const cancelFlag = rawStatus === "scheduled_cancel";
  if (status === "past_due") post.push({ kind: "payment_failed", userId });

  const [existing] = await tx
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.provider, PROVIDER), eq(subscriptions.providerSubscriptionId, subRef)))
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

  const finalState = status === "cancelled" && newer;
  const endsLater = finalState && status === "cancelled" && periodEnd !== null && periodEnd > eventAt;

  const row = {
    userId,
    provider: PROVIDER,
    providerSubscriptionId: subRef,
    providerCustomerId: idOf(data.customer),
    plan: effPlan,
    interval: effInterval,
    status,
    currentPeriodStart: periodStart ?? existing?.currentPeriodStart ?? null,
    currentPeriodEnd: periodEnd ?? existing?.currentPeriodEnd ?? null,
    // Creem's status says whether a cancellation is scheduled, so an active snapshot clears it (resume)
    cancelAt: endsLater
      ? periodEnd
      : finalState
        ? null
        : cancelFlag
          ? periodEnd
          : rawStatus === "active"
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

  // subscription.paid carries the transaction: record the payment (the founding 3-of-12 rule reads these rows)
  const txnId = ev.eventType === "subscription.paid" ? s(data.last_transaction_id) : null;
  if (txnId) {
    const price = num(data.last_transaction?.amount) ?? num(data.product?.price) ?? cat.amountCents;
    await tx
      .insert(payments)
      .values({
        userId,
        provider: PROVIDER,
        providerPaymentId: txnId,
        amountCents: price,
        kind: "subscription",
        subscriptionId: subId,
        paidAt: d(data.last_transaction_date) ?? eventAt,
        periodStart: periodStart ?? null,
        periodEnd: periodEnd ?? null,
        meta: { providerSubscriptionId: subRef, productKey: cat.key },
      })
      .onConflictDoNothing();
  }

  const detail: Record<string, unknown> = { productKey: cat.key, status, plan: effPlan };

  // ---- final states: the plan follows Creem, inside this transaction ----
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
        await grantPlanPeriod(tx, userId, "free", eventAt);
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
      const g = await grantPlanPeriod(tx, userId, effPlan, periodStart);
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
