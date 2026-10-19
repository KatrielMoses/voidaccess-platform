import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  billingCatalog,
  billingCheckouts,
  billingCustomers,
  creditLedger,
  getDatabase,
  subscriptions,
  users,
} from "@voidaccess/db";
import { setTransport, LogTransport } from "@voidaccess/emails";
import { FakeProvider, setBillingProvider, type Mode } from "@/lib/billing/provider";
import { handleCreemWebhook, type CreemEvent } from "@/lib/billing/webhook";
import { SIGNATURE_HEADER, signWebhook } from "@/lib/billing/webhook-verify";
import { syncCatalog } from "@/lib/billing/sync";
import { createTopupCheckout } from "@/lib/billing/checkout";
import { makeUser } from "./helpers";
import type { TestSessionUser } from "./session-state";

export const SECRET = process.env.CREEM_WEBHOOK_SECRET!;
export const provider = new FakeProvider();
export const outbox = new LogTransport(undefined);

export async function setupBilling() {
  setBillingProvider(provider);
  setTransport(outbox);
  await syncCatalog(provider);
}

export async function catalogRow(key: string, mode: Mode = "test") {
  const [r] = await getDatabase().withSystem(
    "test.catalog",
    (tx) =>
      tx
        .select()
        .from(billingCatalog)
        .where(
          and(eq(billingCatalog.key, key), eq(billingCatalog.active, true), eq(billingCatalog.mode, mode)),
        ),
    { audit: false },
  );
  return r!;
}
export const productId = async (key: string): Promise<string> => (await catalogRow(key)).providerProductId;

export interface BUser {
  id: string;
  customer: string;
  email: string;
  /** the signed-in identity for route tests (asUser) */
  session: TestSessionUser;
}

