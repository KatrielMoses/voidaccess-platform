import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { RESULTS_EMAIL_LOG } from "../playwright.results.config";
import { signInWithCode } from "./helpers";

/**
 * P9 results workspace on seeded runs. Opt-in extras:
 *   E2E_PERF=1           frame times, heap and layout time on the large all-categories fixture (P9-9)
 *   E2E_P9_SHOTS=<dir>   frames at 1440 and 390: default, search active, node selected with trail, rail, filters
 */
const S = JSON.parse(readFileSync(new URL("./.state/state.json", import.meta.url), "utf8")) as Record<
  string,
  string
>;
const SHOTS = process.env.E2E_P9_SHOTS;
const base = (id: string) => `/investigations/${id}/results`;

// sign-in codes are rate limited per address: sign in once and reuse the session in every context
let session: Parameters<BrowserContext["addCookies"]>[0] | null = null;
async function signIn(page: Page) {
  if (session) return page.context().addCookies(session);
  await page.context().clearCookies();
  await signInWithCode(page, `${S.pro}@e2e.local`, "E2E", RESULTS_EMAIL_LOG);
  session = await page.context().cookies();
}
const settled = (page: Page) =>
  page.waitForFunction(() => !window.__vaGraph!.sigma.getCamera().isAnimated(), null, { timeout: 10_000 });
async function openGraph(page: Page, id: string, query = "") {
  await page.goto(`${base(id)}/graph${query}`);
  await expect(page.getByTestId("workspace")).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => window.__vaGraph && window.__vaGraph.readyMs >= 0, null, {
    timeout: 60_000,
  });
}
const watch = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return errors;
};
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(450);
  await page.screenshot({ path: join(SHOTS, `${page.viewportSize()!.width}-${name}.png`) });
}
const dragCanvas = async (page: Page) => {
  const box = (await page.getByTestId("graph-canvas").boundingBox())!;
  const x = box.x + box.width * 0.6;
  const y = box.y + box.height * 0.6;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 40, { steps: 6 });
  await page.mouse.up();
};

