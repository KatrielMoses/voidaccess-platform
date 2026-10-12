import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AUTH_PATHS, LEGAL_PATHS, isAllowedPath, minimalGuard, normalizePath, wwwRedirect } from "@/lib/site-mode";

const MARKETING = [
  "/features",
  "/pricing",
  "/trust",
  "/open-source",
  "/waitlist",
  "/waitlist/check-email",
  "/waitlist/confirmed",
  "/llms.txt",
  "/llms-full.txt",
  "/og",
  "/sitemap.xml",
  "/api/waitlist",
  "/api/waitlist/confirm",
  "/api/founding/seats",
  "/pl/event",
  "/pl/script.js",
  "/api/anything-else",
  "/.env",
  "/sign-in/extra",
  "/sign-in.json",
];

describe("minimal-mode allowlist", () => {
  it("serves auth, legal, home and robots", () => {
    for (const p of ["/", "/robots.txt", ...AUTH_PATHS, ...LEGAL_PATHS]) expect(isAllowedPath(p, "minimal"), p).toBe(true);
  });

  it("tolerates a trailing slash", () => {
    expect(isAllowedPath("/sign-in/", "minimal")).toBe(true);
    expect(normalizePath("/terms//")).toBe("/terms");
    expect(normalizePath("/")).toBe("/");
  });

  it("404s every marketing and API route", () => {
    for (const p of MARKETING) expect(isAllowedPath(p, "minimal"), p).toBe(false);
  });

  it("keeps Next internals and logo assets reachable", () => {
    expect(isAllowedPath("/_next/static/chunks/a.js", "minimal")).toBe(true);
    expect(isAllowedPath("/logo-96.png", "minimal")).toBe(true);
    expect(isAllowedPath("/_nextevil", "minimal")).toBe(false);
  });

  it("allows everything in full mode", () => {
    for (const p of [...MARKETING, "/", "/sign-in"]) expect(isAllowedPath(p, "full"), p).toBe(true);
  });

  it("guards route handlers only in minimal mode", async () => {
    expect(minimalGuard("full")).toBeNull();
    expect(minimalGuard("minimal")?.status).toBe(404);
  });

  it("every page and route in src/app is either allowlisted or blocked on purpose", () => {
    // Guards against a new top-level route silently becoming public in minimal mode.
    const app = path.join(import.meta.dirname, "../src/app");
    const served = new Set<string>();
    const walk = (dir: string, url: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full, name.startsWith("(") ? url : `${url}/${name}`);
        } else if (/^(page|route)\.tsx?$/.test(name)) served.add(url || "/");
      }
    };
    walk(app, "");
    const allowed = [...served].filter((p) => isAllowedPath(p, "minimal")).sort();
    expect(allowed).toEqual(["/", ...AUTH_PATHS, ...LEGAL_PATHS].sort());
  });
});

describe("wwwRedirect", () => {
  it("redirects www to the bare host, keeping path and query", () => {
    expect(wwwRedirect("www.voidaccess.pro", "/sign-in", "?next=x")).toBe("https://voidaccess.pro/sign-in?next=x");
    expect(wwwRedirect("WWW.voidaccess.pro:443", "/", "")).toBe("https://voidaccess.pro:443/");
    expect(wwwRedirect("www.va.localhost:3700", "/", "")).toBe("http://va.localhost:3700/");
  });
  it("ignores other hosts", () => {
    expect(wwwRedirect("voidaccess.pro", "/", "")).toBeNull();
    expect(wwwRedirect("wwwx.voidaccess.pro", "/", "")).toBeNull();
    expect(wwwRedirect("localhost:3700", "/", "")).toBeNull();
    expect(wwwRedirect(null, "/", "")).toBeNull();
  });
});
