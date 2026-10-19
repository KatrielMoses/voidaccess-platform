// Screenshots for the handoff: SCREENSHOTS=1 pnpm test:e2e:billing   (written to docs/screenshots/billing/)
import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { PLANS } from "@voidaccess/config";
import { BILLING_EMAIL_LOG } from "../playwright.billing.config";
import { ownerUrl } from "./billing-global-setup";
import { deliver, subscriptionObject } from "./creem-webhook";
import { signInWithCode } from "./helpers";

const OUT = new URL("../docs/screenshots/billing/", import.meta.url).pathname;
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to regenerate the billing screenshots");

async function sql<T = Record<string, unknown>>(q: string, a: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: ownerUrl() });
  await c.connect();
  try {
    return (await c.query(q, a)).rows as T[];
  } finally {
    await c.end();
  }
}

async function makeUser(name: string, plan = "free") {
  const id = randomUUID();
  await sql(
    `insert into users (id, name, email, email_verified, aup_accepted_at, plan) values ($1,$2,$3,true,now(),$4)`,
    [id, name, `${id}@shots.local`, plan],
  );
  await sql(
    `insert into credit_ledger (user_id, bucket, amount, reason, expires_at, idempotency_key) values ($1,'grant',$2,'grant', now() + interval '30 days', $3)`,
    [id, PLANS.free.monthlyCredits, `grant:${id}:seed`],
  );
  const customer = `cust_shots_${id.slice(0, 8)}`;
  await sql(`insert into billing_customers (user_id, mode, provider_customer_id) values ($1,'test',$2)`, [
    id,
    customer,
  ]);
  return { id, customer, email: `${id}@shots.local` };
}

async function signIn(page: Page, u: { email: string }) {
  await page.context().clearCookies();
  await signInWithCode(page, u.email, "Shots", BILLING_EMAIL_LOG);
}

async function subscribe(
  request: APIRequestContext,
  u: { id: string; customer: string; email: string },
  key: string,
) {
  const [p] = await sql<{ provider_product_id: string }>(
    "select provider_product_id from billing_catalog where key=$1 and active and mode='test'",
    [key],
  );
  const r = await deliver(
    request,
    "subscription.active",
    subscriptionObject({
      subId: `sub_${u.id}`,
      productId: p!.provider_product_id,
      customer: u.customer,
      email: u.email,
      userId: u.id,
    }),
  );
  expect(r.status()).toBe(200);
}

const SIZES = [
  { w: 1440, h: 900 },
  { w: 375, h: 812 },
];
async function shoot(page: Page, path: string, name: string) {
  for (const s of SIZES) {
    await page.setViewportSize({ width: s.w, height: s.h });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `${OUT}${name}-${s.w}.png`, fullPage: true });
  }
}

test("billing screenshots: free, Pro, founder, usage, alert banners", async ({ page, request }) => {
  const free = await makeUser("Free Fran");
  await signIn(page, free);
  await shoot(page, "/billing", "billing-free");

  const pro = await makeUser("Pro Pat");
  await subscribe(request, pro, "pro_month");
  await sql(
    `insert into credit_ledger (user_id, bucket, amount, reason, idempotency_key) values ($1,'grant',-40,'reserve',$2)`,
    [pro.id, `shots-reserve-${pro.id}`],
  );
  await signIn(page, pro);
  await shoot(page, "/billing", "billing-pro");
  await shoot(page, "/usage", "usage");

  const founder = await makeUser("Founder Faye");
  await subscribe(request, founder, "founding_pro_month");
  await signIn(page, founder);
  await shoot(page, "/billing", "billing-founder");

  const a80 = await makeUser("Alert Al");
  await sql(
    `insert into credit_ledger (user_id, bucket, amount, reason, idempotency_key) values ($1,'grant',-80,'reserve',$2)`,
    [a80.id, `shots-80-${a80.id}`],
  );
  await signIn(page, a80);
  await shoot(page, "/investigations/new", "alert-80");

  const a100 = await makeUser("Alert Ada");
  await sql(
    `insert into credit_ledger (user_id, bucket, amount, reason, idempotency_key) values ($1,'grant',-100,'reserve',$2)`,
    [a100.id, `shots-100-${a100.id}`],
  );
  await signIn(page, a100);
  await shoot(page, "/investigations/new", "alert-100");
});
