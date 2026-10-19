import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CRYPTO_TOPUP_MIN_USD, PLANS, TOPUP_MAX_USD, TOPUP_MIN_USD, topupCredits } from "@voidaccess/config";
import {
  abuseFlags,
  addMonths,
  billingEvents,
  cryptoOrders,
  getDatabase,
  payments,
  subscriptions,
} from "@voidaccess/db";
import { createCryptoCheckout, type CryptoCheckoutInput } from "@/lib/billing/crypto/checkout";
import { handleNowPaymentsIpn } from "@/lib/billing/crypto/ipn";
import {
  CryptoProviderError,
  FakeCryptoProvider,
  NowPaymentsProvider,
  setCryptoEnabled,
  setCryptoProvider,
} from "@/lib/billing/crypto/provider";
import { canonicalRecursive, canonicalTopLevel, signIpn, verifyIpn } from "@/lib/billing/crypto/signature";
import { applyPendingChanges, endExpiredPasses, runGrants } from "@/lib/billing/cron";
import {
  billingPortal,
  cancelAtPeriodEnd,
  previewPlanChange,
  requestPlanChange,
  resumeSubscription,
} from "@/lib/billing/plan-ops";
import { loadBillingView } from "@/lib/billing/view";
import { POST as cryptoCheckoutPOST } from "@/app/api/billing/crypto/checkout/route";
import { POST as ipnPOST } from "@/app/api/webhooks/nowpayments/route";
import { POST as portalPOST } from "@/app/api/billing/portal/route";
import { asUser, sameOrigin } from "./helpers";
import {
  DAY,
  addDays,
  deliver,
  grantBalance,
  ledger,
  makeBillingUser,
  planOf,
  provider as cardProvider,
  setupBilling,
  subRows,
  subSnapshot,
} from "./billing-helpers";

const SECRET = process.env.NOWPAYMENTS_IPN_SECRET!;
/** the smallest crypto top-up (pay-as-you-go, same rule as card top-ups) */
const MIN = CRYPTO_TOPUP_MIN_USD;
const db = () => getDatabase();
const crypto = new FakeCryptoProvider();
let pid = 0;
const paymentId = () => 5_000_000_000 + Date.now() * 10 + ++pid;

beforeAll(async () => {
  await setupBilling();
  setCryptoProvider(crypto);
});
afterEach(() => setCryptoEnabled(undefined));

async function order(userId: string, input: CryptoCheckoutInput, now = new Date()) {
  const r = await createCryptoCheckout(userId, input, { provider: crypto, now });
  if (!r.ok) throw new Error(`checkout failed: ${r.error}`);
  return r.orderId;
}

async function orderRow(id: string) {
  const [o] = await db().withSystem(
    "t",
    (tx) => tx.select().from(cryptoOrders).where(eq(cryptoOrders.id, id)),
    { audit: false },
  );
  return o!;
}

function ipnBody(o: {
  orderId: string;
  /** the order_id exactly as sent; default "va_<orderId>" like our invoices */
  rawOrderId?: unknown;
  status: string;
  paymentId: number;
  usd: number;
  currency?: string;
  invoiceId?: string;
}) {
  return {
    payment_id: o.paymentId,
    invoice_id: o.invoiceId ?? null,
    payment_status: o.status,
    pay_address: "test-address",
    price_amount: o.usd,
    price_currency: o.currency ?? "usd",
    pay_amount: 0.0001,
    actually_paid: o.status === "finished" ? 0.0001 : 0,
    pay_currency: "btc",
    order_id: o.rawOrderId === undefined ? `va_${o.orderId}` : o.rawOrderId,
    order_description: "test",
    purchase_id: 4000000001,
    created_at: "2026-10-16T10:00:00.000Z",
    updated_at: "2026-10-16T10:05:00.000Z",
    outcome_amount: 0.0001,
    outcome_currency: "btc",
  };
}

function ipn(
  body: Record<string, unknown>,
  opts: { now?: Date; secret?: string; sig?: string | null; raw?: string } = {},
) {
  const raw = opts.raw ?? JSON.stringify(body);
  const headers = new Headers();
  const sig = opts.sig === undefined ? signIpn(opts.secret ?? SECRET, body) : opts.sig;
  if (sig !== null) headers.set("x-nowpayments-sig", sig);
  return handleNowPaymentsIpn(raw, headers, { now: () => opts.now ?? new Date() });
}

const topupBalance = async (userId: string) =>
  (await ledger(userId)).filter((r) => r.bucket === "topup").reduce((a, r) => a + r.amount, 0);

const flags = (userId: string) =>
  db().withSystem("t", (tx) => tx.select().from(abuseFlags).where(eq(abuseFlags.userId, userId)), {
    audit: false,
  });

async function cardSubscriber(plan: "pro" | "pro_plus" = "pro") {
  const u = await makeBillingUser();
  const now = new Date();
  await deliver(
    "subscription.active",
    await subSnapshot({
      user: u,
      subId: `sub_c${Date.now()}_${++pid}`,
      key: `${plan}_month`,
      periodStart: now,
      periodEnd: addDays(now, 30),
    }),
    { at: now },
  );
  return u;
}

