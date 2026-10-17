import { expect, test, type Page } from "@playwright/test";
import { ARCHIVE_EMAIL_LOG, CRON_SECRET } from "../playwright.archive.config";
import { signUpAndVerify, uniqueEmail } from "./archive-helpers";

void ARCHIVE_EMAIL_LOG;

async function runToCompletion(page: Page, query: string, depth: "Quick" | "Standard") {
  await page.goto("/investigations/new");
  await page.getByLabel("What do you want to investigate?").fill(query);
  await page.getByRole("radio", { name: new RegExp(depth) }).check();
  await page.getByRole("button", { name: "Start investigation" }).click();
  await expect(page).toHaveURL(/\/investigations\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("run-completed")).toBeVisible({ timeout: 120_000 });
  return /investigations\/([0-9a-f-]{36})/.exec(page.url())![1]!;
}

test("two users: run 1 is archived anonymously; run 2's results show it as archive context, in the panel, the graph and the table", async ({
  browser,
  request,
}) => {
  // ---- user A, run 1 ----
  const a = await browser.newContext();
  const pa = await a.newPage();
  await signUpAndVerify(pa, uniqueEmail("arc-a"), "Archive A");
  // the mock engine returns a fixed public fixture per depth: Standard is the BlackCat run (with relationships)
  const invA = await runToCompletion(pa, "BlackCat ALPHV ransomware group", "Standard");

  // the archive worker (cron) files run 1's findings
  const cron = await request.post("/api/cron/archive", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  expect(cron.status()).toBe(200);
  expect((await cron.json()).processed).toBeGreaterThanOrEqual(1);

  // ---- user B, run 2 (a different run, a different user) ----
  const b = await browser.newContext();
  const pb = await b.newPage();
  await signUpAndVerify(pb, uniqueEmail("arc-b"), "Archive B");
  const invB = await runToCompletion(pb, "LockBit ransomware group", "Quick");

  // B opens results: the archive panel on the Summary tab
  await pb.goto(`/investigations/${invB}/results/summary`);
  const panel = pb.getByTestId("archive-panel");
  await expect(panel).toBeVisible();
  await expect(pb.getByTestId("archive-summary")).toContainText(
    /seen before in the archive from other sources/,
  );
  await expect(pb.getByTestId("archive-seen").locator("li").first()).toBeVisible();
  await expect(pb.getByTestId("archive-neighbour").first()).toBeVisible();
  await expect(panel).toContainText("Leads, not facts");
  const text = await panel.innerText();
  expect(text).not.toMatch(/victim of|attributed to/i);
  expect(text).not.toContain("BlackCat ALPHV ransomware group"); // A's search text never reaches B
  expect(text).not.toContain(invA);

  // graph: archive context is off until toggled; then archive nodes appear and an edge tooltip shows a lead with its evidence
  await pb.getByRole("link", { name: /^Graph/ }).click();
  await pb.waitForFunction(() => window.__vaGraph && window.__vaGraph.readyMs >= 0, null, {
    timeout: 60_000,
  });
  // archive context is one of the Filters (P9-6)
  await pb.getByTestId("filters-button").click();
  await expect(pb.getByTestId("archive-status")).toHaveCount(0);
  await pb.getByTestId("archive-toggle").click();
  await expect(pb.getByTestId("archive-status")).toContainText(/Archive context.*: \d+/);
  await pb.keyboard.press("Escape");
  // hover only points where sigma's own hit test finds an archive edge (1px lines are otherwise flaky to hit)
  const pts = await pb.evaluate(() => {
    const sg = window.__vaGraph!.sigma;
    const g = sg.getGraph();
    const hit = sg as unknown as { getEdgeAtPoint?: (x: number, y: number) => string | null };
    const out: { x: number; y: number }[] = [];
    g.forEachEdge((e, a, s, t) => {
      if (!a.archiveEdge) return;
      const p1 = sg.graphToViewport({ x: g.getNodeAttribute(s, "x"), y: g.getNodeAttribute(s, "y") });
      const p2 = sg.graphToViewport({ x: g.getNodeAttribute(t, "x"), y: g.getNodeAttribute(t, "y") });
      const x = (p1.x + p2.x) / 2;
      const y = (p1.y + p2.y) / 2;
      if (hit.getEdgeAtPoint?.(x, y) === e) out.push({ x, y });
    });
    return out;
  });
  expect(pts.length, "archive edges are hoverable").toBeGreaterThan(0);
  let tip = "";
  for (const pt of pts.slice(0, 15)) {
    if (tip) break;
    const box = (await pb.getByTestId("graph-canvas").boundingBox())!;
    await pb.mouse.move(box.x + pt.x - 5, box.y + pt.y - 5);
    await pb.mouse.move(box.x + pt.x, box.y + pt.y, { steps: 3 });
    await pb.waitForTimeout(250);
    const t = pb.getByTestId("edge-tip");
    if (await t.count()) tip = await t.first().innerText();
  }
  expect(tip, "an archive edge tooltip appeared").toMatch(/a lead.*page.*independent.*site/);
  await pb.getByTestId("filters-button").click();
  await pb.getByTestId("archive-toggle").click(); // off again removes the overlay
  await expect(pb.getByTestId("archive-status")).toHaveCount(0);

  // entities: a "Seen before" column and an "only new to the archive" filter
  await pb.getByRole("link", { name: /^Entities/ }).click();
  await expect(pb.getByTestId("entity-row").first()).toBeVisible();
  await expect(
    pb
      .getByTestId("seen-before-cell")
      .filter({ hasText: /corroborated|unconfirmed|feed validated/ })
      .first(),
  ).toBeVisible({ timeout: 30_000 });
  await pb.getByTestId("archive-filter").selectOption("new");
  await expect(pb).toHaveURL(/archive=new/);
  await expect(pb.getByTestId("seen-before-cell").first()).toContainText("new");
  const newCount = Number(
    (await pb.getByTestId("entity-count").innerText()).match(/of ([\d,]+)/)![1]!.replace(/,/g, ""),
  );
  await pb.getByTestId("archive-filter").selectOption("seen");
  await expect
    .poll(async () =>
      Number(
        (await pb.getByTestId("entity-count").innerText()).match(/of ([\d,]+)/)?.[1]?.replace(/,/g, "") ??
          NaN,
      ),
    )
    .not.toBe(newCount);

  // isolation: B cannot read A's results or archive context
  for (const path of [
    `/api/investigations/${invA}/archive`,
    `/api/investigations/${invA}/archive/graph`,
    `/api/investigations/${invA}/entities`,
  ]) {
    expect((await pb.request.get(path)).status(), path).toBe(404);
  }
  await a.close();
  await b.close();
});