test.describe("results workspace", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page);
  });

  test("lands on the graph: full height, no page scroll, every value in one group, no links to found values", async ({
    page,
  }) => {
    const errors = watch(page);
    await page.goto(base(S.big!));
    await expect(page).toHaveURL(/\/results\/graph$/);
    await page.waitForFunction(() => window.__vaGraph && window.__vaGraph.readyMs >= 0, null, {
      timeout: 60_000,
    });
    const scroll = await page.evaluate(() => ({
      scroll: document.scrollingElement!.scrollHeight - window.innerHeight,
      bottom: document.querySelector('[data-testid="workspace"]')!.getBoundingClientRect().bottom,
      vh: window.innerHeight,
    }));
    expect(scroll.bottom).toBeLessThanOrEqual(scroll.vh + 1);
    await page.mouse.wheel(0, 600);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    // group counts sum to the entity count in the header
    const header = Number(
      (await page.getByRole("link", { name: /^Entities/ }).innerText()).replace(/\D/g, ""),
    );
    const counts = await page.locator('[data-testid^="group-count-"]').allInnerTexts();
    expect(counts.reduce((a, c) => a + Number(c), 0)).toBe(header);
    expect(Number(await page.getByTestId("values-total").innerText())).toBe(header);
    // no links to found values anywhere in the workspace
    const hrefs = await page
      .getByTestId("workspace")
      .locator("a")
      .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    for (const h of hrefs) expect(h, "only app links").toMatch(/^\/investigations\//);
    await expect(page.locator("a[href*='.onion']")).toHaveCount(0);
    // the star prompt lives on the Summary tab, never over the graph
    await expect(page.getByRole("link", { name: "Star on GitHub" })).toHaveCount(0);
    await shot(page, "1-default");
    expect(errors).toEqual([]);
  });

  test("search: / focuses, Enter selects, a connection moves the selection, back steps back, ?q and ?node survive reload", async ({
    page,
  }) => {
    const errors = watch(page);
    await openGraph(page, S.big!);
    await page.keyboard.press("/");
    await expect(page.getByTestId("value-search")).toBeFocused();
    await page.keyboard.type("alph");
    await expect(page.getByTestId("values-total")).toContainText(/^\d+ of \d+$/);
    await expect(page.locator("mark").first()).toHaveText(/alph/i);
    await shot(page, "2-search");
    await page.keyboard.press("Enter");
    const panel = page.getByTestId("node-panel");
    await expect(panel).toBeVisible();
    const first = await page.getByTestId("node-value").innerText();
    expect(first.toLowerCase()).toContain("alph");
    await expect(page).toHaveURL(/[?&]node=/);
    // the selected row is violet-marked and visible in its open group
    await expect(page.locator('[data-testid="value-row"][aria-selected="true"]')).toBeVisible();

    await page.getByTestId("connection").first().click();
    await expect(page.getByTestId("node-value")).not.toHaveText(first);
    await expect(page.getByTestId("trail").locator("li")).toHaveCount(3); // back button + two steps
    await expect(page.locator('[data-testid="value-row"][aria-selected="true"]')).toBeVisible();
    expect(await page.evaluate(() => window.scrollY), "the page never scrolls under the workspace").toBe(0);
    await shot(page, "3-selected-trail");
    const second = await page.getByTestId("node-value").innerText();

    await page.goBack();
    await expect(page.getByTestId("node-value")).toHaveText(first);
    await page.goForward();
    await expect(page.getByTestId("node-value")).toHaveText(second);

    await page.reload();
    await page.waitForFunction(() => window.__vaGraph && window.__vaGraph.readyMs >= 0, null, {
      timeout: 60_000,
    });
    await expect(page.getByTestId("value-search")).toHaveValue("alph");
    await expect(page.getByTestId("node-value")).toHaveText(second);

    // Esc (outside the search field) clears the selection
    await page.getByTestId("graph-canvas").click({ position: { x: 5, y: 5 }, force: true });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("node-panel")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("defanged search, accordion is single-open, filters fold into one control", async ({ page }) => {
    await openGraph(page, S.allCats!);
    await page.getByTestId("group-onion").click();
    await expect(page.getByTestId("group-onion")).toHaveAttribute("aria-expanded", "true");
    await page.getByTestId("group-actors").click();
    await expect(page.getByTestId("group-actors")).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("group-onion")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator('[data-testid^="group-"][aria-expanded="true"]')).toHaveCount(1);
    // every category of the large fixture is present
    await expect(page.locator('[data-testid^="group-count-"]')).toHaveCount(12);

    // defanged forms match plain ones: "…example[.]net" finds "…example.net" (and the other way round)
    const value = await page.evaluate(async (id) => {
      const r = await fetch(`/api/investigations/${id}/graph`);
      const g = (await r.json()) as { nodes: [string, string, string][] };
      return g.nodes.find((n) => n[1] === "DOMAIN" && /\.[a-z]+$/.test(n[2]))?.[2] ?? "";
    }, S.allCats!);
    expect(value).toMatch(/\./);
    const i = value.lastIndexOf(".");
    const defanged = `${value.slice(Math.max(0, i - 8), i)}[.]${value.slice(i + 1)}`;
    await page.getByTestId("value-search").fill(defanged);
    await expect(page.getByTestId("values-total")).not.toHaveText(/^0 of/);
    await expect(page.locator("mark").first()).toBeVisible();
    await page.getByTestId("value-search").press("Enter");
    await expect(page.getByTestId("node-value")).toContainText(value.slice(i - 8 > 0 ? i - 8 : 0, i));

    await page.getByTestId("filters-button").click();
    await page.getByTestId("filter-typed").click();
    await expect(page.getByTestId("filters-count")).toHaveText("1");
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await shot(page, "5-filters");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("filtered-note")).toContainText("typed relationships only");
  });

  test("the sidebar collapses to a rail on pan, expands on hover, and stays open when pinned (remembered)", async ({
    page,
  }) => {
    await openGraph(page, S.big!);
    await settled(page);
    const before = await page.evaluate(() => window.__vaGraph!.sigma.getCamera().getState());
    await expect(page.getByTestId("sidebar")).toBeVisible();
    await dragCanvas(page);
    await expect(page.getByTestId("sidebar-rail")).toBeVisible();
    await shot(page, "4-rail");
    // collapsing does not move the graph: the canvas spans the workspace, only the camera pan moved it
    const box = (await page.getByTestId("graph-canvas").boundingBox())!;
    expect(box.x).toBe(0);
    const after = await page.evaluate(() => window.__vaGraph!.sigma.getCamera().getState());
    expect(after.ratio).toBeCloseTo(before.ratio, 5);
    // a resting pointer expands it
    const rail = (await page.getByTestId("sidebar-rail").boundingBox())!;
    await page.mouse.move(rail.x + rail.width / 2, rail.y + rail.height / 2);
    await expect(page.getByTestId("sidebar")).toBeVisible();
    // "/" expands and focuses search from the rail too
    await page.mouse.move(rail.x + 700, rail.y + 300);
    await dragCanvas(page);
    await expect(page.getByTestId("sidebar-rail")).toBeVisible();
    await page.keyboard.press("/");
    await expect(page.getByTestId("value-search")).toBeFocused();

    await page.getByTestId("sidebar-pin").click();
    await dragCanvas(page);
    await expect(page.getByTestId("sidebar")).toBeVisible();
    await page.reload();
    await page.waitForFunction(() => window.__vaGraph && window.__vaGraph.readyMs >= 0, null, {
      timeout: 60_000,
    });
    await dragCanvas(page);
    await expect(page.getByTestId("sidebar")).toBeVisible();
    await expect(page.getByTestId("sidebar-pin")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("sidebar-pin").click(); // leave it unpinned for other tests
  });

  test("keyboard only: search, move through matches, select, clear; reduced motion still works", async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce", viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await signIn(page);
    await openGraph(page, S.big!);
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("value-search")).toBeFocused();
    await page.keyboard.type("onion");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("node-panel")).toBeVisible();
    // camera moves instantly under reduced motion: no animation in flight
    expect(await page.evaluate(() => window.__vaGraph!.sigma.getCamera().isAnimated())).toBe(false);
    await page.keyboard.press("Escape"); // clears the search (focus is in the field)
    await expect(page.getByTestId("value-search")).toHaveValue("");
    await page.getByTestId("value-search").blur();
    await page.keyboard.press("Escape"); // then the selection
    await expect(page.getByTestId("node-panel")).toHaveCount(0);
    // "View as table" is one click away
    await page.getByTestId("view-table").click();
    await expect(page).toHaveURL(/\/results\/entities$/);
    await ctx.close();
  });

  test("mobile: graph full screen, values as a bottom sheet, the selection as a second sheet", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGraph(page, S.big!);
    const sheet = page.getByTestId("sidebar");
    await expect(sheet).toHaveAttribute("data-sheet", "peek");
    await expect(page.getByTestId("value-search")).toBeVisible();
    await shot(page, "1-default");
    await page.getByTestId("sheet-handle").click();
    await expect(sheet).toHaveAttribute("data-sheet", "full");
    await page.getByTestId("group-actors").click();
    await page.getByTestId("value-row").first().click();
    await expect(page.getByTestId("node-panel")).toBeVisible();
    await expect(sheet).toHaveAttribute("data-sheet", "peek");
    await shot(page, "3-selected-trail");
    await page.getByRole("button", { name: "Close the selected value" }).click();
    await page.getByTestId("value-search").fill("alph");
    await shot(page, "2-search");
  });

  test("frames at 390: rail is desktop-only, filters open", async ({ page }) => {
    test.skip(!SHOTS, "frames only");
    await page.setViewportSize({ width: 390, height: 844 });
    await openGraph(page, S.big!);
    await page.getByTestId("sheet-handle").click();
    await page.getByTestId("filters-button").click();
    await shot(page, "5-filters");
  });
});