/** A user holding a paid crypto pass, bought now. */
async function passHolder(plan: "pro" | "pro_plus" = "pro", interval: "month" | "year" = "month") {
  const u = await makeBillingUser();
  // Only annual passes are sold in crypto (the monthly ones sit below NOWPayments' coin minimums). The IPN still
  // handles a monthly pass order, so lifecycle tests create one directly.
  const id =
    interval === "year"
      ? await order(u.id, { kind: "pass", plan, interval })
      : (
          await db().withSystem(
            "t",
            (tx) =>
              tx
                .insert(cryptoOrders)
                .values({
                  userId: u.id,
                  mode: "test",
                  kind: "pass",
                  plan,
                  interval,
                  priceCents: PLANS[plan].monthlyUsd * 100,
                })
                .returning({ id: cryptoOrders.id }),
            { audit: false },
          )
        )[0]!.id;
  const usd = interval === "year" ? PLANS[plan].annualUsd! : PLANS[plan].monthlyUsd;
  const r = await ipn(ipnBody({ orderId: id, status: "finished", paymentId: paymentId(), usd }));
  expect(r.body.outcome).toBe("applied");
  return { u, orderId: id };
}

describe("IPN signature", () => {
  const nested = { b: 2, a: "x", fee: { depositFee: 0, currency: "btc", a: 1 } };

  it("accepts the recursive and the top-level sorted forms, and they really differ for nested bodies", () => {
    expect(canonicalRecursive(nested)).not.toBe(canonicalTopLevel(nested));
    const raw = JSON.stringify(nested);
    for (const form of ["recursive", "top-level"] as const) {
      const h = new Headers({ "x-nowpayments-sig": signIpn(SECRET, nested, form) });
      expect(verifyIpn(SECRET, h, raw).ok, form).toBe(true);
    }
    // key order in the raw body doesn't matter: the signature is over the sorted form
    const reordered = JSON.stringify({ fee: nested.fee, a: "x", b: 2 });
    expect(
      verifyIpn(SECRET, new Headers({ "x-nowpayments-sig": signIpn(SECRET, nested) }), reordered).ok,
    ).toBe(true);
  });

  it("rejects a tampered body, a wrong secret, a missing or malformed header; a missing secret is 503", async () => {
    const raw = JSON.stringify(nested);
    const good = signIpn(SECRET, nested);
    expect(
      verifyIpn(SECRET, new Headers({ "x-nowpayments-sig": good }), raw.replace('"x"', '"y"')),
    ).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(
      verifyIpn(SECRET, new Headers({ "x-nowpayments-sig": signIpn("another-secret-xx", nested) }), raw),
    ).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(verifyIpn(SECRET, new Headers(), raw)).toMatchObject({ ok: false, reason: "missing_signature" });
    expect(verifyIpn(SECRET, new Headers({ "x-nowpayments-sig": "zz-not-hex" }), raw)).toMatchObject({
      ok: false,
      reason: "bad_signature",
    });
    expect(verifyIpn(SECRET, new Headers({ "x-nowpayments-sig": good.slice(0, 20) }), raw)).toMatchObject({
      ok: false,
      reason: "bad_signature",
    });
    expect(verifyIpn(undefined, new Headers({ "x-nowpayments-sig": good }), raw)).toMatchObject({
      ok: false,
      reason: "no_secret",
    });

    // through the handler: 503 without a secret, 400 for bad or missing signatures, nothing applied
    const u = await makeBillingUser();
    const id = await order(u.id, { kind: "topup", usd: MIN });
    const body = ipnBody({ orderId: id, status: "finished", paymentId: paymentId(), usd: MIN });
    const noSecret = await handleNowPaymentsIpn(
      JSON.stringify(body),
      new Headers({ "x-nowpayments-sig": signIpn(SECRET, body) }),
      { secret: "" },
    );
    expect(noSecret.status).toBe(503);
    expect((await ipn(body, { sig: null })).status).toBe(400);
    expect((await ipn(body, { secret: "wrong-secret-0000" })).status).toBe(400);
    expect((await ipn(body, { raw: JSON.stringify({ ...body, price_amount: 1 }) })).status).toBe(400);
    expect(await topupBalance(u.id)).toBe(0);
  });
});

