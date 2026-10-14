import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";

// Production proof (D1-5). Throwaway accounts on Resend's test addresses (delivered+...@resend.dev: accepted, never a
// real inbox). Both accounts are deleted at the end through the account-delete API.
const SITE = "https://voidaccess.pro";
const APP = "https://app.voidaccess.pro";
const OUT = process.env.PROOF_OUT ?? "e2e-prod/evidence";
const tag = Date.now().toString(36);
const A = `delivered+d1proof-a${tag}@resend.dev`;
const B = `delivered+d1proof-b${tag}@resend.dev`;
mkdirSync(OUT, { recursive: true });

const script = (name: string, email: string, ...rest: string[]) =>
  execFileSync("pnpm", ["exec", "tsx", `scripts/${name}.ts`, email, ...rest], {
    encoding: "utf8",
    env: process.env,
  }).trim();

/**
 * Turnstile keeps automation off the real code request, and a resend.dev inbox can't be read, so the code is issued
 * server-side (see the script). It is then used through the real sign-in endpoint, from the site's origin, exactly as
 * the form sends it: the first sign-in creates the account, later ones return to it.
 */
async function signIn(page: Page, email: string) {
  const otp = script("ops-sign-in-code", email);
  const r = await page.request.post(`${APP}/api/auth/sign-in/email-otp`, {
    data: { email, otp, name: "D1 Proof" },
    headers: { origin: SITE },
  });
  expect(r.ok(), "sign-in with the issued code").toBeTruthy();
  await page.goto(`${APP}/welcome`);
  if (/\/accept-terms/.test(page.url())) {
    await page.getByRole("checkbox").click();
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await expect(page).toHaveURL(new RegExp(`^${APP}/welcome`), { timeout: 60_000 });
}

const pill = async (page: Page) =>
  Number((await page.getByTestId("credit-pill").innerText()).replace(/[^0-9]/g, ""));

async function newContext(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  return { ctx, page: await ctx.newPage() };
}

test("production proof", async ({ browser }) => {
  const t0 = Date.now();
  const a = await newContext(browser);

  // 1-2. the sign-in page and its gates on production, then a first sign-in that creates the account
  await a.page.goto(`${SITE}/sign-in`);
  await expect(a.page.getByRole("button", { name: "Email me a sign-in code" })).toBeDisabled(); // no Turnstile token
  await a.page.screenshot({ path: `${OUT}/01-sign-in-page.png` });
  const noCaptcha = await a.page.request.post(`${APP}/api/auth/email-otp/send-verification-otp`, {
    data: { email: A, type: "sign-in" },
    headers: { origin: SITE },
  });
  console.log("code request without captcha:", noCaptcha.status());
  expect(noCaptcha.status()).toBe(400);
  await signIn(a.page, A);
  await expect(a.page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  await expect.poll(() => pill(a.page)).toBe(100);
  await a.page.screenshot({ path: `${OUT}/02-welcome.png` });
  const cookies = await a.ctx.cookies();
  const sess = cookies.find((c) => /session_token/.test(c.name));
  console.log(
    "session cookie:",
    JSON.stringify({
      name: sess?.name,
      domain: sess?.domain,
      secure: sess?.secure,
      httpOnly: sess?.httpOnly,
      sameSite: sess?.sameSite,
    }),
  );
  expect(sess).toMatchObject({ domain: ".voidaccess.pro", secure: true, httpOnly: true, sameSite: "Lax" });

  // 3. Quick investigation through the real runner
  await a.page.goto(`${APP}/investigations/new`);
  await a.page.getByLabel("What do you want to investigate?").fill("LockBit ransomware group");
  await a.page.getByRole("radio", { name: /Quick/ }).check();
  const started = Date.now();
  await a.page.getByRole("button", { name: "Start investigation" }).click();
  await expect(a.page).toHaveURL(/\/investigations\/[0-9a-f-]{36}$/);
  const invId = /investigations\/([0-9a-f-]{36})/.exec(a.page.url())![1]!;
  console.log("run id:", invId);
  await a.page.screenshot({ path: `${OUT}/03-launching.png` });
  await expect(a.page.locator('li[data-state="current"]')).toHaveCount(1, { timeout: 8 * 60_000 });
  const firstEventMs = Date.now() - started;
  console.log("first stage after (s):", (firstEventMs / 1000).toFixed(0));
  await a.page.screenshot({ path: `${OUT}/04-progress.png` });
  await expect(a.page.getByTestId("run-completed")).toBeVisible({ timeout: 12 * 60_000 });
  console.log("run duration (s):", ((Date.now() - started) / 1000).toFixed(0));
  await a.page.screenshot({ path: `${OUT}/05-completed.png` });
  await expect.poll(() => pill(a.page), { timeout: 30_000 }).toBe(80);

  // 4. results: summary, graph (+PNG export), entities
  const base = `${APP}/investigations/${invId}/results`;
  await a.page.goto(`${base}/summary`);
  await expect(a.page.getByTestId("summary-markdown")).toBeVisible();
  await a.page.screenshot({ path: `${OUT}/06-summary.png` });
  await a.page.goto(`${base}/graph`);
  await expect(a.page.getByTestId("graph-canvas")).toBeVisible({ timeout: 60_000 });
  const [dl] = await Promise.all([a.page.waitForEvent("download"), a.page.getByTestId("export-png").click()]);
  const png = await (await import("node:fs/promises")).readFile((await dl.path())!);
  expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  await a.page.screenshot({ path: `${OUT}/07-graph.png` });
  await a.page.goto(`${base}/entities`);
  await expect(a.page.getByTestId("entity-row").first()).toBeVisible();
  await a.page.screenshot({ path: `${OUT}/08-entities.png` });
  console.log("evidence A:\n" + script("prod-proof-evidence", A));

  // 5. sign out -> the app redirects to the site's sign-in
  await a.page.goto(`${APP}/welcome`);
  await a.page.getByRole("button", { name: "User menu" }).click();
  await a.page.getByRole("menuitem", { name: /sign out/i }).click();
  await expect(a.page).toHaveURL(new RegExp(`^${SITE}/sign-in`), { timeout: 30_000 });
  const resp = await a.page.request.get(`${APP}/welcome`, { maxRedirects: 0 });
  expect(resp.status()).toBe(307);
  expect(resp.headers().location).toContain(`${SITE}/sign-in`);
  await a.page.screenshot({ path: `${OUT}/09-signed-out.png` });

  // 6. isolation: a second account gets 404 on the first account's investigation everywhere
  const b = await newContext(browser);
  await signIn(b.page, B);
  const paths = [
    `/investigations/${invId}`,
    `/investigations/${invId}/results`,
    ...["summary", "graph", "entities", "sources", "actors", "exports"].map(
      (t) => `/investigations/${invId}/results/${t}`,
    ),
    `/api/investigations/${invId}`,
    `/api/investigations/${invId}/graph`,
    `/api/investigations/${invId}/entities`,
    `/api/investigations/${invId}/events`,
    `/api/investigations/${invId}/exports/csv`,
    `/api/investigations/${invId}/exports/markdown`,
  ];
  const statuses: Record<string, number> = {};
  for (const p of paths) {
    const r = await b.page.request.get(`${APP}${p}`, { maxRedirects: 0 });
    statuses[p] = r.status();
    expect(r.status(), p).toBe(404);
  }
  console.log("isolation statuses:", JSON.stringify(statuses));
  const cancel = await b.page.request.post(`${APP}/api/investigations/${invId}/cancel`, {
    headers: { origin: APP },
    maxRedirects: 0,
  });
  console.log("cross-account cancel status:", cancel.status());
  expect(cancel.status()).toBe(404);
  await b.page.screenshot({ path: `${OUT}/10-isolation.png` });

  // 8. delete both accounts via the API; sessions must die
  for (const [ctx, label, email] of [[b, "B", B]] as const) {
    const del = await ctx.page.request.post(`${APP}/api/account/delete`, {
      headers: { origin: APP, "content-type": "application/json" },
      data: { confirm: email },
    });
    console.log(`delete ${label}:`, del.status(), await del.text());
    expect(del.status()).toBe(200);
    const after = await ctx.page.request.get(`${APP}/api/account/balance`);
    expect(after.status()).toBe(401);
  }
  await signIn(a.page, A);
  const delA = await a.page.request.post(`${APP}/api/account/delete`, {
    headers: { origin: APP, "content-type": "application/json" },
    data: { confirm: A },
  });
  console.log("delete A:", delA.status(), await delA.text());
  expect(delA.status()).toBe(200);
  expect((await a.page.request.get(`${APP}/api/account/balance`)).status()).toBe(401);
  console.log("total (s):", ((Date.now() - t0) / 1000).toFixed(0));
});
