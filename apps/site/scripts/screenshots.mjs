// Usage: node scripts/screenshots.mjs [baseUrl]   (server must be running)
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3100";
const pages = { home: "/", pricing: "/pricing", trust: "/trust", features: "/features", waitlist: "/waitlist" };
const sizes = { "375": { width: 375, height: 812 }, "1440": { width: 1440, height: 900 } };
const browser = await chromium.launch();
for (const [w, viewport] of Object.entries(sizes)) {
  const ctx = await browser.newContext({ viewport, reducedMotion: "reduce", deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const [name, path] of Object.entries(pages)) {
    await page.goto(base + path, { waitUntil: "load" });
    await page.waitForTimeout(600);
    await page.addStyleTag({ content: "[aria-label='Privacy choice']{display:none!important}" });
    await page.screenshot({ path: new URL(`../docs/screenshots/${name}-${w}.png`, import.meta.url).pathname, fullPage: true });
  }
  await ctx.close();
}
await browser.close();
