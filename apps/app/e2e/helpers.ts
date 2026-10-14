import { readFileSync, existsSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { EMAIL_LOG } from "../playwright.config";

export const CAPTCHA = { "x-captcha-response": "XXXX.DUMMY.TOKEN.XXXX" }; // Cloudflare's always-pass test token

export function uniqueEmail(tag = "e2e") {
  return `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
}

/** The newest logged email to `to` for `template`, as parsed JSONL (the log transport appends one JSON object per line). */
export function findEmail(
  to: string,
  template: string,
  file: string = EMAIL_LOG,
): { subject: string; text: string } | undefined {
  return emailsTo(to, template, file).at(-1);
}

function emailsTo(to: string, template: string, file: string) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { to: string; template: string; subject: string; text: string })
    .filter((m) => m.to === to && m.template === template);
}

/**
 * Signs in the way the site's form does: ask for a code (with the captcha header), read the 6-digit code from this
 * run's email log, send it back. The first sign-in creates the account; the session cookie lands in the page's
 * context. The real site pages are covered by the site's own e2e suite.
 */
export async function signInWithCode(page: Page, email: string, name = "E2E Tester", emailLog = EMAIL_LOG) {
  const before = emailsTo(email, "signInCode", emailLog).length;
  const sent = await page.request.post("/api/auth/email-otp/send-verification-otp", {
    data: { email, type: "sign-in" },
    headers: CAPTCHA,
  });
  expect(sent.ok(), "code request").toBeTruthy();
  await expect
    .poll(() => emailsTo(email, "signInCode", emailLog).length, { timeout: 15_000 })
    .toBeGreaterThan(before);
  const otp = /\b(\d{6})\b/.exec(findEmail(email, "signInCode", emailLog)!.subject)?.[1];
  expect(otp, "code in the logged email").toBeTruthy();
  const res = await page.request.post("/api/auth/sign-in/email-otp", { data: { email, otp, name } });
  expect(res.ok(), "sign-in with the code").toBeTruthy();
}

/** A new account, signed in, past the one-time Acceptable Use Policy step, landing on /welcome. */
export async function signUpAndVerify(page: Page, email: string, name = "E2E Tester", emailLog = EMAIL_LOG) {
  await signInWithCode(page, email, name, emailLog);
  await page.goto("/welcome");
  await expect(page).toHaveURL(/\/accept-terms/);
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/welcome/);
}

/** The number in the header credit pill. */
export async function pillBalance(page: Page): Promise<number> {
  const text = (await page.getByTestId("credit-pill").innerText()).replace(/[^0-9]/g, "");
  return Number(text);
}
