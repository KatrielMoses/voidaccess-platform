/**
 * NOWPayments IPN processing. Guarantees:
 *  - only signed callbacks are processed (see signature.ts); a missing secret is 503, a bad signature 400;
 *  - only VoidAccess orders ("va_" order_id, see order-ref.ts): the NOWPayments account and IPN secret are shared
 *    with MailAccess ("ma_"), so any other order_id is refused with 403 before the database is touched;
 *  - each (payment id, status) pair is processed once: the billing_events row (provider "nowpayments", the crypto
 *    mode, event id "<payment id>:<status>") and every effect commit in ONE transaction, and a re-delivery hits the
 *    unique (provider, mode, event id), so a crypto event can never collide with a Creem one;
 *  - an order is applied only on `finished` and only while applied_at is null (set in the same transaction), so a
 *    re-sent or late `finished`, even under another payment id, can never credit twice;
 *  - the callback must name one of our orders, in our mode, priced in USD at exactly the order's price; anything
 *    else is rejected and flagged, never applied;
 *  - refunds after credit and conflicting purchases raise a review flag; nothing is clawed back automatically.
 * Status codes: 200 for handled, ignored and rejected (NOWPayments stops retrying), 500 only for unexpected
 * errors so it retries.
 */
import { eq } from "drizzle-orm";
import {
  CRYPTO_ORDER_STATUSES,
  abuseFlags,
  addMonths,
  auditLog,
  billingEvents,
  cryptoOrders,
  getDatabase,
  payments,
  subscriptions,
  topup,
  users,
  type CryptoOrderStatus,
  type Database,
  type Tx,
} from "@voidaccess/db";
import { getEnv } from "../../../env";
import { subKey, type Interval } from "../catalog";
import { grantPlanPeriod, lastGrantAt } from "../ledger-ext";
import type { PostEffect, WebhookResult } from "../webhook";
import { activePass, addInterval, CRYPTO_PROVIDER_ID, liveCardSubscription } from "./passes";
import { cryptoEnabled, cryptoMode } from "./provider";
import { fromProviderOrderId } from "./order-ref";
import { verifyIpn } from "./signature";

export interface IpnDeps {
  database?: Database;
  now?: () => Date;
  secret?: string;
  mode?: "test" | "live";
  enabled?: boolean;
}

type Outcome = "applied" | "status_updated" | "ignored" | "rejected";
interface Handled {
  outcome: Outcome;
  userId?: string | null;
  detail?: Record<string, unknown>;
}

/** NOWPayments sends ids as numbers or strings. */
const idOf = (v: unknown): string | null =>
  typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" && v ? v : null;

/** An amount in USD to exact cents, or null if it isn't a whole number of cents. */
export function exactCents(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const c = Math.round(n * 100);
  return Math.abs(n * 100 - c) < 1e-6 ? c : null;
}