describe("crypto checkout", () => {
  it("creates an order at the config price and an invoice with our callback, return urls and order id", async () => {
    const u = await makeBillingUser();
    crypto.calls.length = 0;
    const r = await createCryptoCheckout(
      u.id,
      { kind: "pass", plan: "pro_plus", interval: "year" },
      { provider: crypto },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const call = crypto.calls[0]!;
    expect(call.orderId).toBe(r.orderId);
    expect(call.priceUsd).toBe(PLANS.pro_plus.annualUsd);
    expect(call.ipnCallbackUrl).toBe("http://localhost:3000/api/webhooks/nowpayments");
    expect(call.successUrl).toBe("http://localhost:3000/billing?crypto=pending");
    expect(call.cancelUrl).toBe("http://localhost:3000/billing?crypto=cancelled");
    const o = await orderRow(r.orderId);
    expect(o).toMatchObject({
      userId: u.id,
      mode: "test",
      kind: "pass",
      plan: "pro_plus",
      interval: "year",
      topupUsd: null,
      priceCents: PLANS.pro_plus.annualUsd! * 100,
      status: "created",
      providerInvoiceId: `fake_inv_${r.orderId}`,
    });
    expect(r.url).toContain("/billing?crypto=pending");
  });

  it("refuses a bad amount or plan, a pass while a card subscription is live, and a pass for another plan while one is active", async () => {
    const u = await makeBillingUser();
    for (const bad of [
      { kind: "topup", usd: 7 },
      { kind: "topup", usd: "10" },
      { kind: "pass", plan: "free", interval: "month" },
      { kind: "pass", plan: "pro", interval: "week" },
      { kind: "subscription", plan: "pro", interval: "month" },
    ])
      expect(
        (await createCryptoCheckout(u.id, bad as never, { provider: crypto })).ok,
        JSON.stringify(bad),
      ).toBe(false);
    expect(await createCryptoCheckout(u.id, { kind: "topup", usd: 7 }, { provider: crypto })).toMatchObject({
      ok: false,
      error: "topup_invalid",
    });
    expect(
      await createCryptoCheckout(
        u.id,
        { kind: "pass", plan: "free" as never, interval: "month" },
        { provider: crypto },
      ),
    ).toMatchObject({ ok: false, error: "plan_invalid" });
    // monthly passes ($9, $19) are below the crypto floor: not sold in crypto; the annual ones are
    for (const plan of ["pro", "pro_plus"] as const)
      expect(
        await createCryptoCheckout(u.id, { kind: "pass", plan, interval: "month" }, { provider: crypto }),
      ).toMatchObject({ ok: false, error: "plan_invalid" });
    expect((await loadBillingView(u.id, "free")).crypto.passes.map((p) => `${p.plan}:${p.interval}`)).toEqual(
      ["pro:year", "pro_plus:year"],
    );

    const card = await cardSubscriber();
    expect(
      await createCryptoCheckout(
        card.id,
        { kind: "pass", plan: "pro", interval: "year" },
        { provider: crypto },
      ),
    ).toEqual({ ok: false, error: "already_subscribed" });
    // a card subscriber can still buy credits with crypto
    expect((await createCryptoCheckout(card.id, { kind: "topup", usd: MIN }, { provider: crypto })).ok).toBe(
      true,
    );

    const { u: holder } = await passHolder("pro");
    expect(
      await createCryptoCheckout(
        holder.id,
        { kind: "pass", plan: "pro_plus", interval: "year" },
        { provider: crypto },
      ),
    ).toEqual({ ok: false, error: "pass_active" });
    expect(
      (
        await createCryptoCheckout(
          holder.id,
          { kind: "pass", plan: "pro", interval: "year" },
          { provider: crypto },
        )
      ).ok,
    ).toBe(true);
  });

  it("the route: 404 when switched off, same-origin and a session required, 409 with the message for pass_active", async () => {
    const u = await makeBillingUser();
    const mk = (body: unknown, headers: Record<string, string> = sameOrigin) =>
      new Request("http://localhost/api/billing/crypto/checkout", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    const topupReq = { kind: "topup", usd: MIN };

    setCryptoEnabled(false);
    asUser(u.session);
    expect((await cryptoCheckoutPOST(mk(topupReq))).status).toBe(404);
    expect((await createCryptoCheckout(u.id, topupReq as never, { provider: crypto })).ok).toBe(false);
    setCryptoEnabled(true);

    asUser(null);
    expect(
      (await cryptoCheckoutPOST(mk(topupReq, { ...sameOrigin, "sec-fetch-site": "cross-site" }))).status,
    ).toBe(403);
    expect((await cryptoCheckoutPOST(mk(topupReq))).status).toBe(401);
    asUser(u.session);
    const ok = await cryptoCheckoutPOST(mk(topupReq));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { url: string }).url).toContain("crypto=pending");
    expect((await cryptoCheckoutPOST(mk({ kind: "topup", usd: 3 }))).status).toBe(400);

    const card = await cardSubscriber();
    asUser(card.session);
    const sub = await cryptoCheckoutPOST(mk({ kind: "pass", plan: "pro", interval: "year" }));
    expect(sub.status).toBe(409);
    expect(await sub.json()).toMatchObject({ error: "already_subscribed" });

    const { u: holder } = await passHolder("pro");
    asUser(holder.session);
    const other = await cryptoCheckoutPOST(mk({ kind: "pass", plan: "pro_plus", interval: "year" }));
    expect(other.status).toBe(409);
    expect(await other.json()).toMatchObject({
      error: "pass_active",
      message: expect.stringMatching(/after/),
    });
    asUser(null);
  });

  it("an invoice failure marks the order failed and answers provider_error", async () => {
    const u = await makeBillingUser();
    crypto.fail = true;
    try {
      const r = await createCryptoCheckout(u.id, { kind: "topup", usd: MIN }, { provider: crypto });
      expect(r).toEqual({ ok: false, error: "provider_error" });
    } finally {
      crypto.fail = false;
    }
    const rows = await db().withSystem(
      "t",
      (tx) => tx.select().from(cryptoOrders).where(eq(cryptoOrders.userId, u.id)),
      { audit: false },
    );
    expect(rows.map((o) => o.status)).toEqual(["failed"]);
  });
});

