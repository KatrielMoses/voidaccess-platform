/**
 * The only module that talks to the payment provider (Creem, merchant of record, since P7). Everything else depends
 * on the BillingProvider interface, so tests and e2e run against the in-memory fake (BILLING_PROVIDER=fake) and
 * production uses Creem's REST API over plain fetch (https://docs.creem.io, x-api-key header).
 */
import { randomUUID } from "node:crypto";
import { getEnv } from "../../env";
import type { CatalogEntry, Interval } from "./catalog";

export type Mode = "test" | "live";

/** A product as the provider lists it, normalised for catalogue adoption. */
export interface ProviderProduct {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  billingType: "recurring" | "onetime";
  /** "month" | "year" for recurring products, "once" for one-time, anything else as the provider reports it */
  period: string | null;
  active: boolean;
}

export interface BillingProvider {
  readonly name: "creem" | "fake";
  readonly mode: Mode;
  /** Create (or, at Creem, find by email) the customer for a user. */
  createCustomer(input: { email: string; name: string; userId: string }): Promise<{ id: string }>;
  createCheckout(input: {
    customerId: string;
    productId: string;
    /** our billing_checkouts id, sent as Creem's request_id */
    requestId: string;
    metadata: Record<string, string>;
    successUrl: string;
    /** one-time products only: the price for this checkout, in cents (units = 1) */
    customPriceCents?: number;
  }): Promise<{ url: string; checkoutId: string }>;
  /**
   * What changing to this product would charge right now (cents). Creem has no preview endpoint, so this is an
   * estimate from the two prices and the time left in the period; Creem computes the exact prorated charge.
   */
  previewChange(input: {
    subscriptionId: string;
    productId: string;
  }): Promise<{ amountCents: number; currency: string; estimated: boolean }>;
  changePlan(input: {
    subscriptionId: string;
    productId: string;
    billing: "prorated_immediately" | "do_not_bill";
  }): Promise<void>;
  setCancelAtPeriodEnd(input: { subscriptionId: string; cancel: boolean; reason?: string }): Promise<void>;
  portalLink(customerId: string): Promise<string>;
  /** Catalogue sync: every product in this mode (active and archived). */
  listProducts(): Promise<ProviderProduct[]>;
  /** Catalogue sync: create one product from a config-derived entry. */
  createProduct(entry: CatalogEntry): Promise<{ id: string }>;
}

export const CREEM_API_BASE: Record<Mode, string> = {
  test: "https://test-api.creem.io",
  live: "https://api.creem.io",
};
/** Creem's own request budget; a slow call fails the user action rather than hanging it. */
const CREEM_TIMEOUT_MS = 15_000;
const PERIOD: Record<Interval, "every-month" | "every-year"> = { month: "every-month", year: "every-year" };
const PERIOD_BACK: Record<string, string> = { "every-month": "month", "every-year": "year", once: "once" };

