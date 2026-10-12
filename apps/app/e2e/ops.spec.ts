// Ops end-to-end: the admin console against a real server and database (mock engine).
//   An ordinary user gets 404 on every admin route; an admin suspends a user (whose session then fails), grants credits
//   (the balance updates), opens the cost view and removes archive data; the welcome email's unsubscribe link works.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import pg from "pg";
import { expect, test, type Page } from "@playwright/test";
import { OPS_ARCHIVE_STORE, OPS_CRON_SECRET, OPS_EMAIL_LOG } from "../playwright.ops.config";
import { findEmail, signUpAndVerify, uniqueEmail } from "./helpers";
import { ownerUrl } from "./ops-global-setup";
import { setUserRole } from "../lib/admin/role";
import { ADMIN_API, ADMIN_PAGES } from "../lib/admin/routes";

const SHOTS = process.env.SCREENSHOTS === "1";
const OUT = join(process.cwd(), "docs", "screenshots", "ops");
const ID = "00000000-0000-4000-8000-000000000000";

async function shot(page: Page, name: string, width = 1440) {
  if (!SHOTS) return;
  await page.waitForTimeout(500);
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: join(OUT, `${name}-${width}.png`), fullPage: true });
}

const owner = new pg.Pool({ connectionString: ownerUrl(), max: 2 });
test.afterAll(async () => {
  await owner.end();
});
const q = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) =>
  (await owner.query(sql, args)).rows as T[];

async function runToCompletion(page: Page, query: string) {
  await page.goto("/investigations/new");
  await page.getByLabel("What do you want to investigate?").fill(query);
  await page.getByRole("radio", { name: /Standard/ }).check();
  await page.getByRole("button", { name: "Start investigation" }).click();
  await expect(page).toHaveURL(/\/investigations\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("run-completed")).toBeVisible({ timeout: 120_000 });
  return /investigations\/([0-9a-f-]{36})/.exec(page.url())![1]!;
}

/** Open a collapsed <details> action form, fill the reason (and fields), submit. */
async function act(page: Page, testId: string, fields: Record<string, string>, reason: string) {
  const details = page.getByTestId(`${testId}-details`);
  // React may reuse a <details> that is already open (suspend swaps to unsuspend in the same slot)
  if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open)))
    await details.locator("summary").click();
  const form = page.getByTestId(testId);
  for (const [name, value] of Object.entries(fields)) {
    const el = form.locator(`[name="${name}"]`);
    if ((await el.evaluate((n) => n.tagName)) === "SELECT") await el.selectOption({ index: 0 });
    else await el.fill(value);
  }
  await form.locator('[name="reason"]').fill(reason);
  await form.getByRole("button").last().click();
  await expect(page.getByTestId(`${testId}-ok`)).toBeVisible();
}

