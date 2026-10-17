import { expect, test } from "@playwright/test";
import { DEPTHS, PLANS, STAGES } from "@voidaccess/config";
import { pillBalance, signUpAndVerify, uniqueEmail } from "./helpers";

test("sign up, run on the mock engine, watch it finish, then cancel a second run", async ({ page }) => {
  const t0 = Date.now();
  const email = uniqueEmail();

  // sign up -> verify through the log transport -> first-run screen (AUP was stored at sign-up)
  await signUpAndVerify(page, email);
  await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
  await expect.poll(() => pillBalance(page)).toBe(PLANS.free.monthlyCredits);
  await expect(page.getByText(`${DEPTHS.quick.credits} credits`).first()).toBeVisible();
  await expect(page.getByText(`${DEPTHS.standard.credits} credits`).first()).toBeVisible();

  // first run: Quick, from an example chip
  await page.getByRole("button", { name: "LockBit ransomware group" }).click();
  await expect(page.getByLabel("What do you want to investigate?")).toHaveValue("LockBit ransomware group");
  await page.getByRole("button", { name: "Start investigation" }).click();
  await expect(page).toHaveURL(/\/investigations\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
  await expect(page.getByText(/you can leave this page/i)).toBeVisible();

  // live progress: a stage becomes current, then the run completes
  await expect(page.locator('li[data-state="current"]')).toHaveCount(1);
  await expect(page.getByTestId("run-completed")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("link", { name: "View results" })).toHaveAttribute(
    "href",
    /\/investigations\/[0-9a-f-]{36}\/results$/,
  );
  await expect(page.locator('li[data-state="done"]')).toHaveCount(STAGES.length);
  const afterFirst = PLANS.free.monthlyCredits - DEPTHS.quick.credits;
  await expect.poll(() => pillBalance(page), { timeout: 20_000 }).toBe(afterFirst);
  console.log(`sign-up to finished run: ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  // second run: cancel once the collect stage is done -> partial refund
  await page.goto("/investigations/new");
  await page.getByLabel("What do you want to investigate?").fill("Lumma Stealer malware");
  await page.getByRole("radio", { name: /Quick/ }).check();
  await page.getByRole("button", { name: "Start investigation" }).click();
  await expect(page).toHaveURL(/\/investigations\/[0-9a-f-]{36}$/);
  await expect(page.locator('li[data-stage="collect"]')).toHaveAttribute("data-state", "done", {
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByTestId("run-cancelled")).toBeVisible({ timeout: 30_000 });
  const refunded = Number(await page.getByTestId("refunded").innerText());
  expect(refunded).toBeGreaterThan(0);
  expect(refunded).toBeLessThan(DEPTHS.quick.credits);
  await expect
    .poll(() => pillBalance(page), { timeout: 20_000 })
    .toBe(afterFirst - DEPTHS.quick.credits + refunded);

  // history lists both runs; settings export responds
  await page.goto("/investigations");
  await expect(page.getByRole("link", { name: "LockBit ransomware group" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Lumma Stealer malware" })).toBeVisible();
  const res = await page.request.get("/api/account/export");
  expect(res.status()).toBe(200);
  expect(((await res.json()) as { user: { email: string } }).user.email).toBe(email);
});

test("/dev/ui is not reachable signed out (guard) and is closed in production (404 for everyone)", async ({
  page,
  request,
}) => {
  const res = await request.get("/dev/ui", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  if (process.env.E2E_PROD) {
    await signUpAndVerify(page, uniqueEmail("devui"));
    expect((await page.request.get("/dev/ui")).status()).toBe(404);
  }
});

test("signed-out visitors are sent to the site's sign-in; app APIs answer 401", async ({ request }) => {
  for (const path of ["/welcome", "/investigations", "/settings", "/billing", "/accept-terms", "/"]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(307);
    const loc = new URL(res.headers().location!);
    expect(loc.pathname, path).toBe("/sign-in");
    expect(loc.origin, path).not.toBe(new URL(res.url()).origin); // the site, not the app
  }
  for (const path of ["/api/account/balance", "/api/investigations"]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(401);
  }
  // the old auth pages moved
  const old = await request.get("/sign-up?x=1", { maxRedirects: 0 });
  expect(old.status()).toBe(307);
  expect(old.headers().location).toMatch(/\/sign-up\?x=1$/);
});
