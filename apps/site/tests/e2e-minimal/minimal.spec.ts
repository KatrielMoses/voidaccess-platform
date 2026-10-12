import { expect, test, type Page, type Route } from "@playwright/test";

const APP = "http://app.va.localhost:3600";

const ALLOWED = ["/", "/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/check-email", "/verified", "/acceptable-use", "/privacy", "/terms", "/robots.txt"];
const BLOCKED = ["/features", "/pricing", "/trust", "/open-source", "/waitlist", "/waitlist/check-email", "/waitlist/confirmed", "/llms.txt", "/llms-full.txt", "/og", "/sitemap.xml", "/api/waitlist", "/api/waitlist/confirm", "/api/founding/seats", "/pl/event", "/pl/script.js"];

test.describe("routes", () => {
  for (const p of ALLOWED) {
    test(`GET ${p} is served`, async ({ request }) => {
      expect((await request.get(p)).status()).toBe(200);
    });
  }
  for (const p of BLOCKED) {
    test(`GET ${p} is 404`, async ({ request }) => {
      expect((await request.get(p)).status()).toBe(404);
    });
  }

  test("POST to the waitlist API is 404 (no DB code runs)", async ({ request }) => {
    expect((await request.post("/api/waitlist", { data: { email: "a@example.com" } })).status()).toBe(404);
    expect((await request.post("/pl/event", { data: "{}" })).status()).toBe(404);
  });

  test("robots.txt disallows the auth pages and has no sitemap", async ({ request }) => {
    const body = await (await request.get("/robots.txt")).text();
    expect(body).toContain("Disallow: /sign-in");
    expect(body).toContain("Disallow: /reset-password");
    expect(body).not.toContain("Sitemap");
  });

  test("www redirects to the bare host with a 301", async ({ request }) => {
    const res = await request.get("/sign-in?next=x", { headers: { host: "www.voidaccess.pro" }, maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers().location).toBe("https://voidaccess.pro/sign-in?next=x");
  });

  test("auth pages are noindex", async ({ page }) => {
    for (const p of ["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/check-email", "/verified"]) {
      await page.goto(p);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    }
  });

  test("home placeholder and 404 page link only to pages that exist", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("VoidAccess Cloud: dark-web OSINT in your browser.");
    await page.goto("/features");
    for (const url of ["/", "/sign-in"]) {
      await page.goto(url);
      const hrefs = await page.locator("a[href^='/']").evaluateAll((els) => els.map((a) => a.getAttribute("href") as string));
      for (const href of new Set(hrefs)) {
        if (href === "#main") continue;
        const status = (await page.request.get(href)).status();
        expect(status, `${url} links to ${href}`).toBe(200);
      }
    }
    const notFound = await page.goto("/pricing");
    expect(notFound?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("That page isn't here");
    await expect(page.getByRole("link", { name: "Pricing" })).toHaveCount(0);
  });
});

/** Replaces Turnstile with a stub that issues a token, so the test needs no network. */
async function stubTurnstile(page: Page) {
  await page.route("https://challenges.cloudflare.com/**", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: "window.turnstile={render:function(_e,o){setTimeout(function(){o.callback('test-token')},50);return 'w1'},reset:function(){}};",
    }),
  );
}

interface Captured {
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

/** Mocks the app's sign-up endpoint (cross-origin, so it also answers the CORS preflight). */
async function mockSignUp(page: Page): Promise<Captured[]> {
  const calls: Captured[] = [];
  const cors = { "access-control-allow-origin": "http://localhost:3701", "access-control-allow-credentials": "true", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
  await page.route(`${APP}/api/auth/sign-up/email`, async (route: Route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    calls.push({ body: req.postDataJSON(), headers: req.headers() });
    return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ token: null, user: { id: "u1", email: "a@example.com", name: "Ada" } }) });
  });
  return calls;
}

async function fillSignUp(page: Page) {
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password").fill("correct horse battery");
}

test.describe("sign-up", () => {
  test("submit is gated on the AUP checkbox; request carries aupAccepted + captcha header and no firstTouch without consent", async ({ page }) => {
    await stubTurnstile(page);
    const calls = await mockSignUp(page);
    await page.goto("/sign-up?utm_source=e2e&ref=smoke");
    await fillSignUp(page);

    const submit = page.getByRole("button", { name: "Create account" });
    await expect(page.getByTestId("turnstile")).toBeVisible();
    await page.waitForTimeout(300); // token arrives
    await expect(submit).toBeDisabled(); // AUP not accepted yet
    await expect(page.getByRole("link", { name: "Acceptable Use Policy" })).toHaveAttribute("href", "/acceptable-use");

    await page.getByLabel(/I have read and accept/).check();
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page).toHaveURL(/\/check-email\?email=ada%40example\.com$/);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body).toMatchObject({ name: "Ada Lovelace", email: "ada@example.com", password: "correct horse battery", callbackURL: "/welcome", aupAccepted: true });
    expect(calls[0]!.body).not.toHaveProperty("firstTouch");
    expect(calls[0]!.headers["x-captcha-response"]).toBe("test-token");
  });

  test("after the visitor agrees to the privacy prompt, firstTouch is sent", async ({ page }) => {
    await stubTurnstile(page);
    const calls = await mockSignUp(page);
    await page.goto("/sign-up?utm_source=e2e&ref=smoke");
    await page.getByRole("button", { name: "Yes, remember" }).click();
    await fillSignUp(page);
    await page.getByLabel(/I have read and accept/).check();
    await expect(page.getByRole("button", { name: "Create account" })).toBeEnabled();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/check-email/);
    expect(calls[0]!.body.firstTouch).toMatchObject({ utm: { utm_source: "e2e" }, ref: "smoke", landing: "/sign-up" });
  });

  test("a server rejection is shown and the user stays on the page", async ({ page }) => {
    await stubTurnstile(page);
    await page.route(`${APP}/api/auth/sign-up/email`, (route) => {
      const cors = { "access-control-allow-origin": "http://localhost:3701", "access-control-allow-credentials": "true", "access-control-allow-headers": "*" };
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      return route.fulfill({ status: 400, headers: cors, contentType: "application/json", body: JSON.stringify({ message: "Captcha failed", code: "CAPTCHA" }) });
    });
    await page.goto("/sign-up");
    await fillSignUp(page);
    await page.getByLabel(/I have read and accept/).check();
    await expect(page.getByRole("button", { name: "Create account" })).toBeEnabled();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Captcha failed")).toBeVisible();
    await expect(page).toHaveURL(/\/sign-up$/);
  });
});

test("reset-password without a token shows the expired state", async ({ page }) => {
  await page.goto("/reset-password?error=INVALID_TOKEN");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Link expired");
});

test("verified page continues to the app", async ({ page }) => {
  await page.goto("/verified");
  await expect(page.getByRole("link", { name: "Continue" })).toHaveAttribute("href", `${APP}/welcome`);
});