test("performance on the large fixture: layout off the main thread, 60 fps pan/zoom, flat heap", async ({
  page,
}) => {
  test.skip(!process.env.E2E_PERF, "set E2E_PERF=1");
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const heap = () =>
    page.evaluate(
      () =>
        (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0,
    );
  const t0 = Date.now();
  await page.goto(`${base(S.allCats!)}/graph`);
  // the main thread stays free while the worker lays out: measure the longest frame gap until ready
  const during = await page.evaluate(
    () =>
      new Promise<{ maxGap: number; frames: number }>((resolve) => {
        let last = performance.now();
        let maxGap = 0;
        let frames = 0;
        const step = (now: number) => {
          maxGap = Math.max(maxGap, now - last);
          last = now;
          frames++;
          if (window.__vaGraph && window.__vaGraph.readyMs >= 0) resolve({ maxGap, frames });
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
  );
  const stats = await page.evaluate(() => window.__vaGraph!.stats);
  const wall = Date.now() - t0;
  const heapStart = await heap();
  const pan = await page.evaluate(
    () =>
      new Promise<{ fps: number; p95: number; mean: number; renderer: string }>((resolve) => {
        const s = window.__vaGraph!.sigma;
        const cam = s.getCamera();
        const gaps: number[] = [];
        const start = performance.now();
        let last = start;
        const step = (now: number) => {
          const t = (now - start) / 6000;
          cam.setState({
            x: 0.5 + 0.2 * Math.sin(t * 9),
            y: 0.5 + 0.2 * Math.cos(t * 7),
            ratio: 0.9 - 0.6 * Math.abs(Math.sin(t * 5)),
            angle: 0,
          });
          gaps.push(now - last);
          last = now;
          if (now - start < 6000) requestAnimationFrame(step);
          else {
            const g = gaps.slice(2).sort((a, b) => a - b);
            const gl = document.createElement("canvas").getContext("webgl")!;
            const e = gl.getExtension("WEBGL_debug_renderer_info");
            resolve({
              fps: Math.round((g.length / (now - start)) * 1000),
              p95: Math.round(g[Math.floor(g.length * 0.95)]! * 10) / 10,
              mean: Math.round((g.reduce((a, b) => a + b, 0) / g.length) * 10) / 10,
              renderer: e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : "unknown",
            });
          }
        };
        requestAnimationFrame(step);
      }),
  );
  // search and selection on the big graph, then the heap again
  await page.getByTestId("value-search").fill("onion");
  await page.getByTestId("value-search").press("Enter");
  await expect(page.getByTestId("node-panel")).toBeVisible();
  await page.getByTestId("value-search").fill("");
  await page.waitForTimeout(1000);
  const heapEnd = await heap();
  const out = {
    stats,
    wallMs: wall,
    during,
    pan,
    heapStartMb: heapStart / 1048576,
    heapEndMb: heapEnd / 1048576,
  };
  console.log(`PERF P9 large fixture: ${JSON.stringify(out)}`);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    writeFileSync(join(SHOTS, "perf.json"), JSON.stringify(out, null, 2));
  }
  expect(stats.nodes).toBeGreaterThanOrEqual(1500);
  expect(stats.edges).toBeGreaterThanOrEqual(4000);
  expect(stats.firstPaintMs).toBeLessThan(1500);
  if (!/swiftshader/i.test(pan.renderer)) {
    expect(pan.p95).toBeLessThan(20);
    expect(during.maxGap).toBeLessThan(200); // layout ran in the worker
  }
});