describe("NOWPayments invoice API", () => {
  it("posts the documented invoice body with the x-api-key header and returns id and url; errors never carry the key", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const ok: typeof fetch = async (url, init) => {
      seen.push({ url: String(url), init: init! });
      return new Response(
        JSON.stringify({ id: 1234567, invoice_url: "https://nowpayments.io/payment/?iid=1234567" }),
        {
          status: 200,
        },
      );
    };
    const p = new NowPaymentsProvider("np-key-for-tests", "https://api-sandbox.nowpayments.io/v1/", ok);
    expect(p.mode).toBe("test");
    expect(new NowPaymentsProvider("k", "https://api.nowpayments.io/v1").mode).toBe("live");
    const inv = await p.createInvoice({
      orderId: "00000000-0000-4000-8000-000000000001",
      priceUsd: MIN,
      description: "d",
      ipnCallbackUrl: "https://app.example/api/webhooks/nowpayments",
      successUrl: "https://app.example/billing?crypto=pending",
      cancelUrl: "https://app.example/billing?crypto=cancelled",
    });
    expect(inv).toEqual({ invoiceId: "1234567", url: "https://nowpayments.io/payment/?iid=1234567" });
    expect(seen[0]!.url).toBe("https://api-sandbox.nowpayments.io/v1/invoice");
    expect((seen[0]!.init.headers as Record<string, string>)["x-api-key"]).toBe("np-key-for-tests");
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({
      price_amount: MIN,
      price_currency: "usd",
      order_id: "va_00000000-0000-4000-8000-000000000001",
      order_description: "d",
      ipn_callback_url: "https://app.example/api/webhooks/nowpayments",
      success_url: "https://app.example/billing?crypto=pending",
      cancel_url: "https://app.example/billing?crypto=cancelled",
      is_fixed_rate: true,
      is_fee_paid_by_user: false,
    });

    const refused = new NowPaymentsProvider(
      "np-key-for-tests",
      "https://api.nowpayments.io/v1",
      async () => new Response(JSON.stringify({ message: "Invalid api key" }), { status: 403 }),
    );
    const input = {
      orderId: "o",
      priceUsd: 1,
      description: "d",
      ipnCallbackUrl: "u",
      successUrl: "u",
      cancelUrl: "u",
    };
    const err = await refused.createInvoice(input).catch((e) => e);
    expect(err).toBeInstanceOf(CryptoProviderError);
    expect(String(err.message)).toContain("403");
    expect(String(err.message)).not.toContain("np-key-for-tests");
    const down = new NowPaymentsProvider("np-key-for-tests", "https://api.nowpayments.io/v1", async () => {
      throw new Error("ECONNREFUSED np-key-for-tests");
    });
    const e2 = await down.createInvoice(input).catch((e) => e);
    expect(e2).toBeInstanceOf(CryptoProviderError);
    expect(String(e2.message)).not.toContain("np-key-for-tests");
  });
});

