/* global window, console */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
const S = JSON.parse(readFileSync("e2e/.state/state.json"));
const b = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
for (const [w, h] of [
  [1440, 900],
  [375, 812],
]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  await ctx.addCookies([{ name: "va_dev_user", value: S.pro, url: "http://localhost:3200" }]);
  const p = await ctx.newPage();
  for (const t of ["summary", "graph", "entities", "actors", "sources", "exports"]) {
    await p.goto(`http://localhost:3200/investigations/${S.big}/results/${t}`);
    if (t === "graph") {
      await p.waitForFunction(() => window.__vaGraph && window.__vaGraph.readyMs >= 0, null, {
        timeout: 30000,
      });
      const ms = await p.evaluate(() => window.__vaGraph.readyMs);
      await p.waitForTimeout(1500);
      console.log(`graph ${w}px readyMs(first, GPU)=${ms}`);
    } else await p.waitForTimeout(1200);
    await p.screenshot({
      path: `docs/screenshots/results/${t}-${w}.png`,
      fullPage: ["summary", "actors", "exports"].includes(t),
      timeout: 90000,
    });
  }
  // cached reopen timing on the real GPU
  if (w === 1440) {
    await p.goto(`http://localhost:3200/investigations/${S.big}/results/graph`);
    await p.waitForFunction(() => window.__vaGraph && window.__vaGraph.readyMs >= 0);
    console.log("graph cached reopen readyMs (GPU):", await p.evaluate(() => window.__vaGraph.readyMs));
  }
  await ctx.close();
}
await b.close();
