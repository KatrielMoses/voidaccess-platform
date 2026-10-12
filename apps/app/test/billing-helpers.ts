import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { creditLedger, billingCustomers, getDatabase, subscriptions, users } from "@voidaccess/db";
import { setTransport, LogTransport } from "@voidaccess/emails";
import { FakeProvider, setBillingProvider } from "@/lib/billing/provider";
import { handleDodoWebhook, type DodoEvent } from "@/lib/billing/webhook";
import { signWebhook } from "@/lib/billing/webhook-verify";
import { syncCatalog } from "@/lib/billing/sync";
import { billingCatalog } from "@voidaccess/db";
import { and } from "drizzle-orm";
import { makeUser } from "./helpers";
import type { TestSessionUser } from "./session-state";

export const SECRET = process.env.DODO_WEBHOOK_SECRET!;
export const provider = new FakeProvider();
export const outbox = new LogTransport(undefined);

export async function setupBilling() {
  setBillingProvider(provider);
  setTransport(outbox);
  await syncCatalog(provider);
}

export const productId = async (key: string): Promise<string> => {
  const [r] = await getDatabase().withSystem(
    "test.catalog",
    (tx) =>
      tx
        .select()
        .from(billingCatalog)
        .where(
          and(eq(billingCatalog.key, key), eq(billingCatalog.active, true), eq(billingCatalog.mode, "test")),
        ),
    { audit: false },
  );
  return r!.dodoProductId;
};

export interface BUser {
  id: string;
  customer: string;
  email: string;
  /** the signed-in identity for route tests (asUser) */
  session: TestSessionUser;
}

/** A free user with no credits and a Dodo customer mapping (what checkout creates before redirecting). */
export async function makeBillingUser(plan: "free" | "pro" | "pro_plus" = "free"): Promise<BUser> {
  const u = await makeUser({ plan, credits: 0 });
  const customer = `cus_${randomUUID().slice(0, 12)}`;
  await getDatabase().withSystem(
    "test.customer",
    (tx) => tx.insert(billingCustomers).values({ userId: u.id, mode: "test", dodoCustomerId: customer }),
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
  status?: string;
  periodStart: Date;
  periodEnd: Date;
  cancelFlag?: boolean;
  metadataUser?: string | null;
}

export async function subSnapshot(o: SubData) {
  return {
    payload_type: "Subscription",
    subscription_id: o.subId,
    product_id: await productId(o.key),
    status: o.status ?? "active",
    previous_billing_date: iso(o.periodStart),
    next_billing_date: iso(o.periodEnd),
    cancel_at_next_billing_date: o.cancelFlag ?? false,
    customer: { customer_id: o.user.customer, email: o.user.email, name: "T" },
    metadata: o.metadataUser === null ? {} : { user_id: o.metadataUser ?? o.user.id },
  };
}

export function paymentData(o: {
  user: BUser;
  paymentId: string;
  productId?: string;
  subId?: string;
  cents: number;
  at: Date;
}) {
  return {
    payload_type: "Payment",
    payment_id: o.paymentId,
    total_amount: o.cents,
    created_at: iso(o.at),
    subscription_id: o.subId ?? null,
    product_cart: o.productId ? [{ product_id: o.productId, quantity: 1 }] : null,
    customer: { customer_id: o.user.customer, email: o.user.email, name: "T" },
    metadata: { user_id: o.user.id },
  };
}

/** Deliver a signed event exactly as Dodo would (Standard Webhooks headers over the raw body). */
export async function deliver(
  type: string,
  data: Record<string, unknown>,
  opts: { id?: string; at?: Date; now?: Date; secret?: string; tamper?: boolean; skewSeconds?: number } = {},
) {
  const at = opts.at ?? new Date();
  const now = opts.now ?? at;
  const ev: DodoEvent = { business_id: "bus_test", type, timestamp: iso(at), data };
  const body = JSON.stringify(ev);
  const id = opts.id ?? eventId();
  const ts = Math.floor(now.getTime() / 1000) + (opts.skewSeconds ?? 0);
  const sig = signWebhook(opts.secret ?? SECRET, id, ts, body);
  const headers = new Headers({
    "webhook-id": id,
    "webhook-timestamp": String(ts),
    "webhook-signature": sig,
  });
  return handleDodoWebhook(opts.tamper ? body.replace('"type"', '"type" ') : body, headers, {
    now: () => now,
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
