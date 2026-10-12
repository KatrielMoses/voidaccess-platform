/**
 * The only module that talks to Dodo Payments. Everything else depends on the BillingProvider interface,
 * so tests and e2e run against the in-memory fake (BILLING_PROVIDER=fake) and production uses the official SDK.
 */
import { randomUUID } from "node:crypto";
import DodoPayments from "dodopayments";
import { getEnv } from "../../env";
import type { CatalogEntry, Interval } from "./catalog";

export type Mode = "test" | "live";

export interface BillingProvider {
  readonly mode: Mode;
  createCustomer(input: { email: string; name: string; userId: string }): Promise<{ id: string }>;
  createCheckout(input: {
    customerId: string;
    productId: string;
    metadata: Record<string, string>;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string; sessionId: string }>;
  /** What changing to this product would charge right now (cents), per Dodo's proration. */
  previewChange(input: {
    subscriptionId: string;
    productId: string;
  }): Promise<{ amountCents: number; currency: string }>;
  changePlan(input: {
    subscriptionId: string;
    productId: string;
    billing: "prorated_immediately" | "do_not_bill";
  }): Promise<void>;
  setCancelAtPeriodEnd(input: { subscriptionId: string; cancel: boolean; reason?: string }): Promise<void>;
  portalLink(customerId: string): Promise<string>;
  /** Catalogue sync: create one product from a config-derived entry. */
  createProduct(entry: CatalogEntry): Promise<{ id: string }>;
}

const FREQ: Record<Interval, "Month" | "Year"> = { month: "Month", year: "Year" };

export class DodoProvider implements BillingProvider {
  private readonly client: DodoPayments;
  constructor(
    apiKey: string,
    readonly mode: Mode,
  ) {
    this.client = new DodoPayments({
      bearerToken: apiKey,
      environment: mode === "live" ? "live_mode" : "test_mode",
    });
  }
  async createCustomer(i: { email: string; name: string; userId: string }) {
    const c = await this.client.customers.create({
      email: i.email,
      name: i.name,
      metadata: { user_id: i.userId },
    });
    return { id: c.customer_id };
  }
  async createCheckout(i: Parameters<BillingProvider["createCheckout"]>[0]) {
    const s = await this.client.checkoutSessions.create({
      product_cart: [{ product_id: i.productId, quantity: 1 }],
      customer: { customer_id: i.customerId },
      metadata: i.metadata,
      return_url: i.returnUrl,
      cancel_url: i.cancelUrl,
    });
    if (!s.checkout_url) throw new Error("Dodo returned no checkout url");
    return { url: s.checkout_url, sessionId: s.session_id };
  }
  async previewChange(i: { subscriptionId: string; productId: string }) {
    const r = await this.client.subscriptions.previewChangePlan(i.subscriptionId, {
      product_id: i.productId,
      quantity: 1,
      proration_billing_mode: "prorated_immediately",
    });
    return {
      amountCents: r.immediate_charge.summary.total_amount,
      currency: String(r.immediate_charge.summary.currency),
    };
  }
  async changePlan(i: Parameters<BillingProvider["changePlan"]>[0]) {
    await this.client.subscriptions.changePlan(i.subscriptionId, {
      product_id: i.productId,
      quantity: 1,
      proration_billing_mode: i.billing === "do_not_bill" ? "do_not_bill" : "prorated_immediately",
      on_payment_failure: "prevent_change",
    });
  }
  async setCancelAtPeriodEnd(i: { subscriptionId: string; cancel: boolean; reason?: string }) {
    await this.client.subscriptions.update(i.subscriptionId, {
      cancel_at_next_billing_date: i.cancel,
      ...(i.cancel
        ? {
            cancel_reason: "cancelled_by_customer" as const,
            ...(i.reason ? { cancellation_comment: i.reason.slice(0, 500) } : {}),
          }
        : {}),
    });
  }
  async portalLink(customerId: string) {
    return (await this.client.customers.customerPortal.create(customerId)).link;
  }
  async createProduct(e: CatalogEntry) {
    const base = {
      currency: "USD" as const,
      price: e.amountCents,
      discount: 0,
      purchasing_power_parity: false,
    };
    const price =
      e.kind === "topup"
        ? ({ type: "one_time_price", ...base } as const)
        : ({
            type: "recurring_price",
            ...base,
            payment_frequency_count: 1,
            payment_frequency_interval: FREQ[e.interval!],
            subscription_period_count: e.interval === "year" ? 10 : 120,
            subscription_period_interval: FREQ[e.interval!],
          } as const);
    const p = await this.client.products.create({
      name: e.name,
      price,
      tax_category: "saas",
      description: e.kind === "topup" ? "One-time credit top-up for VoidAccess." : "VoidAccess subscription.",
      metadata: { key: e.key },
    });
    return { id: p.product_id };
  }
}

/** Records every call and returns deterministic ids, for tests and e2e. Never talks to the network. */
export class FakeProvider implements BillingProvider {
  readonly mode: Mode = "test";
  readonly calls: { op: string; args: unknown }[] = [];
  previewCents = 500;
  private n = 0;
  private rec<T>(op: string, args: unknown, out: T): T {
    this.calls.push({ op, args });
    return out;
  }
  async createCustomer(i: { email: string; name: string; userId: string }) {
    return this.rec("createCustomer", i, { id: `cus_fake_${i.userId.slice(0, 8)}` });
  }
  async createCheckout(i: Parameters<BillingProvider["createCheckout"]>[0]) {
    const sessionId = `cks_fake_${++this.n}`;
    return this.rec("createCheckout", i, {
      sessionId,
      url: `https://test.checkout.dodopayments.com/session/${sessionId}?product=${i.productId}`,
    });
  }
  async previewChange(i: { subscriptionId: string; productId: string }) {
    return this.rec("previewChange", i, { amountCents: this.previewCents, currency: "USD" });
  }
  async changePlan(i: Parameters<BillingProvider["changePlan"]>[0]) {
    this.rec("changePlan", i, null);
  }
  async setCancelAtPeriodEnd(i: { subscriptionId: string; cancel: boolean; reason?: string }) {
    this.rec("setCancelAtPeriodEnd", i, null);
  }
  async portalLink(customerId: string) {
    return this.rec(
      "portalLink",
      { customerId },
      `https://test.customer.dodopayments.com/portal/${customerId}`,
    );
  }
  async createProduct(e: CatalogEntry) {
    return this.rec("createProduct", e, {
      id: `pdt_fake_${e.key}_${e.amountCents}_${randomUUID().slice(0, 8)}`,
    });
  }
}

let provider: BillingProvider | undefined;
export function setBillingProvider(p: BillingProvider | undefined) {
  provider = p;
}

export function billingMode(): Mode {
  return getEnv().DODO_ENV === "live_mode" ? "live" : "test";
}

export function getBillingProvider(): BillingProvider {
  if (provider) return provider;
  const env = getEnv();
  if (env.BILLING_PROVIDER === "fake") {
    if (env.NODE_ENV === "production") throw new Error("The fake billing provider cannot run in production");
    return (provider = new FakeProvider());
  }
  if (!env.DODO_PAYMENTS_API_KEY) throw new Error("DODO_PAYMENTS_API_KEY is not set");
  return (provider = new DodoProvider(env.DODO_PAYMENTS_API_KEY, billingMode()));
}
