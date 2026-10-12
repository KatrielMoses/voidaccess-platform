import { readFileSync, writeFileSync } from "node:fs";
import pg from "pg";
import { expect, test } from "@playwright/test";

const MAIL_LOG = "/tmp/va-site-e2e-mail.log";
const DB = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/voidaccess_site_test";

test("home → pricing → waitlist → confirm → confirmed", async ({ page }) => {
  writeFileSync(MAIL_LOG, "");
  const db = new pg.Pool({ connectionString: DB, max: 1 });
  await db.query("delete from waitlist");
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto("/?utm_source=e2e&ref=smoke");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Dark-web threat intelligence");
  const decline = page.getByRole("button", { name: "No thanks" });
  if (await decline.isVisible().catch(() => false)) await decline.click();

  await page.getByRole("link", { name: "See pricing" }).first().click();
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByTestId("seat-counter")).toContainText("100");

  await page.getByRole("link", { name: "Join the waitlist for a founding seat" }).click();
  await expect(page).toHaveURL(/\/waitlist\?founding=1/);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("What best describes you? (optional)").selectOption({ index: 1 });
  const submit = page.getByRole("button", { name: "Join the waitlist" });
  await expect(submit).toBeEnabled({ timeout: 30_000 }); // enabled once Turnstile (test keys) returns a token
  await submit.click();
  await expect(page).toHaveURL(/\/waitlist\/check-email$/);

  const row = (await db.query("select * from waitlist where email = $1", [email])).rows[0];
  expect(row.confirmed_at).toBeNull();
  expect(row.wants_founding).toBe(true);
  expect(row.first_touch.utm_source).toBe("e2e");
  expect(row.ref_code).toBe("smoke");

  await expect.poll(() => readFileSync(MAIL_LOG, "utf8"), { timeout: 10_000 }).toContain(email);
  const mail = JSON.parse(readFileSync(MAIL_LOG, "utf8").trim().split("\n").at(-1)!) as { text: string };
  const link = mail.text.match(/https?:\/\/\S+\/api\/waitlist\/confirm\?token=\S+/)![0];

  await page.goto(link);
  await expect(page).toHaveURL(/\/waitlist\/confirmed$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("You're on the list");
  expect((await db.query("select confirmed_at from waitlist where email = $1", [email])).rows[0].confirmed_at).not.toBeNull();
  await db.end();
});
