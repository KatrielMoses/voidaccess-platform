/**
 * The only module that talks to NOWPayments. Everything else depends on CryptoProvider, so tests and e2e run
 * against the fake (CRYPTO_PROVIDER=fake) and production uses the invoice API. The API key is sent as a header
 * and never logged or put in an error message.
 */
import { getEnv } from "../../../env";
import type { Mode } from "../provider";
import { toProviderOrderId } from "./order-ref";

export interface CreateInvoiceInput {
  /** our crypto_orders id; sent as order_id "va_<id>" (see order-ref.ts), which NOWPayments echoes in every IPN */
  orderId: string;
  priceUsd: number;
  description: string;
  ipnCallbackUrl: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CryptoProvider {
  readonly mode: Mode;
  createInvoice(input: CreateInvoiceInput): Promise<{ invoiceId: string; url: string }>;
}

export class CryptoProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CryptoProviderError";
  }
}

export const INVOICE_TIMEOUT_MS = 15_000;

export class NowPaymentsProvider implements CryptoProvider {
  readonly mode: Mode;
  constructor(
    private readonly apiKey: string,
    private readonly base: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.mode = /sandbox/i.test(base) ? "test" : "live";
  }

  async createInvoice(i: CreateInvoiceInput) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), INVOICE_TIMEOUT_MS);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base.replace(/\/$/, "")}/invoice`, {
        method: "POST",
        headers: { "x-api-key": this.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          price_amount: i.priceUsd,
          price_currency: "usd",
          order_id: toProviderOrderId(i.orderId),
          order_description: i.description,
          ipn_callback_url: i.ipnCallbackUrl,
          success_url: i.successUrl,
          cancel_url: i.cancelUrl,
          is_fixed_rate: true,
          is_fee_paid_by_user: false,
        }),
        signal: ctrl.signal,
      });
    } catch (e) {
      const timedOut = e instanceof Error && e.name === "AbortError";
      throw new CryptoProviderError(
        timedOut ? "NOWPayments invoice request timed out" : "NOWPayments invoice request failed",
      );
    } finally {
      clearTimeout(timer);
    }
    const body = (await res.json().catch(() => null)) as {
      id?: string | number;
      invoice_url?: string;
      message?: string;
    } | null;
    if (!res.ok)
      throw new CryptoProviderError(
        `NOWPayments refused the invoice (HTTP ${res.status}${body?.message ? `: ${String(body.message).slice(0, 200)}` : ""})`,
        res.status,
      );
    if (!body || body.id === undefined || body.id === null || typeof body.invoice_url !== "string")
      throw new CryptoProviderError("NOWPayments returned no invoice id or url", res.status);
    return { invoiceId: String(body.id), url: body.invoice_url };
  }
}

/** Never talks to the network. The "hosted page" is our own billing page, as if the payment was sent at once. */
export class FakeCryptoProvider implements CryptoProvider {
  readonly mode: Mode = "test";
  readonly calls: CreateInvoiceInput[] = [];
  fail = false;
  async createInvoice(i: CreateInvoiceInput) {
    this.calls.push(i);
    if (this.fail) throw new CryptoProviderError("fake provider failure");
    const invoiceId = `fake_inv_${i.orderId}`;
    const sep = i.successUrl.includes("?") ? "&" : "?";
    return { invoiceId, url: `${i.successUrl}${sep}invoice=${invoiceId}` };
  }
}

let provider: CryptoProvider | undefined;
export function setCryptoProvider(p: CryptoProvider | undefined) {
  provider = p;
}

export function getCryptoProvider(): CryptoProvider {
  if (provider) return provider;
  const env = getEnv();
  if (env.CRYPTO_PROVIDER === "fake") {
    if (env.NODE_ENV === "production") throw new Error("The fake crypto provider cannot run in production");
    return (provider = new FakeCryptoProvider());
  }
  if (!env.NOWPAYMENTS_API_KEY) throw new Error("NOWPAYMENTS_API_KEY is not set");
  return (provider = new NowPaymentsProvider(env.NOWPAYMENTS_API_KEY, env.NOWPAYMENTS_API_BASE));
}

/** The mode orders are written in and IPNs must match, without building a provider (no key needed). */
export function cryptoMode(): Mode {
  if (provider) return provider.mode;
  const env = getEnv();
  if (env.CRYPTO_PROVIDER === "fake") return "test";
  return /sandbox/i.test(env.NOWPAYMENTS_API_BASE) ? "test" : "live";
}

let enabledOverride: boolean | undefined;
/** Tests only: force the CRYPTO_PAYMENTS switch (undefined = read the env again). */
export function setCryptoEnabled(v: boolean | undefined) {
  enabledOverride = v;
}
export const cryptoEnabled = () => enabledOverride ?? getEnv().CRYPTO_PAYMENTS === "on";