test.describe.serial("ops console", () => {
  const adminEmail = uniqueEmail("ops-admin");
  const userEmail = uniqueEmail("ops-user");
  let userId = "";
  let adminId = "";
  let invId = "";
  const archiveValue = `p6-e2e-${Date.now()}.example`;
  const pageText = "p6 snapshot text";
  const pageHash = createHash("sha256").update(pageText).digest("hex");
  const sourceUrl = `https://${archiveValue}/leak`;

  test("an ordinary user gets 404 on every admin page and API; signed out is sent to sign-in", async ({
    browser,
    page,
  }) => {
    // signed out: the normal guard (the site's sign-in), not a 404
    const anon = await page.request.get("/admin", { maxRedirects: 0 });
    expect(anon.status()).toBe(307);
    expect(anon.headers().location).toContain("/sign-in");
    expect((await page.request.get("/api/admin/costs/export", { maxRedirects: 0 })).status()).toBe(401);

    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const p = await ctx.newPage();
    await signUpAndVerify(p, userEmail, "Ordinary User", OPS_EMAIL_LOG);
    userId = (await q<{ id: string }>("select id from users where email = $1", [userEmail]))[0]!.id;

    for (const route of ADMIN_PAGES) {
      const res = await p.request.get(route.replace("[id]", ID), { maxRedirects: 0 });
      expect(res.status(), route).toBe(404);
      // dev-mode 404 pages carry a stack trace with component names, so check for what only a rendered admin page has
      expect(await res.text(), route).not.toContain("Back to app");
    }
    for (const api of ADMIN_API)
      for (const method of api.methods) {
        const res = await p.request.fetch(api.path.replace("[id]", ID), {
          method,
          headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
          data:
            method === "GET"
              ? undefined
              : { reason: "probe probe probe", action: "ban", credits: 99, domain: "x.example" },
          maxRedirects: 0,
        });
        expect(res.status(), `${method} ${api.path}`).toBe(404);
      }
    // nothing was changed by those probes
    expect((await q("select status from users where id = $1", [userId]))[0]).toMatchObject({
      status: "active",
    });

    // the welcome email arrived once, with the one-click header, and its unsubscribe link works without signing in
    await expect
      .poll(() => findEmail(userEmail, "welcome", OPS_EMAIL_LOG) !== undefined, { timeout: 20_000 })
      .toBe(true);
    const mail = findEmail(userEmail, "welcome", OPS_EMAIL_LOG) as unknown as {
      text: string;
      headers: Record<string, string>;
    };
    expect(mail.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const link = /http:\/\/localhost:3800\/unsubscribe\?\S+/.exec(mail.text)![0];

    // settings, notifications (375 px)
    // the first compile of a page in dev mode can abort the navigation once
    await p.goto("/settings/notifications").catch(() => p.goto("/settings/notifications"));
    await expect(p.getByTestId("product-emails")).toBeChecked();
    await expect(p.getByText("Always on")).toBeVisible();
    await expect(p.getByText("Coming soon")).toBeVisible();
    await shot(p, "notification-settings", 375);

    const anonCtx = await browser.newContext();
    const ap = await anonCtx.newPage();
    await ap.goto(link);
    await ap.getByTestId("confirm-unsubscribe").click();
    await expect(ap.getByTestId("unsubscribed")).toBeVisible();
    await anonCtx.close();
    expect((await q("select product_emails from users where id = $1", [userId]))[0]).toMatchObject({
      product_emails: false,
    });
    await p.reload();
    await expect(p.getByTestId("product-emails")).not.toBeChecked();
    // and back on, from the settings page itself
    await p.getByTestId("product-emails").click();
    await expect(p.getByText("Saved.")).toBeVisible();
    expect((await q("select product_emails from users where id = $1", [userId]))[0]).toMatchObject({
      product_emails: true,
    });

    // the ordinary user runs an investigation (feeds costs, the funnel and the star prompt)
    invId = await runToCompletion(p, "ops e2e query");
    await p.goto(`/investigations/${invId}/results/summary`);
    await expect(p.getByTestId("star-prompt")).toBeVisible();
    const dismissed = p.waitForResponse((r) => r.url().includes("/api/account/star-prompt"));
    await p.getByRole("button", { name: "Dismiss" }).click();
    expect((await dismissed).status()).toBe(200);
    await p.reload();
    await expect(p.getByTestId("star-prompt")).toHaveCount(0);
    expect(
      (await q("select star_prompt_dismissed_at from users where id = $1", [userId]))[0]!
        .star_prompt_dismissed_at,
    ).not.toBeNull();
    await ctx.close();

    // fixtures the mock engine doesn't produce: a measured cost (if the run didn't report one) and abuse items
    await q(
      `insert into run_costs (investigation_id, compute_usd, llm_usd, tokens_in, tokens_out, duration_ms)
       values ($1, 0.012, 0.021, 1000, 300, 60000) on conflict do nothing`,
      [invId],
    );
    for (let i = 0; i < 3; i++)
      await q(
        `insert into investigations (user_id, query, depth, status, failure_reason) values ($1, $2, 'quick', 'failed', 'blocked_query')`,
        [userId, `blocked e2e query ${i}`],
      );
    await q(`insert into abuse_flags (user_id, kind, detail) values ($1, 'dispute', '{"amount":9}')`, [
      userId,
    ]);
  });

  test("an admin signs in and sees the overview", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await signUpAndVerify(page, adminEmail, "Ops Admin", OPS_EMAIL_LOG);
    adminId = (await q<{ id: string }>("select id from users where email = $1", [adminEmail]))[0]!.id;
    // not an admin until the ops script says so
    expect((await page.request.get("/admin", { maxRedirects: 0 })).status()).toBe(404);
    const r = await setUserRole(ownerUrl(), {
      email: adminEmail,
      role: "admin",
      reason: "e2e admin",
      actor: "e2e",
    });
    expect(r.changed).toBe(true);

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByTestId("stat-signups-7")).toContainText(/[2-9]/);
    await expect(page.getByTestId("cohorts")).toBeVisible();
    await expect(page.getByTestId("stat-founding")).toContainText("/ 100");
    await shot(page, "admin-overview");
    await page
      .context()
      .storageState({ path: join(process.cwd(), "test-results", "ops", "admin-state.json") });
    await ctx.close();
  });

  test("the admin suspends the user (their session then fails), then restores and grants credits", async ({
    browser,
  }) => {
    const adminCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      storageState: join(process.cwd(), "test-results", "ops", "admin-state.json"),
    });
    const admin = await adminCtx.newPage();
    // a second, signed-in session for the user
    const userCtx = await browser.newContext();
    const user = await userCtx.newPage();
    const signedIn = await user.request.post("/api/auth/sign-in/email", {
      data: { email: userEmail, password: "e2e correct horse battery" },
      headers: { "x-captcha-response": "XXXX.DUMMY.TOKEN.XXXX" },
    });
    expect(signedIn.ok()).toBeTruthy();
    const bal = async () =>
      ((await (await user.request.get("/api/account/balance")).json()) as { total: number }).total;
    const before = await bal();
    expect(before).toBeGreaterThan(0);

    await admin.goto("/admin/users");
    await admin.getByTestId("user-search").fill(userEmail.slice(0, 14));
    await admin.getByTestId("user-search").press("Enter");
    await admin.getByRole("link", { name: userEmail }).click();
    await expect(admin).toHaveURL(new RegExp(`/admin/users/${userId}`));
    await expect(admin.getByTestId("ref-code")).toBeVisible();
    await expect(admin.getByTestId("investigations")).toContainText("ops e2e query");
    await expect(
      admin.getByTestId("investigations").getByRole("link", { name: "Open for abuse review" }),
    ).toBeVisible();
    await shot(admin, "admin-user-detail");

    await act(admin, "suspend", {}, "e2e: suspending to prove the session fails");
    await expect(admin.getByTestId("user-badges")).toContainText("suspended");

    // the suspended user's session fails: APIs answer 403, pages bounce to the site's inactive sign-in
    expect((await user.request.get("/api/account/balance")).status()).toBe(403);
    const page = await user.request.get("/investigations/new", { maxRedirects: 0 });
    expect(page.status()).toBe(307);
    expect(page.headers().location).toContain("error=inactive");

    const rows = await q(
      "select actor, action, target, meta from audit_log where action = 'admin.user.suspend' and target = $1",
      [userId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: adminId });
    expect((rows[0] as { meta: { reason: string } }).meta.reason).toContain("session fails");

    await act(admin, "unsuspend", {}, "e2e: restoring access after the check");
    await expect(admin.getByTestId("user-badges")).toContainText("active");
    expect(await bal()).toBe(before);

    // grant credits: the balance updates
    await act(admin, "grant", { credits: "500" }, "e2e: grant for the balance check");
    await expect(admin.getByTestId("credits-topup")).toContainText("500");
    expect(await bal()).toBe(before + 500);
    expect(
      (await q("select 1 from audit_log where action = 'admin.credits.grant' and target = $1", [userId]))
        .length,
    ).toBe(1);

    await userCtx.close();
    await adminCtx.close();
  });

  test("the admin opens the abuse queue, the cost view and the audited abuse review", async ({ browser }) => {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      storageState: join(process.cwd(), "test-results", "ops", "admin-state.json"),
    });
    const page = await ctx.newPage();

    await page.goto("/admin/abuse");
    await expect(page.getByTestId("repeat-users")).toContainText(userEmail);
    await expect(page.getByTestId("blocked-runs")).toContainText("blocked e2e query 0");
    await expect(page.getByTestId("flags")).toContainText("dispute");
    await expect(page.getByTestId("rate-limits")).toContainText("None");
    await shot(page, "admin-abuse-queue");
    const flagDetails = page.locator('details[data-testid^="review-flag-"]').first();
    const flagForm = flagDetails.locator("form");
    await flagDetails.locator("summary").click();
    await flagForm.locator('[name="reason"]').fill("e2e: dispute checked, legitimate");
    await flagForm.getByRole("button").last().click();
    // a reviewed item leaves the queue on refresh, so its success note vanishes with it: check the data
    await expect(page.getByTestId("flags")).toContainText("No open flags");
    expect(
      (await q("select status from abuse_flags where kind = 'dispute' and user_id = $1", [userId]))[0],
    ).toMatchObject({ status: "reviewed" });
    expect(
      (await q("select 1 from audit_log where action = 'admin.abuse.review' and target = $1", [userId]))
        .length,
    ).toBe(1);

    await page.goto("/admin/costs?days=1");
    await expect(page.getByTestId("by-depth")).toContainText("standard");
    await expect(page.getByTestId("by-depth")).toContainText("%");
    await expect(page.getByTestId("runs")).toContainText(invId.slice(0, 8));
    await shot(page, "admin-costs");
    const csv = await page.request.get("/api/admin/costs/export?days=1");
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const body = await csv.text();
    expect(body).toContain(invId);
    expect(body).not.toContain("ops e2e query"); // no query text in the cost export
    expect((await q("select 1 from audit_log where action = 'admin.costs.export'")).length).toBeGreaterThan(
      0,
    );

    // results are reachable only through the audited, reasoned action
    await page.goto(`/admin/review/${invId}`);
    await expect(page.getByTestId("review-form")).toBeVisible();
    await expect(page.getByTestId("review-query")).toHaveCount(0);
    await page.getByLabel(/Reason/).fill("e2e: abuse review of a completed run");
    await page.getByRole("button", { name: "Open results" }).click();
    await expect(page.getByTestId("review-query")).toContainText("ops e2e query");
    expect(
      (
        await q(
          "select actor, meta from audit_log where action = 'admin.investigation.open_review' and target = $1",
          [`investigation:${invId}`],
        )
      )[0],
    ).toMatchObject({ actor: adminId });
    await ctx.close();
  });

  test("the admin removes an archive entity and a stored page", async ({ browser }) => {
    // fixtures: an entity, a source and its stored snapshot object
    await q(
      `insert into archive_entities (type, canonical_value, display_value, first_seen, last_seen) values ('domain', $1, $1, now(), now())`,
      [archiveValue],
    );
    await q(
      `insert into archive_sources (url, first_seen, last_seen, host, content_hash, snapshot_path) values ($1, now(), now(), $2, $3, $4)`,
      [sourceUrl, archiveValue, pageHash, `pages/${pageHash}.txt.gz`],
    );
    const objectPath = join(OPS_ARCHIVE_STORE, "pages", `${pageHash}.txt.gz`);
    mkdirSync(dirname(objectPath), { recursive: true });
    writeFileSync(objectPath, pageText);
    expect(existsSync(objectPath)).toBe(true);

    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      storageState: join(process.cwd(), "test-results", "ops", "admin-state.json"),
    });
    const page = await ctx.newPage();
    await page.goto("/admin/archive");
    await page.getByTestId("archive-search").fill(archiveValue);
    await page.getByTestId("archive-search").press("Enter");
    const hits = page.getByTestId("archive-hit");
    await expect(hits).toHaveCount(3); // the entity, the source and its page

    // entity
    const entityRow = hits.filter({ hasText: "domain:" });
    await entityRow.locator("summary").click();
    await entityRow.locator('[name="reason"]').fill("e2e: legal takedown ticket 123");
    await shot(page, "admin-archive-removal-form");
    await entityRow.getByRole("button", { name: /Remove this entity/ }).click();
    await expect(entityRow.getByText("Removed")).toBeVisible();
    expect(
      (await q("select tombstoned_at from archive_entities where canonical_value = $1", [archiveValue]))[0]!
        .tombstoned_at,
    ).not.toBeNull();

    // page: tombstone + the stored object is deleted + the hash is remembered
    const pageRow = hits.filter({ hasText: "page " });
    await pageRow.locator("summary").click();
    await pageRow.locator('[name="reason"]').fill("e2e: poisoned page");
    await pageRow.getByRole("button", { name: /Remove this page/ }).click();
    await expect.poll(() => existsSync(objectPath)).toBe(false);
    expect((await q("select 1 from archive_removed_pages where content_hash = $1", [pageHash])).length).toBe(
      1,
    );

    await page.reload();
    await expect(page.getByTestId("removals")).toContainText("legal takedown ticket 123");
    await expect(page.getByTestId("removals")).toContainText("poisoned page");
    await shot(page, "admin-archive-removal");
    const audits = await q(
      "select actor, meta from audit_log where action = 'archive.remove' order by at desc limit 2",
    );
    expect(audits).toHaveLength(2);
    for (const a of audits) expect(a).toMatchObject({ actor: adminId });
    await ctx.close();
  });

  test("the lifecycle cron runs with the shared secret", async ({ request }) => {
    const res = await request.post("/api/cron/lifecycle", {
      headers: { authorization: `Bearer ${OPS_CRON_SECRET}` },
    });
    expect(res.status()).toBe(200);
    expect((await request.post("/api/cron/lifecycle")).status()).toBe(401);
  });
});