describe("IPN: credits", () => {
  it("finished credits the top-up once (with the subscriber bonus); a duplicate and a re-sent finished under a new payment id don't double-credit", async () => {
    const u = await makeBillingUser("pro");
    const usd = 25;
    const id = await order(u.id, { kind: "topup", usd });
    const pay = paymentId();
    const inv = (await orderRow(id)).providerInvoiceId!;

    for (const status of ["waiting", "confirming", "confirmed", "sending"]) {
      const r = await ipn(ipnBody({ orderId: id, status, paymentId: pay, usd, invoiceId: inv }));
      expect(r.body.outcome, status).toBe("status_updated");
    }
    expect(await topupBalance(u.id)).toBe(0);

    const fin = ipnBody({ orderId: id, status: "finished", paymentId: pay, usd, invoiceId: inv });
    const first = await ipn(fin);
    expect(first.status).toBe(200);
    expect(first.body.outcome).toBe("applied");
    expect(first.post).toEqual([{ kind: "topup_purchased", userId: u.id, usd }]);
    const credited = topupCredits(usd, "pro");
    expect(await topupBalance(u.id)).toBe(credited);

    expect((await ipn(fin)).body.outcome).toBe("duplicate");
    const again = await ipn({ ...fin, payment_id: paymentId() });
    expect(again.body.outcome).toBe("ignored");
    expect(await topupBalance(u.id)).toBe(credited);
    // the second finished payment is real money: it is flagged for review
    expect((await flags(u.id)).map((f) => f.kind)).toContain("billing_crypto_review");
    // a late lower status doesn't regress the order
    await ipn(ipnBody({ orderId: id, status: "confirming", paymentId: pay, usd }));
    const o = await orderRow(id);
    expect(o.status).toBe("finished");
    expect(o.appliedAt).not.toBeNull();
    expect(o.providerPaymentId).toBe(String(pay));
    const pays = await db().withSystem(
      "t",
      (tx) => tx.select().from(payments).where(eq(payments.userId, u.id)),
      { audit: false },
    );
    expect(pays).toHaveLength(1);
    expect(pays[0]).toMatchObject({ provider: "nowpayments", kind: "topup", amountCents: usd * 100 });

    // a refund after credit only flags; nothing is clawed back
    expect((await ipn(ipnBody({ orderId: id, status: "refunded", paymentId: pay, usd }))).body.outcome).toBe(
      "status_updated",
    );
    expect(await topupBalance(u.id)).toBe(credited);
    expect((await orderRow(id)).status).toBe("refunded");
    expect((await flags(u.id)).map((f) => f.kind)).toContain("billing_refund");
  });

  it("partially_paid, failed and expired credit nothing", async () => {
    const u = await makeBillingUser();
    const usd = MIN;
    for (const status of ["partially_paid", "failed", "expired"]) {
      const id = await order(u.id, { kind: "topup", usd });
      const r = await ipn(ipnBody({ orderId: id, status, paymentId: paymentId(), usd }));
      expect(r.body.outcome, status).toBe("status_updated");
      expect((await orderRow(id)).status).toBe(status);
      expect((await orderRow(id)).appliedAt).toBeNull();
    }
    expect(await topupBalance(u.id)).toBe(0);
  });

  it("rejects (200, no credit) a wrong amount, a wrong currency, an unknown order and another mode; mismatches are flagged", async () => {
    const u = await makeBillingUser();
    const usd = MIN;
    const id = await order(u.id, { kind: "topup", usd });
    for (const body of [
      ipnBody({ orderId: id, status: "finished", paymentId: paymentId(), usd: usd - 1 }),
      ipnBody({ orderId: id, status: "finished", paymentId: paymentId(), usd: usd + 0.001 }),
      ipnBody({ orderId: id, status: "finished", paymentId: paymentId(), usd, currency: "eur" }),
      ipnBody({ orderId: id, status: "finished", paymentId: paymentId(), usd, invoiceId: "someone-elses" }),
    ]) {
      const r = await ipn(body);
      expect(r.status).toBe(200);
      expect(r.body.outcome).toBe("rejected");
    }
    {
      const r = await ipn(
        ipnBody({
          orderId: "00000000-0000-4000-8000-00000000dead",
          status: "finished",
          paymentId: paymentId(),
          usd,
        }),
      );
      expect(r.status).toBe(200);
      expect(r.body.outcome).toBe("rejected");
    }
    const body = ipnBody({ orderId: id, status: "finished", paymentId: paymentId(), usd });
    const liveMode = await handleNowPaymentsIpn(
      JSON.stringify(body),
      new Headers({ "x-nowpayments-sig": signIpn(SECRET, body) }),
      { mode: "live" },
    );
    expect(liveMode.body.outcome).toBe("rejected");
    expect(await topupBalance(u.id)).toBe(0);
    expect((await orderRow(id)).appliedAt).toBeNull();
    const kinds = (await flags(u.id)).map((f) => f.kind);
    expect(kinds.filter((k) => k === "billing_crypto_mismatch").length).toBeGreaterThanOrEqual(5);
  });

  it("only VoidAccess orders: a signed IPN without the va_ prefix (e.g. MailAccess's ma_) is refused untouched", async () => {
    const u = await makeBillingUser();
    const usd = MIN;
    const id = await order(u.id, { kind: "topup", usd });
    for (const rawOrderId of [`ma_${id}`, id, `VA_${id}`, "va_not-a-uuid", `va_${id}x`, 42, null]) {
      const pid = paymentId();
      const r = await ipn(ipnBody({ orderId: id, rawOrderId, status: "finished", paymentId: pid, usd }));
      expect(r.status, String(rawOrderId)).toBe(403);
      expect(r.body).toEqual({ ok: false, reason: "not_a_voidaccess_order" });
      const events = await db().withSystem(
        "t",
        (tx) =>
          tx
            .select()
            .from(billingEvents)
            .where(eq(billingEvents.eventId, `${pid}:finished`)),
        { audit: false },
      );
      expect(events).toHaveLength(0);
    }
    expect(await topupBalance(u.id)).toBe(0);
    expect((await orderRow(id)).appliedAt).toBeNull();
    // the same order with the va_ prefix is ours and is applied
    const ok = await ipn(ipnBody({ orderId: id, status: "finished", paymentId: paymentId(), usd }));
    expect(ok.body.outcome).toBe("applied");
  });

  it("switched off: a verified IPN is acknowledged and ignored; the route reads the raw body", async () => {
    const u = await makeBillingUser();
    const usd = MIN;
    const id = await order(u.id, { kind: "topup", usd });
    const body = ipnBody({ orderId: id, status: "finished", paymentId: paymentId(), usd });
    const req = (sig: string) =>
      new Request("http://localhost/api/webhooks/nowpayments", {
        method: "POST",
        headers: { "content-type": "application/json", "x-nowpayments-sig": sig },
        body: JSON.stringify(body),
      });
    setCryptoEnabled(false);
    const off = await ipnPOST(req(signIpn(SECRET, body)));
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({ outcome: "ignored" });
    expect((await ipnPOST(req("00"))).status).toBe(400);
    expect(await topupBalance(u.id)).toBe(0);
    setCryptoEnabled(true);
    const on = await ipnPOST(req(signIpn(SECRET, body)));
    expect(await on.json()).toMatchObject({ outcome: "applied" });
    expect(await topupBalance(u.id)).toBe(topupCredits(usd, "free"));
  });
});

