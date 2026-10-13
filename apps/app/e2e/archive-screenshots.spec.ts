// Screenshots of the archive UI at 1440 px and 375 px -> docs/screenshots/archive/<name>-<width>.png
// The viewer runs the mock engine; the archive is seeded (fictional names) from other "runs", one of whose sources has gone offline.
import { expect, test, type Page } from "@playwright/test";
import { createLocalDatabase } from "@voidaccess/db/local";
import { archiveRun, LocalFsObjectStore } from "@voidaccess/archive";
import { makeBundle, memoryDeps, onion } from "@voidaccess/archive/test-support";
import { ARCHIVE_STORE } from "../playwright.archive.config";
import { appUrl } from "./archive-global-setup";
import { signUpAndVerify, uniqueEmail } from "./archive-helpers";

const OUT = "docs/screenshots/archive/";
const SIZES = [
  { w: 1440, h: 900 },
  { w: 375, h: 812 },
];

async function runToCompletion(page: Page) {
  await page.goto("/investigations/new");
  await page.getByLabel("What do you want to investigate?").fill("LockBit ransomware group");
  await page.getByRole("radio", { name: /Quick/ }).check();
  await page.getByRole("button", { name: "Start investigation" }).click();
  await expect(page).toHaveURL(/\/investigations\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("run-completed")).toBeVisible({ timeout: 120_000 });
  return /investigations\/([0-9a-f-]{36})/.exec(page.url())![1]!;
}

test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to regenerate the archive screenshots");

test("archive screenshots: panel, graph toggle, a source that is no longer online", async ({ page }) => {
  await signUpAndVerify(page, uniqueEmail("arc-shot"), "Archive Shots");
  const inv = await runToCompletion(page);

  // entities of the viewer's run that the seeded archive will also know
  const res = await page.request.get(`/api/investigations/${inv}/entities?limit=40`);
  const rows = (
    (await res.json()) as { rows: { type: string; displayValue: string; sensitive: boolean }[] }
  ).rows
    .filter((r) => !r.sensitive && r.type !== "DATE")
    .slice(0, 6);
  expect(rows.length).toBeGreaterThanOrEqual(3);

  const database = createLocalDatabase(appUrl(), { max: 2 });
  const store = new LocalFsObjectStore(ARCHIVE_STORE);
  const leak = onion("northwind", "/posts/fictional-1");
  const ents = rows.map((r, i) => ({
    id: `e${i}`,
    type: r.type as never,
    value: r.displayValue,
    sources: ["a1", "a2"],
  }));
  const rel = (a: number, b: number) => ({ a: `e${a}`, b: `e${b}`, evidence: ["a1", "a2"] });

  // March: an onion leak-site page (fetched alive, snapshot kept) and a news article about the same names
  const march = makeBundle({
    runId: "00000000-0000-4000-8000-0000000000a1",
    query: "seed run one",
    sources: [
      {
        id: "a1",
        url: leak,
        fetchedAt: "2026-03-02T09:00:00Z",
        name: "Leak-site post",
        excerpt: "Fictional post naming Northwind Traders and Fabrikam Logistics.",
      },
      {
        id: "a2",
        url: "https://www.example-news.test/march-report",
        fetchedAt: "2026-03-03T09:00:00Z",
        kind: "feed",
        name: "News report",
      },
    ],
    entities: [
      ...ents,
      { id: "nb", type: "ORGANIZATION_NAME", value: "Fabrikam Logistics", sources: ["a1", "a2"] },
    ],
    relationships: [rel(0, 1), rel(1, 2), { a: "e0", b: "nb", evidence: ["a1", "a2"] }],
  });
  await archiveRun(
    "00000000-0000-4000-8000-0000000000a1",
    memoryDeps(
      march,
      [
        {
          url: leak,
          fetched_at: "2026-03-02T09:00:00Z",
          text:
            "Fictional post naming Northwind Traders and Fabrikam Logistics. " +
            rows.map((r) => r.displayValue).join(" "),
        },
      ],
      store,
    ),
    { database, fingerprintKey: "e2e-fp" },
  );

  // May: the leak URL is only mentioned (the fetch failed), so it reads as no longer online
  const may = makeBundle({
    runId: "00000000-0000-4000-8000-0000000000a2",
    query: "seed run two",
    sources: [
      {
        id: "b1",
        url: "https://www.contoso-research.test/may-notes",
        fetchedAt: "2026-05-20T00:00:00Z",
        kind: "feed",
        name: "Research notes",
      },
    ],
    entities: [
      { id: "u", type: "ONION_URL", value: leak, sources: ["b1"] },
      ...ents.slice(0, 3).map((e) => ({ ...e, sources: ["b1"] })),
    ],
  });
  await archiveRun("00000000-0000-4000-8000-0000000000a2", memoryDeps(may, null, store), {
    database,
    fingerprintKey: "e2e-fp",
  });
  await database.pool.end();

  const summary = `/investigations/${inv}/results/summary`;
  for (const s of SIZES) {
    await page.setViewportSize({ width: s.w, height: s.h });
    await page.goto(summary);
    const panel = page.getByTestId("archive-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByTestId("archive-neighbour").first()).toBeVisible();
    await expect(page.getByTestId("archive-offline-item").first()).toBeVisible();
    await page.screenshot({ path: `${OUT}panel-${s.w}.png`, fullPage: true });
    await page.getByTestId("archive-offline").scrollIntoViewIfNeeded();
    await page.getByTestId("archive-offline").screenshot({ path: `${OUT}offline-source-${s.w}.png` });

    await page.goto(`/investigations/${inv}/results/graph`);
    await page.waitForFunction(() => window.__vaGraph && window.__vaGraph.readyMs >= 0, null, {
      timeout: 60_000,
    });
    await page.getByTestId("archive-toggle").click();
    await expect(page.getByTestId("archive-status")).toContainText(/Archive context.*: \d+/);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}graph-toggle-${s.w}.png`, fullPage: true });
  }
});
