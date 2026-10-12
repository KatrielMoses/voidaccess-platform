import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { DEPTHS, PLANS, TOPUPS, topupCredits } from "@voidaccess/config";
import { BILLING_EMAIL_LOG } from "../playwright.billing.config";
import { WEBHOOK_SECRET, ownerUrl } from "./billing-global-setup";
import { existsSync, readFileSync } from "node:fs";
import { PASSWORD, pillBalance, uniqueEmail } from "./helpers";

/** Same flow as helpers.signUpAndVerify, reading this run's own email log. */
async function signUpAndVerify(page: Page, email: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Billing E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/check-email/);
  let link: string | undefined;
  await expect
    .poll(
      () => {
        if (!existsSync(BILLING_EMAIL_LOG)) return false;
        for (const line of readFileSync(BILLING_EMAIL_LOG, "utf8").split("\n").filter(Boolean).reverse()) {
          const m = JSON.parse(line) as { to: string; template: string; text: string };
          if (m.to === email && m.template === "verifyEmail")
            return (link = /https?:\/\/\S+/.exec(m.text)?.[0]) !== undefined;
        }
        return false;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.goto(link!);
  await expect(page).toHaveURL(/\/welcome/);
}
const key = (s: string) => Buffer.from(s.replace(/^whsec_/, ""), "base64");

/** A Dodo webhook delivery signed with Standard Webhooks: HMAC-SHA256 over `${id}.${timestamp}.${body}`. */
function signed(type: string, data: Record<string, unknown>) {
  const id = `evt_e2e_${randomUUID()}`;
  const ts = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ business_id: "bus_e2e", type, timestamp: new Date().toISOString(), data });
  const sig = createHmac("sha256", key(WEBHOOK_SECRET)).update(`${id}.${ts}.${body}`).digest("base64");
  return {
    body,
    headers: {
      "content-type": "application/json",
      "webhook-id": id,
      "webhook-timestamp": String(ts),
      "webhook-signature": `v1,${sig}`,
    },
  };
}

async function q<T = Record<string, unknown>>(sql: string, args: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: ownerUrl() });
  await c.connect();
  try {
    return (await c.query(sql, args)).rows as T[];
  } finally {
    await c.end();
  }
}

test("free user: checkout redirect, signed activation webhook, plan Pro, credits granted, usage page, header pill, locked export unlocks", async ({
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

  // billing page: plans straight from config, the price stated before checkout
  await page.goto("/billing");
  await expect(page.getByTestId("plan-pro")).toContainText(`$${PLANS.pro.monthlyUsd}`);
  await expect(page.getByTestId("plan-pro_plus")).toContainText(`$${PLANS.pro_plus.monthlyUsd}`);
  await expect(page.getByTestId("subscribe-pro")).toBeVisible();
  await expect(page.getByTestId("plan-pro")).toContainText(`$${PLANS.pro.monthlyUsd} per month`);

  // start a Pro checkout: we land on Dodo's test checkout (intercepted: no network needed)
  await page.route("https://test.checkout.dodopayments.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Dodo test checkout</h1>" }),
  );
  await page.getByTestId("subscribe-pro").click();
  await page.waitForURL(/test\.checkout\.dodopayments\.com\/session\//);
  expect(page.url()).toContain("product=pdt_fake_pro_month");

  // checkout created the customer mapping; Dodo would now call our webhook, so we do, signed
  const [user] = await q<{ id: string }>("select id from users where email = $1", [email]);
  const [cust] = await q<{ dodo_customer_id: string }>(
    "select dodo_customer_id from billing_customers where user_id = $1",
    [user!.id],
  );
  const [prod] = await q<{ dodo_product_id: string }>(
    "select dodo_product_id from billing_catalog where key = 'pro_month' and active",
  );
  const start = new Date();
  const active = signed("subscription.active", {
    payload_type: "Subscription",
    subscription_id: `sub_e2e_${user!.id}`,
    product_id: prod!.dodo_product_id,
    status: "active",
    previous_billing_date: start.toISOString(),
    next_billing_date: new Date(start.getTime() + 30 * 86_400_000).toISOString(),
    cancel_at_next_billing_date: false,
    customer: { customer_id: cust!.dodo_customer_id, email },
    metadata: { user_id: user!.id },
  });
  const bad = await request.post("/api/webhooks/dodo", {
    data: active.body,
    headers: { ...active.headers, "webhook-signature": "v1,AAAA" },
  });
  expect(bad.status()).toBe(400);
  const good = await request.post("/api/webhooks/dodo", { data: active.body, headers: active.headers });
  expect(good.status()).toBe(200);
  expect((await good.json()).outcome).toBe("applied");
  expect(
    (await request.post("/api/webhooks/dodo", { data: active.body, headers: active.headers })).status(),
  ).toBe(200); // retry: no double grant

  // plan Pro, credits granted once, pill updated
  expect((await q<{ plan: string }>("select plan from users where id = $1", [user!.id]))[0]!.plan).toBe(
    "pro",
  );
  await page.goto("/billing");
  await expect(page.getByTestId("plan-pro")).toContainText("Current plan");
  await expect(page.getByTestId("renewal-line")).toContainText("Renews on");
  await expect.poll(() => pillBalance(page)).toBe(PLANS.pro.monthlyCredits); // the Free remainder expires when the Pro grant starts

  // usage page shows the grant
  await page.goto("/usage");
  await expect(page.getByTestId("ledger-row").filter({ hasText: "Monthly grant" }).first()).toContainText(
    `+${PLANS.pro.monthlyCredits.toLocaleString("en-US")}`,
  );
  await expect(page.getByTestId("usage-total")).toContainText(
    PLANS.pro.monthlyCredits.toLocaleString("en-US"),
  );

  // the locked export is now open
  await page.goto(`/investigations/${invId}/results/exports`);
  await expect(page.getByTestId("export-markdown").getByRole("link", { name: /Download/ })).toBeVisible();

  // top-up: signed payment webhook grants exactly topupCredits() for a Pro subscriber
  const tier = TOPUPS[0];
  const [tp] = await q<{ dodo_product_id: string }>(
    "select dodo_product_id from billing_catalog where key = $1 and active",
    [`topup_${tier.usd}`],
  );
  const pay = signed("payment.succeeded", {
    payload_type: "Payment",
    payment_id: `pay_e2e_${user!.id}`,
    total_amount: tier.usd * 100,
    created_at: new Date().toISOString(),
    subscription_id: null,
    product_cart: [{ product_id: tp!.dodo_product_id, quantity: 1 }],
    customer: { customer_id: cust!.dodo_customer_id, email },
    metadata: { user_id: user!.id },
  });
  expect((await request.post("/api/webhooks/dodo", { data: pay.body, headers: pay.headers })).status()).toBe(
    200,
  );
  await page.goto("/usage");
  await expect(page.getByTestId("bucket-topup")).toContainText(
    topupCredits(tier.usd, "pro").toLocaleString("en-US"),
  );
  void DEPTHS;
});