describe("IPN: plan passes", () => {
  it("a finished pass sets the plan, grants the month's credits, writes an ending subscription row and a payment", async () => {
    const { u, orderId } = await passHolder("pro", "month");
    expect(await planOf(u.id)).toBe("pro");
    expect(await grantBalance(u.id)).toBe(PLANS.pro.monthlyCredits);
    const [s] = await subRows(u.id);
    expect(s).toMatchObject({
      provider: "nowpayments",
      providerSubscriptionId: orderId,
      plan: "pro",
      interval: "month",
      status: "active",
      productKey: "pro_month",
    });
    expect(s!.cancelAt?.getTime()).toBe(s!.currentPeriodEnd?.getTime());
    expect(s!.currentPeriodEnd!.getTime()).toBe(addMonths(s!.currentPeriodStart!, 1).getTime());
    const pays = await db().withSystem(
      "t",
      (tx) => tx.select().from(payments).where(eq(payments.userId, u.id)),
      { audit: false },
    );
    expect(pays).toMatchObject([
      {
        provider: "nowpayments",
        kind: "subscription",
        subscriptionId: s!.id,
        amountCents: PLANS.pro.monthlyUsd * 100,
      },
    ]);
    const view = await loadBillingView(u.id, "pro");
    expect(view.sub).toMatchObject({ plan: "pro", cryptoPass: true });
    expect(view.crypto.enabled).toBe(true);
  });

  it("buying the same plan again extends the pass from its current end, without a second grant this month", async () => {
    const { u } = await passHolder("pro", "month");
    const [before] = await subRows(u.id);
    const id = await order(u.id, { kind: "pass", plan: "pro", interval: "year" });
    const r = await ipn(
      ipnBody({ orderId: id, status: "finished", paymentId: paymentId(), usd: PLANS.pro.annualUsd! }),
    );
    expect(r.body.outcome).toBe("applied");
    const rows = await subRows(u.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.currentPeriodEnd!.getTime()).toBe(addMonths(before!.currentPeriodEnd!, 12).getTime());
    expect(rows[0]!.cancelAt!.getTime()).toBe(rows[0]!.currentPeriodEnd!.getTime());
    expect(await grantBalance(u.id)).toBe(PLANS.pro.monthlyCredits);
    expect((await ledger(u.id)).filter((l) => l.reason === "grant" && l.amount > 0)).toHaveLength(1);
  });

  it("a pass for another plan paid while one is active is not applied, only flagged", async () => {
    const { u } = await passHolder("pro", "month");
    // two orders can be created before either is paid: simulate the second one directly
    const [o] = await db().withSystem(
      "t",
      (tx) =>
        tx
          .insert(cryptoOrders)
          .values({
            userId: u.id,
            mode: "test",
            kind: "pass",
            plan: "pro_plus",
            interval: "month",
            priceCents: PLANS.pro_plus.monthlyUsd * 100,
          })
          .returning(),
      { audit: false },
    );
    const r = await ipn(
      ipnBody({ orderId: o!.id, status: "finished", paymentId: paymentId(), usd: PLANS.pro_plus.monthlyUsd }),
    );
    expect(r.body.outcome).toBe("rejected");
    expect(await planOf(u.id)).toBe("pro");
    expect((await orderRow(o!.id)).appliedAt).toBeNull();
    expect((await flags(u.id)).map((f) => f.kind)).toContain("billing_crypto_review");
  });

  it("cron: passes get a monthly grant while they last, and an ended pass moves the user to Free", async () => {
    const { u } = await passHolder("pro_plus", "year");
    expect(await grantBalance(u.id)).toBe(PLANS.pro_plus.monthlyCredits);
    // a month after the purchase grant
    const now = addDays(new Date(), 33);
    await runGrants(now, { database: db() });
    const grants = (await ledger(u.id)).filter((l) => l.reason === "grant" && l.amount > 0);
    expect(grants).toHaveLength(2);
    await runGrants(now, { database: db() });
    expect((await ledger(u.id)).filter((l) => l.reason === "grant" && l.amount > 0)).toHaveLength(2);

    // the pass is still running: nothing ends
    expect(await endExpiredPasses(now, db())).toBe(0);
    const later = addMonths(now, 13);
    expect(await endExpiredPasses(later, db())).toBeGreaterThanOrEqual(1);
    expect(await planOf(u.id)).toBe("free");
    expect((await subRows(u.id))[0]!.status).toBe("expired");
    expect(
      (await ledger(u.id)).some((l) => l.reason === "grant" && l.amount === PLANS.free.monthlyCredits),
    ).toBe(true);
    expect(await endExpiredPasses(later, db())).toBe(0);
  });

  it("a monthly pass ends after its month, via runGrants", async () => {
    const { u } = await passHolder("pro", "month");
    const r = await runGrants(addDays(new Date(), 32), { database: db() });
    expect(r.endedPasses).toBeGreaterThanOrEqual(1);
    expect(await planOf(u.id)).toBe("free");
  });

  it("plan-ops never reach the card provider for a crypto pass", async () => {
    const { u } = await passHolder("pro", "month");
    cardProvider.calls.length = 0;
    expect(
      await previewPlanChange(u.id, { plan: "pro_plus", interval: "month" }, { provider: cardProvider }),
    ).toEqual({
      ok: false,
      error: "not_supported",
    });
    expect(
      await requestPlanChange(u.id, { plan: "pro_plus", interval: "month" }, { provider: cardProvider }),
    ).toEqual({
      ok: false,
      error: "not_supported",
    });
    expect(await cancelAtPeriodEnd(u.id, "x", { provider: cardProvider })).toMatchObject({
      ok: false,
      error: "not_supported",
    });
    expect(await resumeSubscription(u.id, { provider: cardProvider })).toEqual({
      ok: false,
      error: "not_supported",
    });
    let portalCalled = false;
    expect(
      await billingPortal(u.id, {
        portal: async () => {
          portalCalled = true;
          return "x";
        },
      }),
    ).toEqual({ ok: false, error: "not_supported" });
    expect(portalCalled).toBe(false);
    asUser(u.session);
    expect(
      (
        await portalPOST(
          new Request("http://localhost/api/billing/portal", { method: "POST", headers: sameOrigin }),
        )
      ).status,
    ).toBe(409);
    asUser(null);
    // a pending change can't be on a pass, but even if one were, the cron would never send it to the card provider
    await db().withSystem(
      "t",
      (tx) =>
        tx
          .update(subscriptions)
          .set({ pendingProductKey: "pro_month", pendingEffectiveAt: new Date(), pendingRequestedAt: null })
          .where(eq(subscriptions.userId, u.id)),
      { audit: false },
    );
    await applyPendingChanges(new Date(Date.now() + DAY), { database: db(), provider: cardProvider });
    expect(cardProvider.calls.filter((c) => JSON.stringify(c.args).includes(u.id))).toEqual([]);
    const [s] = await subRows(u.id);
    expect(s!.pendingRequestedAt).toBeNull();
    expect(
      cardProvider.calls.some(
        (c) => (c.args as { subscriptionId?: string }).subscriptionId === s!.providerSubscriptionId,
      ),
    ).toBe(false);
  });
});