export class CreemError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(`Creem ${path} failed (${status}): ${message}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

export class CreemProvider implements BillingProvider {
  readonly name = "creem" as const;
  private readonly base: string;
  constructor(
    private readonly apiKey: string,
    readonly mode: Mode,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    // test keys only work against the test API, and a live key must never run in test mode (or vice versa)
    const isTestKey = apiKey.startsWith("creem_test_");
    if (mode === "test" && !isTestKey)
      throw new Error("Creem test mode needs a test API key (creem_test_...)");
    if (mode === "live" && isTestKey) throw new Error("Creem live mode can't use a test API key");
    this.base = CREEM_API_BASE[mode];
  }

  private async call<T = Json>(
    method: "GET" | "POST",
    path: string,
    body?: Json,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const res = await this.fetchImpl(this.base + path, {
      method,
      headers: {
        "x-api-key": this.apiKey,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(CREEM_TIMEOUT_MS),
    });
    const text = await res.text();
    let json: Json = {};
    try {
      json = text ? (JSON.parse(text) as Json) : {};
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok) {
      const msg = Array.isArray(json.message) ? json.message.join("; ") : (json.message ?? json.error ?? "");
      throw new CreemError(res.status, path.split("?")[0]!, String(msg).slice(0, 300));
    }
    return json as T;
  }

  async createCustomer(i: { email: string; name: string; userId: string }) {
    // Creem's POST /v1/customers returns the existing customer for a known email (one customer per email per mode)
    const c = await this.call("POST", "/v1/customers", {
      email: i.email,
      name: i.name || i.email,
      external_id: i.userId,
      metadata: { user_id: i.userId },
    });
    if (typeof c.id !== "string") throw new Error("Creem returned no customer id");
    return { id: c.id };
  }

  async createCheckout(i: Parameters<BillingProvider["createCheckout"]>[0]) {
    const c = await this.call("POST", "/v1/checkouts", {
      product_id: i.productId,
      request_id: i.requestId,
      units: 1,
      ...(i.customPriceCents !== undefined ? { custom_price: i.customPriceCents } : {}),
      customer: { id: i.customerId },
      success_url: i.successUrl,
      metadata: i.metadata,
    });
    if (typeof c.checkout_url !== "string" || typeof c.id !== "string")
      throw new Error("Creem returned no checkout url");
    return { url: c.checkout_url, checkoutId: c.id };
  }

  async previewChange(i: { subscriptionId: string; productId: string }) {
    const sub = await this.call(
      "GET",
      `/v1/subscriptions?subscription_id=${encodeURIComponent(i.subscriptionId)}`,
    );
    const target = await this.call("GET", `/v1/products/${encodeURIComponent(i.productId)}`);
    const current =
      typeof sub.product === "object" && sub.product
        ? sub.product
        : await this.call("GET", `/v1/products/${encodeURIComponent(String(sub.product))}`);
    const start = Date.parse(sub.current_period_start_date);
    const end = Date.parse(sub.current_period_end_date);
    const left =
      Number.isFinite(start) && Number.isFinite(end) && end > start
        ? Math.min(1, Math.max(0, (end - Date.now()) / (end - start)))
        : 1;
    return {
      amountCents: prorationEstimate(
        Number(current.price),
        current.billing_period,
        Number(target.price),
        target.billing_period,
        left,
      ),
      currency: String(target.currency ?? "USD"),
      estimated: true,
    };
  }

  async changePlan(i: Parameters<BillingProvider["changePlan"]>[0]) {
    await this.call("POST", `/v1/subscriptions/${encodeURIComponent(i.subscriptionId)}/upgrade`, {
      product_id: i.productId,
      update_behavior: i.billing === "do_not_bill" ? "proration-none" : "proration-charge-immediately",
    });
  }

  async setCancelAtPeriodEnd(i: { subscriptionId: string; cancel: boolean }) {
    // Creem's cancel takes no reason; ours is kept in analytics (plan-ops)
    const id = encodeURIComponent(i.subscriptionId);
    if (i.cancel)
      await this.call("POST", `/v1/subscriptions/${id}/cancel`, { mode: "scheduled", onExecute: "cancel" });
    else await this.call("POST", `/v1/subscriptions/${id}/resume`);
  }

  async portalLink(customerId: string) {
    const r = await this.call("POST", "/v1/customers/billing", { customer_id: customerId });
    if (typeof r.customer_portal_link !== "string") throw new Error("Creem returned no portal link");
    return r.customer_portal_link;
  }

  async listProducts() {
    const out: ProviderProduct[] = [];
    for (let page = 1; page < 100; page++) {
      const r = await this.call("GET", `/v1/products/search?page_number=${page}&page_size=50`);
      for (const p of (r.items ?? []) as Json[]) out.push(normaliseProduct(p));
      if (!r.pagination?.next_page) break;
    }
    return out;
  }

  async createProduct(e: CatalogEntry) {
    const p = await this.call(
      "POST",
      "/v1/products",
      {
        name: e.name,
        description:
          e.kind === "topup" ? "VoidAccess credits, pay as you go." : `VoidAccess ${e.name} subscription.`,
        price: e.amountCents,
        currency: "USD",
        billing_type: e.kind === "topup" ? "onetime" : "recurring",
        ...(e.kind === "topup" ? {} : { billing_period: PERIOD[e.interval!] }),
        tax_mode: "exclusive",
        tax_category: "saas",
      },
      { "Idempotency-Key": `va-${this.mode}-${e.key}-${e.amountCents}` },
    );
    return { id: String(p.id) };
  }
}

function normaliseProduct(p: Json): ProviderProduct {
  return {
    id: String(p.id),
    name: String(p.name ?? ""),
    priceCents: Number(p.price),
    currency: String(p.currency ?? ""),
    billingType: p.billing_type === "recurring" ? "recurring" : "onetime",
    period: p.billing_period ? (PERIOD_BACK[p.billing_period] ?? String(p.billing_period)) : null,
    active: p.status !== "archived",
  };
}

/**
 * Prorated charge for an immediate plan change: same billing period = the price difference for the time left;
 * a different period (monthly -> annual) starts a new period = the new price minus the unused part of the old one.
 */
export function prorationEstimate(
  oldCents: number,
  oldPeriod: string | undefined,
  newCents: number,
  newPeriod: string | undefined,
  fractionLeft: number,
): number {
  const raw =
    oldPeriod === newPeriod ? (newCents - oldCents) * fractionLeft : newCents - oldCents * fractionLeft;
  return Math.max(0, Math.round(raw));
}

/** Records every call and returns deterministic ids, for tests and e2e. Never talks to the network. */
export class FakeProvider implements BillingProvider {
  readonly name = "fake" as const;
  readonly calls: { op: string; args: unknown }[] = [];
  /** the provider-side catalogue: createProduct adds here, tests may seed it to exercise adoption */
  products: ProviderProduct[] = [];
  previewCents = 500;
  private n = 0;
  constructor(readonly mode: Mode = "test") {}
  private rec<T>(op: string, args: unknown, out: T): T {
    this.calls.push({ op, args });
    return out;
  }
  async createCustomer(i: { email: string; name: string; userId: string }) {
    return this.rec("createCustomer", i, { id: `cust_fake_${i.userId.slice(0, 8)}` });
  }
  async createCheckout(i: Parameters<BillingProvider["createCheckout"]>[0]) {
    const checkoutId = `ch_fake_${++this.n}_${randomUUID().slice(0, 8)}`;
    return this.rec("createCheckout", i, {
      checkoutId,
      url: `https://creem.io/test/checkout/${i.productId}/${checkoutId}`,
    });
  }
  async previewChange(i: { subscriptionId: string; productId: string }) {
    return this.rec("previewChange", i, { amountCents: this.previewCents, currency: "USD", estimated: true });
  }
  async changePlan(i: Parameters<BillingProvider["changePlan"]>[0]) {
    this.rec("changePlan", i, null);
  }
  async setCancelAtPeriodEnd(i: { subscriptionId: string; cancel: boolean; reason?: string }) {
    this.rec("setCancelAtPeriodEnd", i, null);
  }
  async portalLink(customerId: string) {
    return this.rec("portalLink", { customerId }, `https://creem.io/test/my-orders/login/fake_${customerId}`);
  }
  async listProducts() {
    return this.rec("listProducts", null, [...this.products]);
  }
  async createProduct(e: CatalogEntry) {
    const id = `prod_fake_${e.key}_${e.amountCents}_${randomUUID().slice(0, 8)}`;
    this.products.push({
      id,
      name: e.name,
      priceCents: e.amountCents,
      currency: "USD",
      billingType: e.kind === "topup" ? "onetime" : "recurring",
      period: e.kind === "topup" ? "once" : e.interval!,
      active: true,
    });
    return this.rec("createProduct", e, { id });
  }
}

let provider: BillingProvider | undefined;
export function setBillingProvider(p: BillingProvider | undefined) {
  provider = p;
}

export function billingMode(): Mode {
  return getEnv().CREEM_ENV === "live_mode" ? "live" : "test";
}

export function getBillingProvider(): BillingProvider {
  if (provider) return provider;
  const env = getEnv();
  if (env.BILLING_PROVIDER === "fake") {
    if (env.NODE_ENV === "production") throw new Error("The fake billing provider cannot run in production");
    return (provider = new FakeProvider(billingMode()));
  }
  if (!env.CREEM_API_KEY) throw new Error("CREEM_API_KEY is not set");
  return (provider = new CreemProvider(env.CREEM_API_KEY, billingMode()));
}
