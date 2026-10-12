import { readFileSync, existsSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { EMAIL_LOG } from "../playwright.config";

export const PASSWORD = "e2e correct horse battery";

export function uniqueEmail(tag = "e2e") {
  return `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

/** The newest logged email to `to` for `template`, as parsed JSONL (the log transport appends one JSON object per line). */
export function findEmail(
  to: string,
  template: string,
  file: string = EMAIL_LOG,
): { text: string } | undefined {
  if (!existsSync(file)) return undefined;
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  for (const line of lines.reverse()) {
    const m = JSON.parse(line) as { to: string; template: string; text: string };
    if (m.to === to && m.template === template) return m;
  }
  return undefined;
}

/**
 * Sign-up now lives on the site, so the app's e2e suites make the request the site's form makes (POST to Better
 * Auth with the AUP flag), then follow the verification link from the log transport. The cross-domain flow
 * through the real site pages is covered by e2e/cross-domain.spec.ts.
 */
export async function signUpAndVerify(page: Page, email: string, name = "E2E Tester", emailLog = EMAIL_LOG) {
  const res = await page.request.post("/api/auth/sign-up/email", {
    data: { name, email, password: PASSWORD, aupAccepted: true, callbackURL: "/welcome" },
  });
  expect(res.ok(), "sign-up").toBeTruthy();

  let msg: { text: string } | undefined;
  await expect
    .poll(() => (msg = findEmail(email, "verifyEmail", emailLog)) !== undefined, { timeout: 15_000 })
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
