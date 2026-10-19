import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { CRYPTO_TOPUP_MIN_USD, PLANS, TOPUP_MAX_USD, TOPUP_MIN_USD, topupCredits } from "@voidaccess/config";
import { BILLING_EMAIL_LOG } from "../playwright.billing.config";
import { IPN_SECRET, ownerUrl } from "./billing-global-setup";
import { signIpn } from "../lib/billing/crypto/signature";
import { deliver, signed, subscriptionObject, topupCheckoutCompleted } from "./creem-webhook";
import { pillBalance, signUpAndVerify as signUpAndVerifyWith, uniqueEmail } from "./helpers";

const signUpAndVerify = (page: Page, email: string) =>
  signUpAndVerifyWith(page, email, "Billing E2E", BILLING_EMAIL_LOG);
const SHOTS = process.env.P7_SHOTS; // a directory: write the top-up control screenshots there
const CRYPTO_SHOTS = process.env.CRYPTO_SHOTS; // a directory: write the Billing page with crypto options there

async function q<T = Record<string, unknown>>(sql: string, args: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: ownerUrl() });
  await c.connect();
  try {
    return (await c.query(sql, args)).rows as T[];
  } finally {
    await c.end();
  }
}
const productId = async (key: string) =>
  (
    await q<{ provider_product_id: string }>(
      "select provider_product_id from billing_catalog where key = $1 and active and mode = 'test'",
      [key],
    )
  )[0]!.provider_product_id;

