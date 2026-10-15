import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

const APP = "http://app.va.localhost:3600";

const ALLOWED = ["/", "/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/check-email", "/verified", "/acceptable-use", "/privacy", "/terms", "/robots.txt"];
/** The home page's own files (src/home/index.html references them; public/ holds them). */
const STATIC: Record<string, RegExp> = {
  "/site.webmanifest": /^application\/(manifest\+)?json/,
  "/css/site.css": /^text\/css/,
  "/vendor/lenis.css": /^text\/css/,
  "/js/app.js": /javascript/,
  "/js/motion.js": /javascript/,
  "/js/terrain-gl.js": /javascript/,
  "/js/terrain-math.js": /javascript/,
  "/js/va-stack.js": /javascript/,
  "/vendor/gsap.min.js": /javascript/,
  "/vendor/ScrollTrigger.min.js": /javascript/,
  "/vendor/SplitText.min.js": /javascript/,
  "/vendor/ScrambleTextPlugin.min.js": /javascript/,
  "/vendor/lenis.min.js": /javascript/,
  "/vendor/three/three.module.min.js": /javascript/,
  "/vendor/three/three.core.js": /javascript/,
  "/fonts/GeneralSans-400.woff2": /^font\/woff2/,
  "/fonts/GeneralSans-500.woff2": /^font\/woff2/,
  "/fonts/GeneralSans-600.woff2": /^font\/woff2/,
  "/fonts/GeistMono-400.woff2": /^font\/woff2/,
  "/fonts/GeistMono-500.woff2": /^font\/woff2/,
  "/assets/favicon.ico": /^image\/(x-icon|vnd\.microsoft\.icon)/,
  "/assets/favicon-32.png": /^image\/png/,
  "/assets/apple-touch-icon.png": /^image\/png/,
  "/assets/icon-192.png": /^image\/png/,
  "/assets/icon-512.png": /^image\/png/,
  "/assets/logo.png": /^image\/png/,
  "/assets/og.png": /^image\/png/,
  "/assets/platform-graph.png": /^image\/png/,
  "/assets/terminal-hero.png": /^image\/png/,
};
const BLOCKED = ["/features", "/pricing", "/trust", "/open-source", "/waitlist", "/waitlist/check-email", "/waitlist/confirmed", "/llms.txt", "/llms-full.txt", "/og", "/sitemap.xml", "/api/waitlist", "/api/waitlist/confirm", "/api/founding/seats", "/pl/event", "/pl/script.js"];

test.describe("routes", () => {
  for (const p of ALLOWED) {
    test(`GET ${p} is served`, async ({ request }) => {
      expect((await request.get(p)).status()).toBe(200);
    });
  }
  for (const [p, type] of Object.entries(STATIC)) {
    test(`GET ${p} is served as ${type.source}`, async ({ request }) => {
      const res = await request.get(p);
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toMatch(type);
    });
  }

  test("/ is the static home page, byte for byte, and every file it references is served", async ({ request }) => {
    const res = await request.get("/");
    expect(res.headers()["content-type"]).toMatch(/^text\/html/);
    const html = await res.text();
    expect(html).toBe(readFileSync(path.join(import.meta.dirname, "../../src/home/index.html"), "utf8"));
    const refs = new Set([...html.matchAll(/(?:href|src)="(\/[^"#]*)"/g)].map((m) => m[1]!).filter((u) => u !== "/"));
    refs.add("/vendor/three/three.module.min.js"); // the importmap target
    for (const ref of refs) {
      expect(STATIC[ref], `${ref} is listed in STATIC`).toBeDefined();
      expect((await request.get(ref)).status(), ref).toBe(200);
    }
  });

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

  test("the home page loads with a clean console", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") problems.push(m.text());
    });
    page.on("pageerror", (e) => problems.push(e.message));
    page.on("requestfailed", (r) => problems.push(`${r.url()} ${r.failure()?.errorText}`));
    page.on("response", (r) => {
      if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
    });
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);
    expect(problems).toEqual([]);
  });

  test("auth pages are noindex", async ({ page }) => {
    for (const p of ["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/check-email", "/verified"]) {
      await page.goto(p);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    }
  });

  test("home, sign-in, legal and 404 pages link only to pages that exist", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Flatten the noise\.\s*Follow the signal\.$/);
    for (const url of ["/", "/sign-in", "/terms", "/privacy", "/acceptable-use", "/pricing"]) {
      await page.goto(url);
      const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((a) => a.getAttribute("href") as string));
      for (const href of new Set(hrefs)) {
        // in-page anchors and external links (GitHub) are not pages of this site
        if (href.startsWith("#") || /^[a-z]+:/i.test(href)) continue;
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

const CORS = { "access-control-allow-origin": "http://localhost:3701", "access-control-allow-credentials": "true", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };

/** Mocks the app's two email-code endpoints (cross-origin, so they also answer the CORS preflight). */
async function mockCodeSignIn(page: Page, opts: { codeOk?: boolean } = {}): Promise<{ send: Captured[]; verify: Captured[] }> {
  const send: Captured[] = [];
  const verify: Captured[] = [];
  await page.route(`${APP}/api/auth/email-otp/send-verification-otp`, async (route: Route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    send.push({ body: req.postDataJSON(), headers: req.headers() });
    return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ success: true }) });
  });
  await page.route(`${APP}/api/auth/sign-in/email-otp`, async (route: Route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    verify.push({ body: req.postDataJSON(), headers: req.headers() });
    if (opts.codeOk === false)
      return route.fulfill({ status: 400, headers: CORS, contentType: "application/json", body: JSON.stringify({ message: "Invalid OTP", code: "INVALID_OTP" }) });
    return route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ token: "t", user: { id: "u1", email: "ada@example.com", name: "" } }) });
  });
  // the successful sign-in navigates to the app: answer it so the test can assert the URL
  await page.route(`${APP}/welcome`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<h1>app</h1>" }));
  return { send, verify };
}