export async function handleNowPaymentsIpn(
  rawBody: string,
  headers: { get(n: string): string | null },
  deps: IpnDeps = {},
): Promise<WebhookResult> {
  const now = deps.now?.() ?? new Date();
  const v = verifyIpn(deps.secret ?? getEnv().NOWPAYMENTS_IPN_SECRET, headers, rawBody);
  if (!v.ok)
    return { status: v.reason === "no_secret" ? 503 : 400, body: { ok: false, reason: v.reason }, post: [] };
  const body = v.body;
  const paymentId = idOf(body.payment_id);
  const status = typeof body.payment_status === "string" ? body.payment_status : null;
  if (!paymentId || !status) return { status: 400, body: { ok: false, reason: "bad_payload" }, post: [] };
  const orderId = fromProviderOrderId(body.order_id);
  if (!orderId) return { status: 403, body: { ok: false, reason: "not_a_voidaccess_order" }, post: [] };

  const database = deps.database ?? getDatabase();
  if (!(deps.enabled ?? cryptoEnabled())) {
    // verified but switched off: acknowledge (so nothing retries forever) and leave a trail to find the order
    await database
      .withSystem(
        "billing.crypto.ipn.off",
        (tx) =>
          tx.insert(auditLog).values({
            actor: "webhook:nowpayments",
            action: "billing.crypto.ipn_ignored_off",
            target: orderId,
            meta: { paymentId, status },
          }),
        { audit: false },
      )
      .catch(() => {});
    return { status: 200, body: { ok: true, outcome: "ignored", reason: "crypto_payments_off" }, post: [] };
  }

  const mode = deps.mode ?? cryptoMode();
  const post: PostEffect[] = [];
  const eventId = `${paymentId}:${status}`;
  try {
    const res = await database.withSystem("billing.crypto.ipn", async (tx) => {
      const ins = await tx
        .insert(billingEvents)
        .values({
          provider: CRYPTO_PROVIDER_ID,
          mode,
          eventId,
          type: `nowpayments.${status}`,
          eventAt: now,
          outcome: "processing",
        })
        .onConflictDoNothing()
        .returning({ id: billingEvents.id });
      if (ins.length === 0) return { duplicate: true as const };
      const handled = await dispatch(tx, body, { orderId, paymentId, status, mode, now }, post);
      await tx
        .update(billingEvents)
        .set({ outcome: handled.outcome, userId: handled.userId ?? null, detail: handled.detail ?? {} })
        .where(eq(billingEvents.id, ins[0]!.id));
      if (handled.outcome === "rejected")
        await tx.insert(auditLog).values({
          actor: "webhook:nowpayments",
          action: "billing.crypto.ipn_rejected",
          target: orderId,
          meta: { paymentId, status, ...handled.detail },
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
    console.error("nowpayments ipn failed", eventId, e instanceof Error ? e.message : e);
    return { status: 500, body: { ok: false, reason: "processing_failed" }, post: [] };
  }
}

interface Ctx {
  /** our crypto_orders id (the "va_" prefix already checked and removed) */
  orderId: string;
  paymentId: string;
  status: string;
  mode: string;
  now: Date;
}

async function flag(tx: Tx, userId: string | null, kind: string, detail: Record<string, unknown>) {
  await tx.insert(abuseFlags).values({
    userId,
    kind,
    detail: {
      ...detail,
      provider: CRYPTO_PROVIDER_ID,
      note: "No credits were moved; review and decide manually.",
    },
  });
}

async function dispatch(tx: Tx, body: Record<string, unknown>, c: Ctx, post: PostEffect[]): Promise<Handled> {
  const orderId = c.orderId;
  const [order] = await tx.select().from(cryptoOrders).where(eq(cryptoOrders.id, orderId)).for("update");
  if (!order) return { outcome: "rejected", detail: { reason: "unknown_order", orderId } };
  const userId = order.userId;
  const ref = { orderId, paymentId: c.paymentId, status: c.status };

  // ---- the callback must describe exactly this order ----
  const mismatch = async (reason: string, extra: Record<string, unknown> = {}): Promise<Handled> => {
    await flag(tx, userId, "billing_crypto_mismatch", { reason, ...ref, ...extra });
    return { outcome: "rejected", userId, detail: { reason, orderId } };
  };
  if (order.mode !== c.mode) return mismatch("mode_mismatch", { orderMode: order.mode });
  const currency = typeof body.price_currency === "string" ? body.price_currency.toLowerCase() : null;
  if (currency !== "usd") return mismatch("currency_mismatch", { currency: body.price_currency ?? null });
  const cents = exactCents(body.price_amount);
  if (cents === null || cents !== order.priceCents)
    return mismatch("amount_mismatch", { expectedCents: order.priceCents, got: body.price_amount ?? null });
  const invoiceId = idOf(body.invoice_id);
  if (invoiceId && order.providerInvoiceId && invoiceId !== order.providerInvoiceId)
    return mismatch("invoice_mismatch");

  if (!(CRYPTO_ORDER_STATUSES as readonly string[]).includes(c.status) || c.status === "created")
    return { outcome: "ignored", userId, detail: { reason: "unknown_status", ...ref } };
  const status = c.status as CryptoOrderStatus;

  // ---- already credited: only a refund changes anything, and only as a flag ----
  if (order.appliedAt) {
    if (status === "refunded") {
      await tx.update(cryptoOrders).set({ status }).where(eq(cryptoOrders.id, orderId));
      await flag(tx, userId, "billing_refund", { ...ref, kind: order.kind });
      return { outcome: "status_updated", userId, detail: { ...ref, flagged: true } };
    }
    if (status === "finished" && order.providerPaymentId !== c.paymentId) {
      // a second, separate payment completed for an order that was already credited: money to look at
      await flag(tx, userId, "billing_crypto_review", {
        ...ref,
        reason: "second_finished_payment",
        appliedPaymentId: order.providerPaymentId,
      });
      return { outcome: "ignored", userId, detail: { reason: "already_applied", flagged: true, ...ref } };
    }
    return { outcome: "ignored", userId, detail: { reason: "already_applied", ...ref } };
  }

  await tx
    .update(cryptoOrders)
    .set({ status, providerPaymentId: c.paymentId })
    .where(eq(cryptoOrders.id, orderId));
  if (status !== "finished") return { outcome: "status_updated", userId, detail: ref };

  // ---- finished and not yet applied: apply once ----
  if (order.kind === "topup") {
    const usd = order.topupUsd!;
    await tx
      .insert(payments)
      .values({
        userId,
        provider: CRYPTO_PROVIDER_ID,
        providerPaymentId: c.paymentId,
        amountCents: order.priceCents,
        kind: "topup",
        paidAt: c.now,
        meta: { orderId, payCurrency: body.pay_currency ?? null },
      })
      .onConflictDoNothing();
    const r = await topup(userId, usd, `nowpayments:${c.paymentId}`, { tx, now: c.now });
    await tx.update(cryptoOrders).set({ appliedAt: c.now }).where(eq(cryptoOrders.id, orderId));
    if (!r.duplicate) post.push({ kind: "topup_purchased", userId, usd });
    return { outcome: "applied", userId, detail: { ...ref, topup: usd, credits: r.credits } };
  }
  return applyPass(tx, order, body, c, post);
}

async function applyPass(
  tx: Tx,
  order: typeof cryptoOrders.$inferSelect,
  body: Record<string, unknown>,
  c: Ctx,
  post: PostEffect[],
): Promise<Handled> {
  const userId = order.userId;
  const plan = order.plan!;
  const interval = order.interval! as Interval;
  const ref = { orderId: order.id, paymentId: c.paymentId };
  const [u] = await tx.select({ plan: users.plan }).from(users).where(eq(users.id, userId)).for("update");
  if (!u) return { outcome: "rejected", userId, detail: { reason: "unknown_user", ...ref } };

  // checkout refuses these, but two orders can be paid in any order: never stack a pass on another plan
  const conflict = (await liveCardSubscription(tx, userId))
    ? "card_subscription_live"
    : await activePass(tx, userId, c.now, true).then((p) => (p && p.plan !== plan ? "pass_active" : null));
  if (conflict) {
    await flag(tx, userId, "billing_crypto_review", { ...ref, reason: conflict, plan, interval });
    return { outcome: "rejected", userId, detail: { reason: conflict, ...ref } };
  }

  const existing = await activePass(tx, userId, c.now, true);
  let subId: string;
  let periodStart: Date;
  let periodEnd: Date;
  let granted: number | null = null;
  if (existing) {
    // same plan: extend from the current end; the monthly grant keeps its own rhythm (cron), so an extension
    // bought mid-month adds time, not a second grant for the same month
    periodStart = existing.currentPeriodEnd!;
    periodEnd = addInterval(periodStart, interval);
    subId = existing.id;
    await tx
      .update(subscriptions)
      .set({ currentPeriodEnd: periodEnd, cancelAt: periodEnd, providerEventAt: c.now })
      .where(eq(subscriptions.id, subId));
    const last = await lastGrantAt(tx, userId);
    if (!last || last <= addMonths(c.now, -1)) {
      const g = await grantPlanPeriod(tx, userId, plan, c.now);
      await tx.update(subscriptions).set({ lastGrantPeriodStart: c.now }).where(eq(subscriptions.id, subId));
      granted = g.granted ? g.credits : null;
    }
  } else {
    periodStart = c.now;
    periodEnd = addInterval(c.now, interval);
    const [ins] = await tx
      .insert(subscriptions)
      .values({
        userId,
        provider: CRYPTO_PROVIDER_ID,
        providerSubscriptionId: order.id,
        plan,
        interval,
        status: "active",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAt: periodEnd, // a pass never renews: the UI shows when it ends
        productKey: subKey(plan, interval),
        providerEventAt: c.now,
        lastGrantPeriodStart: c.now,
      })
      .returning({ id: subscriptions.id });
    subId = ins!.id;
    const g = await grantPlanPeriod(tx, userId, plan, c.now);
    granted = g.granted ? g.credits : null;
  }
  if (u.plan !== plan) await tx.update(users).set({ plan }).where(eq(users.id, userId));
  await tx
    .insert(payments)
    .values({
      userId,
      provider: CRYPTO_PROVIDER_ID,
      providerPaymentId: c.paymentId,
      amountCents: order.priceCents,
      kind: "subscription",
      subscriptionId: subId,
      paidAt: c.now,
      periodStart,
      periodEnd,
      meta: { orderId: order.id, pass: true, payCurrency: body.pay_currency ?? null },
    })
    .onConflictDoNothing();
  await tx.update(cryptoOrders).set({ appliedAt: c.now }).where(eq(cryptoOrders.id, order.id));
  post.push({ kind: "pass_purchased", userId, plan, interval, extended: Boolean(existing) });
  return {
    outcome: "applied",
    userId,
    detail: {
      ...ref,
      pass: subKey(plan, interval),
      extended: Boolean(existing),
      endsAt: periodEnd.toISOString(),
      granted,
    },
  };
}