test("subscribe, pay-as-you-go top-up, change plan, cancel and resume, against the fake Creem provider", async ({
  page,
  request,
}) => {
  const email = uniqueEmail("billing");
  await signUpAndVerify(page, email);
  await expect.poll(() => pillBalance(page)).toBe(PLANS.free.monthlyCredits);

  // a finished investigation to look at exports on (Free plan)
  await page.getByRole("button", { name: "LockBit ransomware group" }).click();
  await page.getByRole("button", { name: "Start investigation" }).click();
  await expect(page).toHaveURL(/\/investigations\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("run-completed")).toBeVisible({ timeout: 120_000 });
  const invId = /investigations\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  await page.goto(`/investigations/${invId}/results/exports`);
  await expect(page.getByTestId("export-markdown").getByRole("button", { name: /locked/i })).toBeVisible();

  // billing page: plans straight from config, the price stated before checkout, Creem named
  await page.goto("/billing");
  await expect(page.getByTestId("plan-pro")).toContainText(`$${PLANS.pro.monthlyUsd}`);
  await expect(page.getByTestId("plan-pro_plus")).toContainText(`$${PLANS.pro_plus.monthlyUsd}`);
  await expect(page.getByTestId("plan-pro")).toContainText(`$${PLANS.pro.monthlyUsd} per month on Creem`);
  await expect(page.locator("body")).not.toContainText("Dodo");

  // start a Pro checkout: we land on Creem's test checkout (intercepted: no network needed)
  await page.route("https://creem.io/test/checkout/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Creem test checkout</h1>" }),
  );
  const proProduct = await productId("pro_month");
  await page.getByTestId("subscribe-pro").click();
  await page.waitForURL(/creem\.io\/test\/checkout\//);
  expect(page.url()).toContain(`/checkout/${proProduct}/ch_fake_`);

  // checkout created the customer mapping; Creem would now call our webhook, so we do, signed
  const [user] = await q<{ id: string }>("select id from users where email = $1", [email]);
  const [cust] = await q<{ provider_customer_id: string }>(
    "select provider_customer_id from billing_customers where user_id = $1",
    [user!.id],
  );
  const customer = cust!.provider_customer_id;
  const subId = `sub_e2e_${user!.id}`;
  const sub = (productIdFor: string, status = "active") =>
    subscriptionObject({ subId, productId: productIdFor, customer, email, userId: user!.id, status });
  const active = signed("subscription.active", sub(proProduct));
  const bad = await request.post("/api/webhooks/creem", {
    data: active.body,
    headers: { ...active.headers, "creem-signature": "00".repeat(32) },
  });
  expect(bad.status()).toBe(400);
  const good = await request.post("/api/webhooks/creem", { data: active.body, headers: active.headers });
  expect(good.status()).toBe(200);
  expect((await good.json()).outcome).toBe("applied");
  const retry = await request.post("/api/webhooks/creem", { data: active.body, headers: active.headers });
  expect((await retry.json()).outcome).toBe("duplicate"); // a retry never double-grants

  // plan Pro, credits granted once, pill updated
  expect((await q<{ plan: string }>("select plan from users where id = $1", [user!.id]))[0]!.plan).toBe(
    "pro",
  );
  await page.goto("/billing");
  await expect(page.getByTestId("plan-pro")).toContainText("Current plan");
  await expect(page.getByTestId("renewal-line")).toContainText("Renews on");
  await expect.poll(() => pillBalance(page)).toBe(PLANS.pro.monthlyCredits);
  await page.goto("/usage");
  await expect(page.getByTestId("ledger-row").filter({ hasText: "Monthly grant" }).first()).toContainText(
    `+${PLANS.pro.monthlyCredits.toLocaleString("en-US")}`,
  );
  await page.goto(`/investigations/${invId}/results/exports`);
  await expect(page.getByTestId("export-markdown").getByRole("link", { name: /Download/ })).toBeVisible();

  // ---- pay-as-you-go top-up: any whole-dollar amount, the credit count from config, validation inline ----
  await page.goto("/billing");
  const picker = page.getByTestId("topup-picker");
  const amount = page.getByTestId("topup-amount");
  await amount.fill(String(TOPUP_MIN_USD - 1));
  await expect(page.getByTestId("topup-result")).toContainText(`minimum top-up is $${TOPUP_MIN_USD}`);
  await expect(page.getByTestId("topup-buy")).toBeDisabled();
  await amount.fill(String(TOPUP_MAX_USD + 1));
  await expect(page.getByTestId("topup-result")).toContainText(`maximum top-up is $${TOPUP_MAX_USD}`);
  await amount.fill("12.5");
  await expect(page.getByTestId("topup-result")).toContainText("whole number of dollars");
  await page.getByTestId("topup-pick-25").click();
  await expect(amount).toHaveValue("25");
  await expect(page.getByTestId("topup-result")).toContainText(
    `You get ${topupCredits(25, "pro").toLocaleString("en-US")} credits`,
  );
  const usd = 37;
  await amount.fill(String(usd));
  await expect(page.getByTestId("topup-result")).toContainText(
    `You get ${topupCredits(usd, "pro").toLocaleString("en-US")} credits`,
  );
  if (SHOTS)
    for (const w of [1440, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      await picker.scrollIntoViewIfNeeded();
      await page.locator("#topups").screenshot({ path: `${SHOTS}/app-topup-${w}.png` });
    }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByTestId("topup-buy").click();
  await page.waitForURL(/creem\.io\/test\/checkout\//);
  const topupProduct = await productId("topup_credits");
  expect(page.url()).toContain(`/checkout/${topupProduct}/ch_fake_`);
  const [ck] = await q<{ id: string; provider_checkout_id: string; amount_cents: number; topup_usd: number }>(
    "select id, provider_checkout_id, amount_cents, topup_usd from billing_checkouts where user_id = $1 and kind = 'topup' order by created_at desc limit 1",
    [user!.id],
  );
  expect(ck).toMatchObject({ amount_cents: usd * 100, topup_usd: usd });
  const completed = topupCheckoutCompleted({
    checkoutRef: ck!.id,
    checkoutId: ck!.provider_checkout_id,
    amountCents: ck!.amount_cents,
    productId: topupProduct,
    customer,
    userId: user!.id,
  });
  // a tampered amount is refused (and flagged), the real one is credited exactly once
  const tampered = await deliver(request, "checkout.completed", {
    ...completed,
    order: {
      ...completed.order,
      id: "ord_tampered",
      sub_total: TOPUP_MIN_USD * 100,
      amount: TOPUP_MIN_USD * 100,
    },
  });
  expect((await tampered.json()).outcome).toBe("rejected");
  expect((await (await deliver(request, "checkout.completed", completed)).json()).outcome).toBe("applied");
  await deliver(request, "checkout.completed", completed); // replay under a new event id
  await page.goto("/usage");
  await expect(page.getByTestId("bucket-topup")).toContainText(
    topupCredits(usd, "pro").toLocaleString("en-US"),
  );

  // ---- change plan: upgrade to Pro+ (estimate shown, Creem applies it, the webhook moves the plan) ----
  await page.goto("/billing");
  await page.getByTestId("change-pro_plus").click();
  await expect(page.getByTestId("change-body")).toContainText("Creem will charge about");
  await page.getByTestId("change-confirm").click();
  await page.waitForURL(/checkout=changed/);
  expect(
    (await (await deliver(request, "subscription.update", sub(await productId("pro_plus_month")))).json())
      .outcome,
  ).toBe("applied");
  await page.goto("/billing");
  await expect(page.getByTestId("plan-pro_plus")).toContainText("Current plan");

  // ---- cancel at period end, then resume ----
  await page.getByTestId("cancel-open").click();
  await page.getByTestId("cancel-confirm").click();
  await expect(page.getByTestId("renewal-line")).toContainText("Ends on");
  // Creem confirms the schedule; the plan stays until the period end
  await deliver(
    request,
    "subscription.scheduled_cancel",
    sub(await productId("pro_plus_month"), "scheduled_cancel"),
  );
  await page.reload();
  await expect(page.getByTestId("renewal-line")).toContainText("Ends on");
  await expect(page.getByTestId("plan-pro_plus")).toContainText("Current plan");
  await page.getByTestId("resume").click();
  await expect(page.getByTestId("renewal-line")).toContainText("Renews on");
  await deliver(request, "subscription.active", sub(await productId("pro_plus_month")));
  await page.reload();
  await expect(page.getByTestId("renewal-line")).toContainText("Renews on");
  expect((await q<{ plan: string }>("select plan from users where id = $1", [user!.id]))[0]!.plan).toBe(
    "pro_plus",
  );
});

test("crypto: pay-as-you-go credits and a Pro pass with crypto, signed finished IPNs credit them once, the pass shows when it ends", async ({
  page,
  request,
}) => {
  const email = uniqueEmail("crypto");
  await signUpAndVerify(page, email);
  await expect.poll(() => pillBalance(page)).toBe(PLANS.free.monthlyCredits);
  const [user] = await q<{ id: string }>("select id from users where email = $1", [email]);

  await page.goto("/billing");
  await expect(page.getByTestId("crypto-note")).toContainText("NOWPayments");
  await expect(page.getByTestId("crypto-note")).toHaveCount(1);
  await expect(page.getByTestId("crypto-pass-pro")).toHaveText("Pay with crypto");
  await expect(page.getByTestId("plan-pro")).toContainText("It doesn't renew.");
  // the crypto minimum is shown, and an amount below it can only be paid by card
  const amount = page.getByTestId("topup-amount");
  await expect(page.getByTestId("crypto-topup-min")).toContainText(
    `Crypto top-ups from $${CRYPTO_TOPUP_MIN_USD}`,
  );
  await amount.fill(String(CRYPTO_TOPUP_MIN_USD - 1));
  await expect(page.getByTestId("topup-buy")).toBeEnabled();
  await expect(page.getByTestId("crypto-topup-buy")).toBeDisabled();
  await expect(page.getByTestId("crypto-topup-min")).toContainText(`start at $${CRYPTO_TOPUP_MIN_USD}`);
  // the server refuses it too
  const below = await page.request.post("/api/billing/crypto/checkout", {
    data: { kind: "topup", usd: CRYPTO_TOPUP_MIN_USD - 1 },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(below.status()).toBe(400);
  expect(await below.json()).toMatchObject({ error: "topup_invalid", reason: "below_minimum" });

  const usd = 25;
  await amount.fill(String(usd));
  await expect(page.getByTestId("crypto-topup-buy")).toBeEnabled();
  if (CRYPTO_SHOTS)
    for (const w of [1440, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(1200); // let the page's rise-in animation finish
      await page.screenshot({ path: `${CRYPTO_SHOTS}/billing-crypto-${w}.png`, fullPage: true });
      await page.locator("#topups").screenshot({ path: `${CRYPTO_SHOTS}/billing-crypto-topup-${w}.png` });
    }
  await page.setViewportSize({ width: 1280, height: 720 });
  // the fake provider's hosted page is our own billing page, as if the payment was sent at once
  await page.getByTestId("crypto-topup-buy").click();
  await page.waitForURL(/\/billing\?crypto=pending&invoice=fake_inv_/);
  await expect(page.getByTestId("crypto-pending")).toContainText("Payment received by NOWPayments");

  const ipn = async (orderId: string, paid: number, status: string, paymentId: number) => {
    const body = {
      payment_id: paymentId,
      payment_status: status,
      pay_address: "e2e-address",
      price_amount: paid,
      price_currency: "usd",
      pay_amount: 0.001,
      actually_paid: 0.001,
      pay_currency: "usdttrc20",
      order_id: `va_${orderId}`,
      order_description: "e2e",
      purchase_id: paymentId + 1,
      outcome_amount: 0.001,
      outcome_currency: "usdttrc20",
    };
    return request.post("/api/webhooks/nowpayments", {
      data: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-nowpayments-sig": signIpn(IPN_SECRET, body) },
    });
  };
  const [topupOrder] = await q<{ id: string; price_cents: number; topup_usd: number }>(
    "select id, price_cents, topup_usd from crypto_orders where user_id = $1 and kind = 'topup'",
    [user!.id],
  );
  expect(topupOrder).toMatchObject({ price_cents: usd * 100, topup_usd: usd });
  const bad = await request.post("/api/webhooks/nowpayments", {
    data: JSON.stringify({ payment_id: 1, payment_status: "finished", order_id: `va_${topupOrder!.id}` }),
    headers: { "content-type": "application/json", "x-nowpayments-sig": "00" },
  });
  expect(bad.status()).toBe(400);
  // signed with the shared secret, but another product's order (MailAccess uses ma_): refused
  const maBody = {
    payment_id: 2,
    payment_status: "finished",
    price_amount: usd,
    price_currency: "usd",
    order_id: `ma_${topupOrder!.id}`,
  };
  const other = await request.post("/api/webhooks/nowpayments", {
    data: JSON.stringify(maBody),
    headers: { "content-type": "application/json", "x-nowpayments-sig": signIpn(IPN_SECRET, maBody) },
  });
  expect(other.status()).toBe(403);
  const pay = 7_000_000_000 + Math.floor(Math.random() * 1_000_000);
  expect((await (await ipn(topupOrder!.id, usd, "waiting", pay)).json()).outcome).toBe("status_updated");
  // a short payment is not credited
  expect((await (await ipn(topupOrder!.id, usd - 1, "finished", pay + 9)).json()).outcome).toBe("rejected");
  const fin = await ipn(topupOrder!.id, usd, "finished", pay);
  expect(fin.status()).toBe(200);
  expect((await fin.json()).outcome).toBe("applied");
  expect((await (await ipn(topupOrder!.id, usd, "finished", pay)).json()).outcome).toBe("duplicate");
  expect((await (await ipn(topupOrder!.id, usd, "finished", pay + 1)).json()).outcome).toBe("ignored");
  const [ev] = await q<{ provider: string; mode: string }>(
    "select provider, mode from billing_events where event_id = $1",
    [`${pay}:finished`],
  );
  expect(ev).toEqual({ provider: "nowpayments", mode: "test" });

  const credits = topupCredits(usd, "free");
  await page.goto("/usage");
  await expect(page.getByTestId("bucket-topup")).toContainText(credits.toLocaleString("en-US"));
  await expect.poll(() => pillBalance(page)).toBe(PLANS.free.monthlyCredits + credits);

  // a Pro pass for one month, at the config price
  await page.goto("/billing");
  await page.getByTestId("interval-month").click();
  await page.getByTestId("crypto-pass-pro").click();
  await page.waitForURL(/\/billing\?crypto=pending/);
  const [passOrder] = await q<{ id: string; price_cents: number }>(
    "select id, price_cents from crypto_orders where user_id = $1 and kind = 'pass'",
    [user!.id],
  );
  expect(passOrder!.price_cents).toBe(PLANS.pro.monthlyUsd * 100);
  expect((await (await ipn(passOrder!.id, PLANS.pro.monthlyUsd, "finished", pay + 2)).json()).outcome).toBe(
    "applied",
  );
  await page.goto("/billing");
  await expect(page.getByTestId("pass-panel")).toContainText("Pro pass, paid with crypto. Ends on");
  await expect(page.getByTestId("pass-panel")).toContainText("doesn't renew");
  await expect(page.getByTestId("crypto-extend-month")).toBeVisible();
  await expect(page.getByTestId("portal")).toHaveCount(0);
  await expect(page.getByTestId("cancel-open")).toHaveCount(0);
  await expect(page.getByTestId("subscribe-pro_plus")).toHaveCount(0);
  if (CRYPTO_SHOTS)
    for (const w of [1440, 390]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${CRYPTO_SHOTS}/billing-crypto-pass-${w}.png`, fullPage: true });
    }
  expect((await q<{ plan: string }>("select plan from users where id = $1", [user!.id]))[0]!.plan).toBe(
    "pro",
  );
});