test.describe("sign-in with an email code (first sign-in creates the account)", () => {
  test("email -> captcha-gated code request -> 6-digit code -> into the app; no firstTouch without consent", async ({ page }) => {
    await stubTurnstile(page);
    const calls = await mockCodeSignIn(page);
    await page.goto("/sign-in?utm_source=e2e&ref=smoke");
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Acceptable Use Policy" })).toHaveAttribute("href", "/acceptable-use");

    await page.getByLabel("Email").fill("ada@example.com");
    const send = page.getByRole("button", { name: "Email me a sign-in code" });
    await expect(page.getByTestId("turnstile")).toBeVisible();
    await expect(send).toBeEnabled(); // token arrived
    await send.click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check your email");
    expect(calls.send).toHaveLength(1);
    expect(calls.send[0]!.body).toMatchObject({ email: "ada@example.com", type: "sign-in" });
    expect(calls.send[0]!.headers["x-captcha-response"]).toBe("test-token");

    await page.getByLabel("Sign-in code").fill("482913");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(`${APP}/welcome`);
    expect(calls.verify[0]!.body).toMatchObject({ email: "ada@example.com", otp: "482913" });
    expect(calls.send[0]!.body).not.toHaveProperty("firstTouch");
    expect(calls.verify[0]!.body).not.toHaveProperty("firstTouch");
  });

  test("after the visitor agrees to the privacy prompt, firstTouch is sent with the code", async ({ page }) => {
    await stubTurnstile(page);
    const calls = await mockCodeSignIn(page);
    await page.goto("/sign-in?utm_source=e2e&ref=smoke");
    await page.getByRole("button", { name: "Yes, remember" }).click();
    await page.getByLabel("Email").fill("ada@example.com");
    await expect(page.getByRole("button", { name: "Email me a sign-in code" })).toBeEnabled();
    await page.getByRole("button", { name: "Email me a sign-in code" }).click();
    await page.getByLabel("Sign-in code").fill("482913");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(`${APP}/welcome`);
    expect(calls.send[0]!.body.firstTouch).toMatchObject({ utm: { utm_source: "e2e" } });
    expect(calls.verify[0]!.body.firstTouch).toMatchObject({ utm: { utm_source: "e2e" }, ref: "smoke", landing: "/sign-in" });
  });

  test("a wrong code is shown and the user stays on the code step", async ({ page }) => {
    await stubTurnstile(page);
    await mockCodeSignIn(page, { codeOk: false });
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("ada@example.com");
    await expect(page.getByRole("button", { name: "Email me a sign-in code" })).toBeEnabled();
    await page.getByRole("button", { name: "Email me a sign-in code" }).click();
    await page.getByLabel("Sign-in code").fill("000000");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("That code didn't work")).toBeVisible();
    await expect(page.getByLabel("Sign-in code")).toBeVisible();
  });
});

test("old auth pages redirect to sign-in, keeping next", async ({ page }) => {
  for (const p of ["/sign-up", "/forgot-password", "/reset-password?token=x", "/check-email", "/verified"]) {
    await page.goto(p);
    await expect(page, p).toHaveURL(/\/sign-in$/);
  }
  await page.goto(`/sign-up?next=${encodeURIComponent(`${APP}/investigations`)}`);
  await expect(page).toHaveURL(/\/sign-in\?next=/);
});
