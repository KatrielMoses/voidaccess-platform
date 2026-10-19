/**
 * Crypto checkout: pay-as-you-go credits and plan passes. The price comes only from @voidaccess/config (top-ups: the
 * same rule as card top-ups, from CRYPTO_TOPUP_MIN_USD), is stored on the order, and is the exact amount the IPN must
 * report before anything is credited.
 */
import { eq } from "drizzle-orm";
import { cryptoPassAllowed, type TopupAmountError } from "@voidaccess/config";
import { cryptoOrders, getDatabase, type Database } from "@voidaccess/db";
import { getEnv } from "../../../env";
import type { Interval } from "../catalog";
import {
  activePass,
  cryptoTopupUsd,
  isInterval,
  isPassPlan,
  liveCardSubscription,
  orderDescription,
  passPriceUsd,
  type PassPlan,
} from "./passes";
import { cryptoEnabled, getCryptoProvider, type CryptoProvider } from "./provider";

export type CryptoCheckoutError =
  | "disabled"
  | "bad_request"
  | "topup_invalid"
  | "plan_invalid"
  | "already_subscribed"
  | "pass_active"
  | "provider_error";

export type CryptoCheckoutInput =
  { kind: "topup"; usd: number } | { kind: "pass"; plan: PassPlan; interval: Interval };

export type CryptoCheckoutResult =
  | { ok: true; url: string; orderId: string }
  | { ok: false; error: CryptoCheckoutError; reason?: TopupAmountError };

export interface CryptoCheckoutDeps {
  provider?: CryptoProvider;
  database?: Database;
  now?: Date;
  /** defaults to CRYPTO_PAYMENTS=on */
  enabled?: boolean;
}

/** Validate an untrusted request body into a checkout input. */
export function parseCryptoCheckout(
  b: unknown,
):
  | { ok: true; input: CryptoCheckoutInput }
  | { ok: false; error: CryptoCheckoutError; reason?: TopupAmountError } {
  if (!b || typeof b !== "object") return { ok: false, error: "bad_request" };
  const o = b as Record<string, unknown>;
  if (o.kind === "topup") {
    const t = cryptoTopupUsd(o.usd);
    return t.ok
      ? { ok: true, input: { kind: "topup", usd: t.usd } }
      : { ok: false, error: "topup_invalid", reason: t.reason };
  }
  if (o.kind === "pass") {
    if (!isPassPlan(o.plan) || !isInterval(o.interval)) return { ok: false, error: "plan_invalid" };
    const passUsd = passPriceUsd(o.plan, o.interval);
    // below the crypto floor (the monthly passes) NOWPayments can't offer the common coins: not sold in crypto
    if (passUsd === null || !cryptoPassAllowed(passUsd)) return { ok: false, error: "plan_invalid" };
    return { ok: true, input: { kind: "pass", plan: o.plan, interval: o.interval } };
  }
  return { ok: false, error: "bad_request" };
}

const urls = () => {
  const base = getEnv().APP_URL.replace(/\/$/, "");
  return {
    ipnCallbackUrl: `${base}/api/webhooks/nowpayments`,
    successUrl: `${base}/billing?crypto=pending`,
    cancelUrl: `${base}/billing?crypto=cancelled`,
  };
};

export async function createCryptoCheckout(
  userId: string,
  input: CryptoCheckoutInput,
  deps: CryptoCheckoutDeps = {},
): Promise<CryptoCheckoutResult> {
  if (!(deps.enabled ?? cryptoEnabled())) return { ok: false, error: "disabled" };
  const parsed = parseCryptoCheckout(input);
  if (!parsed.ok) return parsed;
  const i = parsed.input;
  const provider = deps.provider ?? getCryptoProvider();
  const database = deps.database ?? getDatabase();
  const now = deps.now ?? new Date();
  const priceUsd = i.kind === "topup" ? i.usd : passPriceUsd(i.plan, i.interval)!;

  const created = await database.withSystem(
    "billing.crypto.order",
    async (tx) => {
      if (i.kind === "pass") {
        if (await liveCardSubscription(tx, userId))
          return { ok: false as const, error: "already_subscribed" as const };
        const pass = await activePass(tx, userId, now);
        if (pass && pass.plan !== i.plan) return { ok: false as const, error: "pass_active" as const };
      }
      const [o] = await tx
        .insert(cryptoOrders)
        .values({
          userId,
          mode: provider.mode,
          kind: i.kind,
          plan: i.kind === "pass" ? i.plan : null,
          interval: i.kind === "pass" ? i.interval : null,
          topupUsd: i.kind === "topup" ? i.usd : null,
          priceCents: priceUsd * 100,
        })
        .returning({ id: cryptoOrders.id });
      return { ok: true as const, id: o!.id };
    },
    { audit: false },
  );
  if (!created.ok) return { ok: false, error: created.error };

  let invoice: { invoiceId: string; url: string };
  try {
    invoice = await provider.createInvoice({
      orderId: created.id,
      priceUsd,
      description: orderDescription(i),
      ...urls(),
    });
  } catch (e) {
    console.error("crypto invoice failed", created.id, e instanceof Error ? e.message : "error");
    await database.withSystem(
      "billing.crypto.order.failed",
      (tx) => tx.update(cryptoOrders).set({ status: "failed" }).where(eq(cryptoOrders.id, created.id)),
      { audit: false },
    );
    return { ok: false, error: "provider_error" };
  }
  await database.withSystem(
    "billing.crypto.order.invoice",
    (tx) =>
      tx
        .update(cryptoOrders)
        .set({ providerInvoiceId: invoice.invoiceId })
        .where(eq(cryptoOrders.id, created.id)),
    { audit: false },
  );
  return { ok: true, url: invoice.url, orderId: created.id };
}
