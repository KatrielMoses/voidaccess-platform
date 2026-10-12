import type { Page } from "@playwright/test";
import { ARCHIVE_EMAIL_LOG } from "../playwright.archive.config";
import { signUpAndVerify as signUpViaApi } from "./helpers";

export const uniqueEmail = (tag: string) =>
  `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

/**
 * Sign up and verify through the app's auth API and this run's own email log. Sign-up pages live on the site
 * since D1, so the archive suite uses the same API path as the app suite (helpers.ts).
 */
export async function signUpAndVerify(page: Page, email: string, name: string) {
  await signUpViaApi(page, email, name, ARCHIVE_EMAIL_LOG);
}