describe("crypto top-ups: the shared pay-as-you-go rule, with the crypto minimum", () => {
  it("the crypto minimum sits above the card minimum and is what the billing page shows", async () => {
    expect(CRYPTO_TOPUP_MIN_USD).toBe(25);
    expect(CRYPTO_TOPUP_MIN_USD).toBeGreaterThanOrEqual(TOPUP_MIN_USD);
    const u = await makeBillingUser();
    expect((await loadBillingView(u.id, "free")).crypto).toMatchObject({ enabled: true, minTopupUsd: 25 });
  });

  it("refuses below the crypto minimum, fractions, non-numbers and above the shared maximum, with the reason", async () => {
    const u = await makeBillingUser();
    const cases: [unknown, string][] = [
      [24, "below_minimum"],
      [10, "below_minimum"],
      [TOPUP_MIN_USD, "below_minimum"], // fine by card, not by crypto
      [0, "below_minimum"],
      [-10, "below_minimum"],
      [10.5, "not_whole_dollars"],
      ["10", "not_whole_dollars"],
      [null, "not_whole_dollars"],
      [TOPUP_MAX_USD + 1, "above_maximum"],
    ];
    for (const [usd, reason] of cases)
      expect(
        await createCryptoCheckout(u.id, { kind: "topup", usd } as never, { provider: crypto }),
        String(usd),
      ).toEqual({ ok: false, error: "topup_invalid", reason });
    // nothing was written for any refused amount
    const rows = await db().withSystem(
      "t",
      (tx) => tx.select().from(cryptoOrders).where(eq(cryptoOrders.userId, u.id)),
      { audit: false },
    );
    expect(rows).toEqual([]);
    // the route says why
    asUser(u.session);
    const r = await cryptoCheckoutPOST(
      new Request("http://localhost/api/billing/crypto/checkout", {
        method: "POST",
        headers: sameOrigin,
        body: JSON.stringify({ kind: "topup", usd: 24 }),
      }),
    );
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "topup_invalid", reason: "below_minimum" });
    asUser(null);
    expect(
      (await createCryptoCheckout(u.id, { kind: "topup", usd: TOPUP_MAX_USD }, { provider: crypto })).ok,
    ).toBe(true);
  });

  it("$25, $50 and $100 are invoiced and credited exactly per topupCredits(), volume and subscriber bonus included", async () => {
    // explicit numbers so a change to the shared rule shows up here too
    const expected = {
      free: { 25: 2750, 50: 6000, 100: 12000 },
      pro: { 25: 3300, 50: 7200, 100: 14400 },
      pro_plus: { 25: 3575, 50: 7800, 100: 15600 },
    } as const;
    for (const plan of ["free", "pro", "pro_plus"] as const) {
      const u = await makeBillingUser(plan);
      let total = 0;
      for (const usd of [25, 50, 100] as const) {
        crypto.calls.length = 0;
        const id = await order(u.id, { kind: "topup", usd });
        expect(crypto.calls[0]!.priceUsd).toBe(usd);
        expect((await orderRow(id)).priceCents).toBe(usd * 100);
        const r = await ipn(ipnBody({ orderId: id, status: "finished", paymentId: paymentId(), usd }));
        expect(r.body.outcome, `${plan} $${usd}`).toBe("applied");
        expect(topupCredits(usd, plan)).toBe(expected[plan][usd]);
        total += expected[plan][usd];
        expect(await topupBalance(u.id), `${plan} $${usd}`).toBe(total);
      }
    }
  });

  it("the IPN still requires the exact order amount: $10.00 paid for a $25 order credits nothing", async () => {
    const u = await makeBillingUser("pro");
    const id = await order(u.id, { kind: "topup", usd: 25 });
    const r = await ipn(ipnBody({ orderId: id, status: "finished", paymentId: paymentId(), usd: 10 }));
    expect(r.body.outcome).toBe("rejected");
    expect(await topupBalance(u.id)).toBe(0);
    const ok = await ipn(
      ipnBody({ orderId: id, status: "finished", paymentId: paymentId(), usd: "25.00" as never }),
    );
    expect(ok.body.outcome).toBe("applied");
    expect(await topupBalance(u.id)).toBe(topupCredits(25, "pro"));
  });
});