/** A user with no credits and a Creem customer mapping (what checkout creates before redirecting). */
export async function makeBillingUser(plan: "free" | "pro" | "pro_plus" = "free"): Promise<BUser> {
  const u = await makeUser({ plan, credits: 0 });
  const customer = `cust_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  await getDatabase().withSystem(
    "test.customer",
    (tx) => tx.insert(billingCustomers).values({ userId: u.id, mode: "test", providerCustomerId: customer }),
    { audit: false },
  );
  return { id: u.id, customer, email: u.email, session: u };
}

let seq = 0;
export const eventId = () => `evt_${Date.now()}_${++seq}`;
export const iso = (d: Date) => d.toISOString();

export interface SubData {
  user: BUser;
  subId: string;
  key: string;
  /** Creem's subscription status: active | scheduled_cancel | past_due | unpaid | paused | canceled | ... */
  status?: string;
  periodStart: Date;
  periodEnd: Date;
  metadataUser?: string | null;
  /** subscription.paid carries the paid transaction */
  transactionId?: string;
  mode?: string;
}

/** A Creem subscription object as webhooks carry it (product and customer expanded). */
export async function subSnapshot(o: SubData) {
  const cat = await catalogRow(o.key);
  return {
    id: o.subId,
    object: "subscription",
    product: {
      id: cat.providerProductId,
      name: cat.name,
      price: cat.amountCents,
      currency: "USD",
      billing_type: "recurring",
      billing_period: cat.interval === "year" ? "every-year" : "every-month",
      status: "active",
      mode: "test",
    },
    customer: { id: o.user.customer, object: "customer", email: o.user.email, name: "T", mode: "test" },
    collection_method: "charge_automatically",
    status: o.status ?? "active",
    ...(o.transactionId
      ? {
          last_transaction_id: o.transactionId,
          last_transaction: { id: o.transactionId, amount: cat.amountCents, currency: "USD" },
          last_transaction_date: iso(o.periodStart),
        }
      : {}),
    current_period_start_date: iso(o.periodStart),
    current_period_end_date: iso(o.periodEnd),
    canceled_at: o.status === "canceled" ? iso(o.periodStart) : null,
    metadata: o.metadataUser === null ? {} : { user_id: o.metadataUser ?? o.user.id },
    mode: o.mode ?? "test",
  };
}

/** Start a real top-up checkout through the app code (fake provider) and return what it recorded. */
export async function startTopup(user: BUser, usd: number) {
  const r = await createTopupCheckout(user.id, usd, { provider });
  if (!r.ok) throw new Error(`checkout failed: ${r.error}`);
  const [row] = await getDatabase().withSystem(
    "test.checkout",
    (tx) =>
      tx
        .select()
        .from(billingCheckouts)
        .where(eq(billingCheckouts.userId, user.id))
        .orderBy(desc(billingCheckouts.createdAt))
        .limit(1),
    { audit: false },
  );
  return row!;
}

/** checkout.completed for a one-time (top-up) checkout, as Creem sends it. */
export async function topupCompleted(
  user: BUser,
  checkout: { id: string; providerCheckoutId: string | null; amountCents: number },
  o: {
    orderId?: string;
    paidCents?: number;
    customPrice?: number | null;
    discountCents?: number;
    currency?: string;
    metadataUser?: string;
    customer?: string;
    at?: Date;
  } = {},
) {
  const product = await catalogRow("topup_credits");
  const paid = o.paidCents ?? checkout.amountCents;
  const orderId = o.orderId ?? `ord_${checkout.id.slice(0, 8)}`;
  const customer = o.customer ?? user.customer;
  return {
    id: checkout.providerCheckoutId,
    object: "checkout",
    request_id: checkout.id,
    order: {
      id: orderId,
      object: "order",
      customer,
      product: product.providerProductId,
      amount: paid,
      sub_total: paid,
      tax_amount: 0,
      discount_amount: o.discountCents ?? 0,
      amount_due: paid,
      amount_paid: paid,
      currency: o.currency ?? "USD",
      status: "paid",
      type: "onetime",
      transaction: `tran_${orderId}`,
      created_at: iso(o.at ?? new Date()),
      mode: "test",
    },
    product: {
      id: product.providerProductId,
      name: product.name,
      price: product.amountCents,
      currency: "USD",
      billing_type: "onetime",
      billing_period: "once",
      mode: "test",
    },
    customer: { id: customer, object: "customer", email: user.email, mode: "test" },
    units: 1,
    ...(o.customPrice === null ? {} : { custom_price: o.customPrice ?? checkout.amountCents }),
    status: "completed",
    metadata: { user_id: o.metadataUser ?? user.id, key: "topup_credits", checkout_ref: checkout.id },
    mode: "test",
  };
}

/** Deliver a signed event exactly as Creem would (creem-signature = hex HMAC-SHA256 of the raw body). */
export async function deliver(
  type: string,
  object: Record<string, unknown>,
  opts: { id?: string; at?: Date; now?: Date; secret?: string; tamper?: boolean; mode?: Mode } = {},
) {
  const at = opts.at ?? new Date();
  const ev: CreemEvent = { id: opts.id ?? eventId(), eventType: type, created_at: at.getTime(), object };
  const body = JSON.stringify(ev);
  const headers = new Headers({ [SIGNATURE_HEADER]: signWebhook(opts.secret ?? SECRET, body) });
  return handleCreemWebhook(opts.tamper ? body.replace('"eventType"', '"eventType" ') : body, headers, {
    now: () => opts.now ?? at,
    ...(opts.mode ? { mode: opts.mode } : {}),
  });
}

export async function planOf(userId: string) {
  const [u] = await getDatabase().withSystem(
    "test.plan",
    (tx) => tx.select({ plan: users.plan }).from(users).where(eq(users.id, userId)),
    { audit: false },
  );
  return u!.plan;
}

export async function ledger(userId: string) {
  return getDatabase().withSystem(
    "test.ledger",
    (tx) => tx.select().from(creditLedger).where(eq(creditLedger.userId, userId)),
    { audit: false },
  );
}

export const grantBalance = async (userId: string) =>
  (await ledger(userId)).filter((r) => r.bucket === "grant").reduce((a, r) => a + r.amount, 0);

export async function subRows(userId: string) {
  return getDatabase().withSystem(
    "test.subs",
    (tx) => tx.select().from(subscriptions).where(eq(subscriptions.userId, userId)),
    { audit: false },
  );
}

export const DAY = 86_400_000;
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
