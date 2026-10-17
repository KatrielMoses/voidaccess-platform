import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEPTHS, PLANS } from "@voidaccess/config";
import { fill, staticTokens, statsTokens } from "@/home/render";
import {
  DOWNLOADS_URL,
  STARS_URL,
  STATS_FALLBACK,
  STATS_TIMEOUT_MS,
  STATS_TTL_MS,
  formatCount,
  getStats,
  normaliseCount,
  resetStatsCache,
  shieldsValue,
} from "@/lib/stats";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fetcher answering each shields URL with the given badge value (or a Response / an error). */
function fetcher(answers: Record<string, string | Response | Error>) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const a = answers[url];
    if (a instanceof Error) throw a;
    if (a instanceof Response) return a;
    if (a === undefined) throw new Error(`unexpected ${url}`);
    return json({ label: "x", message: a, value: a });
  });
}

describe("parsing", () => {
  it("reads the value of a shields badge JSON", () => {
    expect(shieldsValue({ label: "stars", message: "801", value: "801" })).toBe("801");
    expect(shieldsValue({ value: " 18k " })).toBe("18k");
    for (const bad of [null, "801", 801, {}, { value: 801 }, { value: "" }, { message: "801" }]) expect(shieldsValue(bad)).toBeNull();
  });

  it("formats counts like the site shows them", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(801)).toBe("801");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1000)).toBe("1k");
    expect(formatCount(1234)).toBe("1.2k");
    expect(formatCount(1299)).toBe("1.2k"); // rounded down, so "+" stays true
    expect(formatCount(18_400)).toBe("18k");
    expect(formatCount(1_250_000)).toBe("1.2M");
  });

  it("normalises shields counts and rejects anything else", () => {
    expect(normaliseCount("801")).toBe("801");
    expect(normaliseCount("1204")).toBe("1.2k");
    expect(normaliseCount("1,204")).toBe("1.2k");
    expect(normaliseCount("1.2k")).toBe("1.2k");
    expect(normaliseCount("18k")).toBe("18k");
    expect(normaliseCount("18K")).toBe("18k");
    expect(normaliseCount("2.5M")).toBe("2.5M");
    for (const bad of [null, "", "invalid", "repo not found", "n/a", "-1", "1.2.3k", "<script>"]) expect(normaliseCount(bad)).toBeNull();
  });
});

describe("getStats", () => {
  beforeEach(() => resetStatsCache());

  it("returns the live values, fetched in parallel with a timeout and an hour of caching", async () => {
    const f = fetcher({ [STARS_URL]: "1204", [DOWNLOADS_URL]: "21k" });
    expect(await getStats({ fetcher: f, now: 0 })).toEqual({ stars: "1.2k", downloads: "21k" });
    expect(f).toHaveBeenCalledTimes(2);
    const init = f.mock.calls[0]![1] as RequestInit & { next?: { revalidate: number }; cf?: { cacheTtl: number } };
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.next?.revalidate).toBe(3600);
    expect(init.cf?.cacheTtl).toBe(3600);
    expect(STATS_TIMEOUT_MS).toBeLessThanOrEqual(1500);
  });

  it("serves the in-memory copy for an hour, then fetches again", async () => {
    const f = fetcher({ [STARS_URL]: "801", [DOWNLOADS_URL]: "18k" });
    await getStats({ fetcher: f, now: 0 });
    await getStats({ fetcher: f, now: STATS_TTL_MS - 1 });
    expect(f).toHaveBeenCalledTimes(2);
    await getStats({ fetcher: f, now: STATS_TTL_MS + 1 });
    expect(f).toHaveBeenCalledTimes(4);
  });

  it("shares one fetch between concurrent callers", async () => {
    const f = fetcher({ [STARS_URL]: "801", [DOWNLOADS_URL]: "18k" });
    await Promise.all([getStats({ fetcher: f, now: 0 }), getStats({ fetcher: f, now: 0 }), getStats({ fetcher: f, now: 0 })]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("falls back to the last-known values on network errors, timeouts, bad status and bad JSON", async () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    for (const [stars, downloads] of [
      [new Error("getaddrinfo ENOTFOUND"), timeout],
      [json({ message: "rate limited" }, 503), json({}, 404)],
      [new Response("<html>not json</html>", { status: 200 }), json({ value: "invalid" })],
    ] as const) {
      resetStatsCache();
      expect(await getStats({ fetcher: fetcher({ [STARS_URL]: stars, [DOWNLOADS_URL]: downloads }), now: 0 })).toEqual(STATS_FALLBACK);
    }
  });

  it("falls back per number, and retries a failure after a few minutes rather than an hour", async () => {
    const bad = fetcher({ [STARS_URL]: "905", [DOWNLOADS_URL]: new Error("down") });
    expect(await getStats({ fetcher: bad, now: 0 })).toEqual({ stars: "905", downloads: STATS_FALLBACK.downloads });
    const good = fetcher({ [STARS_URL]: "906", [DOWNLOADS_URL]: "19k" });
    expect(await getStats({ fetcher: good, now: 60_000 })).toEqual({ stars: "905", downloads: STATS_FALLBACK.downloads });
    expect(await getStats({ fetcher: good, now: 6 * 60_000 })).toEqual({ stars: "906", downloads: "19k" });
  });

  it("has sensible committed fallbacks", () => {
    expect(normaliseCount(STATS_FALLBACK.stars)).toBe(STATS_FALLBACK.stars);
    expect(normaliseCount(STATS_FALLBACK.downloads)).toBe(STATS_FALLBACK.downloads);
  });
});

describe("home page tokens", () => {
  const html = readFileSync(path.join(import.meta.dirname, "../src/home/index.html"), "utf8");

  it("fills every token in the home page, from config and the stats", () => {
    const out = fill(fill(html, staticTokens("https://app.example"), { strict: false }), statsTokens({ stars: "801", downloads: "18k" }));
    expect(out).not.toMatch(/__VA_/);
    expect(out).toContain(`${PLANS.free.monthlyCredits} free credits a month · no card · from $${PLANS.pro.monthlyUsd}/mo after that`);
    expect(out).toContain("801★ on GitHub");
    expect(out).toContain("18k+ downloads");
    expect(out).toContain(
      `about ${Math.floor(PLANS.free.monthlyCredits / DEPTHS.quick.credits)} Quick or ${Math.floor(PLANS.free.monthlyCredits / DEPTHS.standard.credits)} Standard investigations`,
    );
    expect(out).toContain('<meta name="va-app" content="https://app.example">');
  });

  it("throws on an unknown token instead of shipping it as text", () => {
    expect(() => fill("a __VA_NOPE__ b", {})).toThrow(/__VA_NOPE__/);
    expect(fill("a __VA_NOPE__ b", {}, { strict: false })).toBe("a __VA_NOPE__ b");
  });
});
