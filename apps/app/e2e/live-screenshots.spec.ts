import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { EMAIL_LOG } from "../playwright.config";
import { signUpAndVerify, uniqueEmail } from "./helpers";

/**
 * P8 frames and performance (opt-in):
 *   E2E_LIVE_SHOTS=<dir>  frames at 1440 and 390: early collect, mid filter with a full tray, extraction with the
 *                         graph, done.
 *   E2E_PERF=1            with MOCK_ENGINE_TRACE=full (~3000 events): frame time and heap over the run, written to
 *                         <dir>/perf.json (or stdout).
 */
const EMAILS = process.env.E2E_EMAIL_LOG ?? EMAIL_LOG;
const SHOTS = process.env.E2E_LIVE_SHOTS;

const num = async (page: Page, testId: string) =>
  Number(
    ((await page.getByTestId(testId).first().innerText()).match(/[\d,]+/)?.[0] ?? "0").replace(/,/g, ""),
  );

async function run(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await signUpAndVerify(page, uniqueEmail(`shots${width}`), "Frames", EMAILS);
  await page.goto("/investigations/new");
  await page.getByLabel("What do you want to investigate?").fill("LockBit ransomware group");
  await page.getByRole("radio", { name: /Quick/ }).check();
  await page.getByRole("button", { name: "Start investigation" }).click();
  await expect(page).toHaveURL(/\/investigations\/[0-9a-f-]{36}$/);
  await page.getByTestId("live-instrument").scrollIntoViewIfNeeded();
}

async function frame(page: Page, name: string) {
  mkdirSync(SHOTS!, { recursive: true });
  await page.getByTestId("live-instrument").screenshot({
    path: join(SHOTS!, `${page.viewportSize()!.width}-${name}.png`),
  });
}

for (const [w, h] of [
  [1440, 1000],
  [390, 844],
] as const) {
  test(`live frames at ${w}`, async ({ page }) => {
    test.skip(!SHOTS, "set E2E_LIVE_SHOTS to save frames");
    await run(page, w, h);
    await expect.poll(() => num(page, "stat-collect"), { timeout: 60_000 }).toBeGreaterThan(60);
    await frame(page, "1-early-collect");
    await expect.poll(() => num(page, "tray-total"), { timeout: 60_000 }).toBeGreaterThan(200);
    await frame(page, "2-mid-filter");
    await expect.poll(() => num(page, "stat-extract"), { timeout: 60_000 }).toBeGreaterThan(60);
    await page.waitForTimeout(1500);
    await frame(page, "3-extract-graph");
    await expect(page.getByTestId("run-completed")).toBeVisible({ timeout: 90_000 });
    await page.waitForTimeout(3000);
    await frame(page, "4-done");
  });
}

test("live view holds its frame rate at ~3000 events", async ({ page }) => {
  test.skip(!process.env.E2E_PERF, "set E2E_PERF=1 (and MOCK_ENGINE_TRACE=full on the server)");
  await run(page, 1440, 1000);
  const samples: {
    t: number;
    frameMs: number;
    p95Ms: number;
    workMs: number;
    particles: number;
    labels: number;
    heapMb: number | null;
  }[] = [];
  const t0 = Date.now();
  while (!(await page.getByTestId("run-completed").isVisible())) {
    const s = await page.evaluate(() => window.__vaLive ?? null);
    if (s) samples.push({ t: Date.now() - t0, ...s });
    if (Date.now() - t0 > 240_000) break;
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(4000);
  const end = await page.evaluate(() => window.__vaLive ?? null);
  const events = await page.evaluate(async (id) => {
    const r = await fetch(`/api/investigations/${id}/replay`);
    const b = (await r.json()) as { events: { type: string }[] };
    return { total: b.events.length, traces: b.events.filter((e) => e.type === "trace").length };
  }, page.url().split("/").pop()!);
  const out = { events, samples, end };
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(join(SHOTS, "perf.json"), JSON.stringify(out, null, 2));
  }
  console.log(JSON.stringify({ events, end, worstP95: Math.max(...samples.map((s) => s.p95Ms)) }));
  expect(events.traces).toBeGreaterThan(2000);
  // ~60 fps: mean frame gap under 20 ms, our own work well inside the frame budget
  expect(end!.frameMs).toBeLessThan(20);
  expect(end!.workMs).toBeLessThan(8);
  expect(end!.labels).toBeLessThanOrEqual(80);
});