describe("event keying (billing_events by provider, mode, event id)", () => {
  it("a crypto event is stored as provider nowpayments in the crypto mode, and can't collide with a Creem event of the same id", async () => {
    const u = await makeBillingUser();
    const id = await order(u.id, { kind: "topup", usd: MIN });
    const pid = paymentId();
    const sharedId = `${pid}:finished`;
    // a Creem event that happens to carry exactly the crypto event id
    const creem = await deliver("credits.granted", { mode: "test" }, { id: sharedId });
    expect(creem.status).toBe(200);
    expect(creem.body.outcome).toBe("ignored");
    // the crypto IPN with that id is processed, not taken for a duplicate
    const r = await ipn(ipnBody({ orderId: id, status: "finished", paymentId: pid, usd: MIN }));
    expect(r.body.outcome).toBe("applied");
    expect(await topupBalance(u.id)).toBe(topupCredits(MIN, "free"));
    // and the Creem event re-delivered is still a Creem duplicate, the IPN re-delivered an IPN duplicate
    expect((await deliver("credits.granted", { mode: "test" }, { id: sharedId })).body.outcome).toBe(
      "duplicate",
    );
    expect(
      (await ipn(ipnBody({ orderId: id, status: "finished", paymentId: pid, usd: MIN }))).body.outcome,
    ).toBe("duplicate");
    const rows = await db().withSystem(
      "t",
      (tx) => tx.select().from(billingEvents).where(eq(billingEvents.eventId, sharedId)),
      { audit: false },
    );
    expect(rows.map((e) => [e.provider, e.mode, e.type, e.outcome]).sort()).toEqual([
      ["creem", "test", "credits.granted", "ignored"],
      ["nowpayments", "test", "nowpayments.finished", "applied"],
    ]);
  });
});

describe("shared NOWPayments account", () => {
  it("the webhook route refuses a validly signed MailAccess (ma_) callback with 403 and writes nothing", async () => {
    const u = await makeBillingUser();
    const id = await order(u.id, { kind: "topup", usd: MIN });
    const pid = paymentId();
    const body = ipnBody({
      orderId: id,
      rawOrderId: `ma_${id}`,
      status: "finished",
      paymentId: pid,
      usd: MIN,
    });
    const res = await ipnPOST(
      new Request("http://localhost/api/webhooks/nowpayments", {
        method: "POST",
        headers: { "content-type": "application/json", "x-nowpayments-sig": signIpn(SECRET, body) },
        body: JSON.stringify(body),
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, reason: "not_a_voidaccess_order" });
    const events = await db().withSystem(
      "t",
      (tx) =>
        tx
          .select()
          .from(billingEvents)
          .where(eq(billingEvents.eventId, `${pid}:finished`)),
      { audit: false },
    );
    expect(events).toEqual([]);
    expect((await orderRow(id)).status).toBe("created");
    expect(await topupBalance(u.id)).toBe(0);
  });
});

describe("production safety", () => {
  it("the fake crypto provider refuses to run in production", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRYPTO_PROVIDER", "fake");
    try {
      const fresh = await import("@/lib/billing/crypto/provider");
      expect(() => fresh.getCryptoProvider()).toThrow(/cannot run in production/);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
