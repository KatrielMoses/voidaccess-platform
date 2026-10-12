// Screenshots of the P2 screens at 375 px and 1440 px -> docs/screenshots/<name>-<width>.png
//   pnpm --filter @voidaccess/app test:screenshots
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signUpAndVerify, uniqueEmail } from "./helpers";

const OUT = join(process.cwd(), "docs", "screenshots");
const SIZES = [
  { width: 375, height: 812 },
  { width: 1440, height: 900 },
] as const;

async function shot(page: Page, name: string, width: number) {
  await page.waitForTimeout(400); // let fonts and animations settle
  await page.screenshot({ path: join(OUT, `${name}-${width}.png`), fullPage: true });
}

for (const size of SIZES) {
  test(`screenshots at ${size.width}px`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: size });
    const page = await ctx.newPage();

    await page.goto("/sign-up");
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
    await shot(page, "sign-up", size.width);

    await signUpAndVerify(page, uniqueEmail("shot"), "Ada Lovelace");
    await expect(page.getByRole("heading", { name: /Welcome/ })).toBeVisible();
    await shot(page, "first-run", size.width);

    await page.goto("/investigations/new");
    await page.getByLabel("What do you want to investigate?").fill("CVE-2024-3400");
    await shot(page, "new-investigation", size.width);

    await page.getByRole("button", { name: "Start investigation" }).click();
    await expect(page).toHaveURL(/\/investigations\/[0-9a-f-]{36}$/);
    await expect(page.locator("li", { hasText: "Read pages" }).first()).toHaveAttribute(
      "data-state",
      /current|done/,
      { timeout: 60_000 },
    );
    await shot(page, "live-progress", size.width);
    await expect(page.getByTestId("run-completed")).toBeVisible({ timeout: 90_000 });

    await page.goto("/investigations");
    await expect(page.getByRole("link", { name: "CVE-2024-3400" })).toBeVisible();
    await shot(page, "history", size.width);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await shot(page, "settings", size.width);
    await ctx.close();
  });
}
