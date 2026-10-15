// Design review screenshots of every product screen outside the results lane, at 1440 and 390 px.
//   SCREENSHOTS=1 SHOTS_DIR=/some/dir pnpm --filter @voidaccess/app exec playwright test e2e/design-screenshots.spec.ts
// Writes <SHOTS_DIR>/<name>-<width>.png (default docs/screenshots/design). Skipped unless SCREENSHOTS=1.
import { join } from "node:path";
import pg from "pg";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { e2eEnv } from "../playwright.config";
import { signInWithCode, uniqueEmail } from "./helpers";
import { setUserRole } from "../lib/admin/role";

test.skip(process.env.SCREENSHOTS !== "1", "set SCREENSHOTS=1 to capture the design screenshots");
test.describe.configure({ mode: "serial" });

const OUT = process.env.SHOTS_DIR ?? join(process.cwd(), "docs", "screenshots", "design");
const SIZES = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;
const OWNER = e2eEnv.MIGRATE_DATABASE_URL;

async function sql<T = Record<string, unknown>>(q: string, a: unknown[] = []): Promise<T[]> {
  const c = new pg.Client({ connectionString: OWNER });
  await c.connect();
  try {
    return (await c.query(q, a)).rows as T[];
  } finally {
    await c.end();
  }
}

async function shot(page: Page, name: string) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1200); // fonts, entrance motion
  const w = page.viewportSize()!.width;
  await page.screenshot({ path: join(OUT, `${name}-${w}.png`), fullPage: true });
}

/** Both widths of the same URL. */
async function both(
  browser: Browser,
  state: string,
  path: string,
  name: string,
  before?: (p: Page) => Promise<void>,
) {
  for (const size of SIZES) {
    const ctx = await browser.newContext({ viewport: size, storageState: state });
    const p = await ctx.newPage();
    await p.goto(path);
    if (before) await before(p);
    await shot(p, name);
    await ctx.close();
  }
}

let userState = "";
let adminState = "";
let userId = "";
let completedId = "";
let cancelledId = "";
let runningId = "";

