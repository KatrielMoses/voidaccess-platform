import { readFileSync, existsSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { EMAIL_LOG } from "../playwright.config";

export const PASSWORD = "e2e correct horse battery";

export function uniqueEmail(tag = "e2e") {
  return `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

/** The newest logged email to `to` for `template`, as parsed JSONL (the log transport appends one JSON object per line). */
export function findEmail(to: string, template: string): { text: string } | undefined {
  if (!existsSync(EMAIL_LOG)) return undefined;
  const lines = readFileSync(EMAIL_LOG, "utf8").split("\n").filter(Boolean);
  for (const line of lines.reverse()) {
    const m = JSON.parse(line) as { to: string; template: string; text: string };
    if (m.to === to && m.template === template) return m;
  }
  return undefined;
}

export async function signUpAndVerify(page: Page, email: string, name = "E2E Tester") {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/check-email/);

  let msg: { text: string } | undefined;
  await expect
    .poll(() => (msg = findEmail(email, "verifyEmail")) !== undefined, { timeout: 15_000 })
    .toBe(true);
  const link = /https?:\/\/\S+/.exec(msg!.text)?.[0];
  expect(link, "verification link in the logged email").toBeTruthy();
  await page.goto(link!);
  await expect(page).toHaveURL(/\/welcome/);
}

/** The number in the header credit pill. */
export async function pillBalance(page: Page): Promise<number> {
  const text = (await page.getByTestId("credit-pill").innerText()).replace(/[^0-9]/g, "");
  return Number(text);
}
