import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { EMAIL_LOG } from "../playwright.config";
import { signUpAndVerify, uniqueEmail } from "./helpers";

/**
 * P8 live view on the mock engine (contract-v2 traces on): URLs stream in, the discarded tray fills with reasons,
 * entities appear and the graph assembles, the run completes; replay plays the stored run; reduced motion shows the
 * calm log; no console errors. E2E_LIVE_SHOTS=<dir> also saves frames (early collect, mid filter, extract, done).
 */
const EMAILS = process.env.E2E_EMAIL_LOG ?? EMAIL_LOG;
const SHOTS = process.env.E2E_LIVE_SHOTS;

const num = async (page: Page, testId: string) =>
  Number(
    ((await page.getByTestId(testId).first().innerText()).match(/[\d,]+/)?.[0] ?? "0").replace(/,/g, ""),
  );

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const vw = page.viewportSize()?.width ?? 0;
  await page.screenshot({ path: join(SHOTS, `${vw}-${name}.png`), fullPage: false });
}

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function startRun(page: Page, query: string, depth: RegExp = /Quick/) {
  await page.goto("/investigations/new");
  await page.getByLabel("What do you want to investigate?").fill(query);
  await page.getByRole("radio", { name: depth }).check();
  await page.getByRole("button", { name: "Start investigation" }).click();
  await expect(page).toHaveURL(/\/investigations\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

test("live view: stream, tray, entities, graph, completion, trail, replay and reduced motion", async ({
  page,
  browser,
}) => {
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const email = uniqueEmail("live");
  await signUpAndVerify(page, email, "Live Tester", EMAILS);
  const id = await startRun(page, "LockBit ransomware group");

  const view = page.getByTestId("live-instrument");
  await expect(view).toBeVisible();
  await expect(page.getByTestId("live-canvas")).toBeVisible();

  // URLs stream in from the search engines
  await expect.poll(() => num(page, "stat-collect"), { timeout: 60_000 }).toBeGreaterThan(20);
  await shot(page, "1-collect");
  // noise falls into the tray with its reason
  await expect.poll(() => num(page, "tray-total"), { timeout: 60_000 }).toBeGreaterThan(20);
  await expect.poll(() => num(page, "tray-duplicate")).toBeGreaterThan(0);
  await expect.poll(() => num(page, "tray-irrelevant")).toBeGreaterThan(0);
  await shot(page, "2-filter");
  // entities rise and the graph assembles
  await expect.poll(() => num(page, "stat-extract"), { timeout: 60_000 }).toBeGreaterThan(5);
  await expect(page.getByTestId("stat-graph")).not.toHaveText("", { timeout: 60_000 });
  await shot(page, "3-extract");
  // fetch failures land in the same tray
  await expect
    .poll(async () => (await num(page, "tray-http_404")) + (await num(page, "tray-timeout")))
    .toBeGreaterThan(0);

  await expect(page.getByTestId("run-completed")).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('li[data-state="done"]')).toHaveCount(8);
  await page.waitForTimeout(2500);
  await shot(page, "4-done");

  // screen readers get one summary line, not a flood
  await expect(page.getByTestId("live-aria")).toHaveText(/\w/);

  // the trail of a discarded URL: found by an engine -> dropped with its reason
  await page.getByTestId("tray-irrelevant").click();
  await expect(page.getByTestId("tray-items")).toBeVisible();
  await page.getByTestId("tray-items").getByRole("button").first().click();
  await expect(page.getByTestId("trail-panel")).toContainText("Found");
  await expect(page.getByTestId("trail-panel")).toContainText("irrelevant");

  // safety-dropped items never show a host
  if ((await num(page, "tray-safety")) > 0) {
    await page.getByTestId("tray-safety").click();
    const items = page.getByTestId("tray-items");
    await expect(items).toContainText("removed by the safety filter");
    expect(await items.innerText()).not.toContain("[.]");
    await items.getByRole("button").first().click();
    await expect(page.getByTestId("trail-safety")).toBeVisible();
    expect(await page.getByTestId("trail-panel").innerText()).not.toContain("[.]");
  }

  // replay from the results page at 16x
  await page.goto(`/investigations/${id}/results`);
  await page.getByTestId("replay-run").click();
  await expect(page).toHaveURL(new RegExp(`/investigations/${id}/replay$`));
  await page.getByTestId("speed-16").click();
  await expect(page.getByText("It has finished.")).toBeVisible({ timeout: 90_000 });
  expect(await num(page, "tray-total")).toBeGreaterThan(20);

  // reduced motion: the calm log, same information, no canvas
  const ctx = await browser.newContext({
    reducedMotion: "reduce",
    storageState: await page.context().storageState(),
  });
  const calm = await ctx.newPage();
  const calmErrors = watchConsole(calm);
  await calm.goto(`/investigations/${id}`);
  await expect(calm.getByTestId("live-log")).toBeVisible();
  await expect(calm.getByTestId("live-canvas")).toHaveCount(0);
  await expect(calm.getByRole("list", { name: "Latest events" }).getByRole("listitem").first()).toBeVisible();
  await expect(calm.getByRole("list", { name: "Discarded, by reason" })).toContainText("irrelevant");
  await ctx.close();

  expect([...errors, ...calmErrors]).toEqual([]);
});
