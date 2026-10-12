import { existsSync, readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { ARCHIVE_EMAIL_LOG } from "../playwright.archive.config";
import { PASSWORD } from "./helpers";

export const uniqueEmail = (tag: string) =>
  `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

/** Sign up and verify through the log transport (this run's own email log). */
export async function signUpAndVerify(page: Page, email: string, name: string) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/check-email/);
  let link: string | undefined;
  await expect
    .poll(
      () => {
        if (!existsSync(ARCHIVE_EMAIL_LOG)) return false;
        for (const line of readFileSync(ARCHIVE_EMAIL_LOG, "utf8").split("\n").filter(Boolean).reverse()) {
          const m = JSON.parse(line) as { to: string; template: string; text: string };
          if (m.to === email && m.template === "verifyEmail")
            return (link = /https?:\/\/\S+/.exec(m.text)?.[0]) !== undefined;
        }
        return false;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  await page.goto(link!);
  await expect(page).toHaveURL(/\/welcome/);
}