test("user flow", async ({ browser }) => {
  test.setTimeout(1_200_000);
  const email = uniqueEmail("design");
  const ctx = await browser.newContext({ viewport: SIZES[0] });
  const page = await ctx.newPage();
  await signInWithCode(page, email, "Ada Lovelace");
  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/accept-terms/);
  userState = join(OUT, ".user-state.json");
  await ctx.storageState({ path: userState });
  await both(browser, userState, "/accept-terms", "accept-terms");
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/welcome/);
  await ctx.storageState({ path: userState });
  userId = (await sql<{ id: string }>("select id from users where email = $1", [email]))[0]!.id;
  await sql(
    `insert into credit_ledger (user_id, bucket, amount, reason, expires_at, idempotency_key)
     values ($1,'grant',400,'grant', now() + interval '30 days', $2)`,
    [userId, `design-grant-${userId}`],
  ); // enough for the four runs below

  await both(browser, userState, "/welcome", "welcome");
  await both(browser, userState, "/investigations", "history-empty");
  await both(browser, userState, "/investigations/new", "new-investigation", async (p) => {
    await p.getByLabel("What do you want to investigate?").fill("LockBit ransomware group");
  });

  // one that completes
  await page.goto("/investigations/new");
  await page.getByLabel("What do you want to investigate?").fill("LockBit ransomware group");
  await page.getByRole("radio", { name: /Quick/ }).check();
  await page.getByRole("button", { name: "Start investigation" }).click();
  await expect(page).toHaveURL(/\/investigations\/[0-9a-f-]{36}$/);
  completedId = page.url().split("/").at(-1)!;
  await expect(page.locator('li[data-state="current"]')).toHaveCount(1, { timeout: 60_000 });
  await shot(page, "live-progress");
  await expect(page.getByTestId("run-completed")).toBeVisible({ timeout: 120_000 });

  // one that is cancelled
  await page.goto("/investigations/new");
  await page.getByLabel("What do you want to investigate?").fill("Lumma Stealer malware");
  await page.getByRole("radio", { name: /Quick/ }).check();
  await page.getByRole("button", { name: "Start investigation" }).click();
  await expect(page).toHaveURL(/\/investigations\/[0-9a-f-]{36}$/);
  cancelledId = page.url().split("/").at(-1)!;
  await expect(page.locator('li[data-state="current"]')).toHaveCount(1, { timeout: 60_000 });
  await page.getByRole("button", { name: /Cancel/ }).click();
  await expect(page.getByTestId("run-cancelled")).toBeVisible({ timeout: 60_000 });

  // one that fails (a completed run rewritten as failed), and one left running
  await page.goto("/investigations/new");
  await page.getByLabel("What do you want to investigate?").fill("CVE-2024-3400");
  await page.getByRole("radio", { name: /Quick/ }).check();
  await page.getByRole("button", { name: "Start investigation" }).click();
  await expect(page).toHaveURL(/\/investigations\/[0-9a-f-]{36}$/);
  const failedId = page.url().split("/").at(-1)!;
  await expect(page.getByTestId("run-completed")).toBeVisible({ timeout: 120_000 });
  await sql(`update investigations set status = 'failed', failure_reason = 'no_results' where id = $1`, [
    failedId,
  ]);

  await page.goto("/investigations/new");
  await page.getByLabel("What do you want to investigate?").fill("Scattered Spider initial access");
  await page.getByRole("radio", { name: /Quick/ }).check();
  await page.getByRole("button", { name: "Start investigation" }).click();
  await expect(page).toHaveURL(/\/investigations\/[0-9a-f-]{36}$/);
  runningId = page.url().split("/").at(-1)!;
  await expect(page.locator('li[data-state="current"]')).toHaveCount(1, { timeout: 60_000 });

  for (const size of SIZES) {
    const c = await browser.newContext({ viewport: size, storageState: userState });
    const p = await c.newPage();
    await p.goto(`/investigations/${runningId}`);
    await expect(p.locator('li[data-state="current"]')).toHaveCount(1, { timeout: 60_000 });
    await shot(p, "detail-running");
    await p.goto("/investigations");
    await shot(p, "history");
    await c.close();
  }
  await both(browser, userState, `/investigations/${completedId}`, "detail-completed");
  await both(browser, userState, `/investigations/${cancelledId}`, "detail-cancelled");
  await both(browser, userState, `/investigations/${failedId}`, "detail-failed");
  await both(browser, userState, "/settings", "settings");
  await both(browser, userState, "/settings/notifications", "notifications");
  await both(browser, userState, "/billing", "billing");
  await both(browser, userState, "/usage", "usage");
  await both(browser, userState, "/investigations/00000000-0000-4000-8000-000000000000", "not-found");
  await both(browser, userState, "/dev/ui", "dev-ui");
  await both(browser, userState, "/investigations?q=nothing-matches-this", "history-no-match");

  // dialogs and the menu, desktop only
  const c = await browser.newContext({ viewport: SIZES[0], storageState: userState });
  const p = await c.newPage();
  await p.goto("/settings");
  await p.getByRole("button", { name: "Delete my account" }).click();
  await shot(p, "dialog-delete-account");
  await p.keyboard.press("Escape");
  await p.getByRole("button", { name: "User menu" }).click();
  await shot(p, "user-menu");
  await c.close();

  // unsubscribe: a validly signed link
  process.env.BETTER_AUTH_SECRET = e2eEnv.BETTER_AUTH_SECRET;
  const { signUnsubscribe } = await import("../lib/ops/unsubscribe");
  await both(browser, userState, `/unsubscribe?u=${userId}&t=${signUnsubscribe(userId)}`, "unsubscribe");
  await both(browser, userState, `/unsubscribe?u=${userId}&t=bad`, "unsubscribe-invalid");
  await ctx.close();
});

test("admin flow", async ({ browser }) => {
  test.setTimeout(600_000);
  const email = uniqueEmail("design-admin");
  const ctx = await browser.newContext({ viewport: SIZES[0] });
  const page = await ctx.newPage();
  await signInWithCode(page, email, "Grace Hopper");
  await page.goto("/welcome");
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await setUserRole(OWNER, { email, role: "admin", reason: "design screenshots", actor: "design" });
  // the role is read per request; sign in again so the session reflects it
  await ctx.clearCookies();
  await signInWithCode(page, email, "Grace Hopper");
  adminState = join(OUT, ".admin-state.json");
  await ctx.storageState({ path: adminState });
  await ctx.close();

  await both(browser, adminState, "/admin", "admin-overview");
  await both(browser, adminState, "/admin/users", "admin-users");
  await both(browser, adminState, `/admin/users/${userId}`, "admin-user", async (p) => {
    await p.getByTestId("grant-details").locator("summary").click();
  });
  await both(browser, adminState, "/admin/abuse", "admin-abuse");
  await both(browser, adminState, "/admin/costs", "admin-costs");
  await both(browser, adminState, "/admin/archive?q=lockbit", "admin-archive");
  await both(browser, adminState, "/admin/founding", "admin-founding");
  await both(browser, adminState, "/admin/blocked-domains", "admin-blocked-domains");
  await both(browser, adminState, `/admin/review/${completedId}`, "admin-review-form");
  await both(
    browser,
    adminState,
    `/admin/review/${completedId}?reason=${encodeURIComponent("design review of a completed run")}`,
    "admin-review",
  );
});
