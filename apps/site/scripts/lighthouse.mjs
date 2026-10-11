// Lighthouse (mobile, simulated 4G) on Home and Pricing against a running production server.
// Usage: node scripts/lighthouse.mjs [baseUrl]   — exits non-zero if any guarantee-4 threshold is missed.
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3100";
const pages = ["/", "/pricing"];
const MIN = { performance: 0.9, accessibility: 0.9, "best-practices": 0.9, seo: 0.9 };
const LCP_MAX_MS = 2000;
// LH_PROFILE=slow4g uses Lighthouse's default mobile profile (1.6 Mbps / 150 ms RTT); default is a typical 4G link.
const THROTTLING = process.env.LH_PROFILE === "slow4g"
  ? { rttMs: 150, throughputKbps: 1638.4, cpuSlowdownMultiplier: 4 }
  : { rttMs: 70, throughputKbps: 9000, cpuSlowdownMultiplier: 4 };

const chrome = await launch({ chromePath: chromium.executablePath(), chromeFlags: ["--headless=new", "--no-sandbox"] });
let failed = false;
for (const path of pages) {
  const { lhr } = await lighthouse(base + path, { port: chrome.port, output: "json", logLevel: "error", formFactor: "mobile", screenEmulation: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false }, throttlingMethod: "simulate", throttling: THROTTLING });
  const scores = Object.fromEntries(Object.entries(MIN).map(([k]) => [k, lhr.categories[k].score]));
  const lcp = lhr.audits["largest-contentful-paint"].numericValue;
  const cls = lhr.audits["cumulative-layout-shift"].numericValue;
  const ok = Object.entries(MIN).every(([k, min]) => scores[k] >= min) && lcp < LCP_MAX_MS;
  failed ||= !ok;
  if (process.env.LH_DEBUG) {
    for (const a of Object.values(lhr.audits)) if (a.score !== null && a.score < 1 && a.scoreDisplayMode === "binary") console.log("  failing:", a.id, JSON.stringify(a.details?.items?.slice(0, 2)).slice(0, 300));
    console.log("LCP element:", JSON.stringify(Object.keys(lhr.audits).filter((k) => k.includes("lcp"))), lhr.audits["lcp-breakdown-insight"]?.details?.items?.[0]?.items?.map((i) => i.label + "=" + Math.round(i.duration ?? 0)).join(" "));
    console.log(JSON.stringify(lhr.audits["lcp-breakdown-insight"].details).slice(0, 900)); const m = lhr.audits.metrics.details.items[0]; console.log("observed FCP/LCP", m.observedFirstContentfulPaint, m.observedLargestContentfulPaint, "simulated", m.firstContentfulPaint, m.largestContentfulPaint);
    for (const r of lhr.audits["network-requests"].details.items.slice(0, 14)) console.log(" ", r.url.slice(-60), r.transferSize, Math.round(r.networkEndTime));
  }
  console.log(`${ok ? "PASS" : "FAIL"} ${path}`, JSON.stringify(scores), `LCP=${Math.round(lcp)}ms CLS=${cls.toFixed(3)} TBT=${Math.round(lhr.audits["total-blocking-time"].numericValue)}ms`);
}
await chrome.kill();
process.exit(failed ? 1 : 0);
