import { mkdirSync, readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { RESULTS_EMAIL_LOG } from "../playwright.results.config";
import { signInWithCode } from "./helpers";

// 2.2 relevance tiers on the results pages: tiered, legacy (no tiers: unchanged) and empty-Direct runs.
const S = JSON.parse(readFileSync(new URL("./.state/state.json", import.meta.url), "utf8")) as Record<
  string,
  string
>;
const SHOTS = new URL("../docs/screenshots/relevance/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });
const base = (id: string) => `/investigations/${id}/results`;
// sign-in codes are rate limited: sign in once and reuse the session in every test
let session: Parameters<BrowserContext["addCookies"]>[0] | null = null;
const as = async (page: Page, user: string) => {
  if (session) return page.context().addCookies(session);
  await page.context().clearCookies();
  await signInWithCode(page, `${user}@e2e.local`, "E2E", RESULTS_EMAIL_LOG);
  session = await page.context().cookies();
};

test.use({ viewport: { width: 1440, height: 1000 } });

test("tiered run: Direct first, Background collapsed, tier panel and exports", async ({ page }) => {
  await as(page, S.pro!);
  await page.goto(`${base(S.tiered!)}/entities`);
  await expect(page.getByTestId("entities-tier-direct")).toHaveCount(1, { timeout: 30_000 });
  const direct = page.getByTestId("entities-tier-direct");
  const background = page.getByTestId("entities-tier-background");
  await expect(direct.getByTestId("entity-row").first()).toBeVisible({ timeout: 30_000 });
  await expect(background).toContainText("collected, not about your query");
  await expect(background.getByTestId("entity-row")).toHaveCount(0);
  await expect(page.getByTestId("no-direct-notice")).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}tiered-entities-1440.png`, fullPage: true });
  await page.getByTestId("toggle-background").click();
  await expect(background.getByTestId("entity-row").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}tiered-entities-background-open-1440.png`, fullPage: true });

  await page.goto(`${base(S.tiered!)}/sources`);
  await expect(page.getByTestId("sources-tier-direct").getByTestId("source-item").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}tiered-sources-1440.png`, fullPage: true });

  await page.goto(`${base(S.tiered!)}/summary`);
  await expect(page.getByTestId("relevance-panel")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}tiered-summary-1440.png`, fullPage: true });

  const res = await page.request.get(`/api/investigations/${S.tiered}/exports/json`);
  const json = (await res.json()) as { relevance: unknown; entities: { relevance: string }[] };
  expect(json.relevance).not.toBeNull();
  expect(new Set(json.entities.map((e) => e.relevance))).toEqual(
    new Set(["direct", "related", "background"]),
  );
});

test("legacy run (no tiers) renders as before", async ({ page }) => {
  await as(page, S.pro!);
  await page.goto(`${base(S.small!)}/entities`);
  await expect(page.getByTestId("entity-row").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("entities-tier-direct")).toHaveCount(0);
  await expect(page.getByTestId("no-direct-notice")).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}legacy-entities-1440.png`, fullPage: true });
  await page.goto(`${base(S.small!)}/summary`);
  await expect(page.getByTestId("summary-markdown")).toBeVisible();
  await expect(page.getByTestId("relevance-panel")).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}legacy-summary-1440.png`, fullPage: true });
});

test("empty Direct: an honest notice on every tab instead of noise as findings", async ({ page }) => {
  await as(page, S.pro!);
  await page.goto(`${base(S.noDirect!)}/entities`);
  await expect(page.getByTestId("no-direct-notice")).toContainText("Nothing collected mentions");
  // next dev can briefly hold a streamed copy of the Suspense content next to the revealed one
  await expect(page.getByTestId("entities-tier-direct")).toHaveCount(1);
  await expect(page.getByTestId("entities-tier-direct")).toContainText("Nothing collected names");
  await page.screenshot({ path: `${SHOTS}empty-direct-entities-1440.png`, fullPage: true });
  await page.goto(`${base(S.noDirect!)}/summary`);
  await expect(page.getByTestId("no-direct-notice")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}empty-direct-summary-1440.png`, fullPage: true });
  await page.goto(`${base(S.noDirect!)}/graph`);
  await expect(page.getByTestId("no-direct-notice")).toBeVisible();
});
