import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { classifyPath, hasSessionCookie, movedRedirect, signInRedirect } from "@/lib/guard";
import { proxy } from "@/proxy";

const APP = "http://localhost:3000"; // APP_URL in the test env
const SITE = "https://voidaccess.pro";

/** Every page and route handler under app/, as the URL it serves ([id] segments filled with a sample). */
function enumerateRoutes(): { kind: "page" | "route"; url: string }[] {
  const root = join(__dirname, "../app");
  const out: { kind: "page" | "route"; url: string }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/^(page|route)\.tsx?$/.test(name)) {
        const segs = relative(root, dir)
          .split(sep)
          .filter((s) => s && !/^\(.*\)$/.test(s))
          .map((s) => (s === "[...all]" ? "x" : s.replace(/\[(\w+)\]/g, "00000000-0000-0000-0000-000000000000")));
        out.push({ kind: name.startsWith("page") ? "page" : "route", url: "/" + segs.join("/") });
      }
    }
  };
  walk(root);
  return out;
}

const MACHINE = [
  /^\/api\/auth(\/|$)/,
  /^\/api\/engine\//,
  /^\/api\/cron\//,
  /^\/api\/webhooks\/dodo$/,
  /^\/api\/health$/,
  /^\/api\/founding\/seats$/,
];
const get = (path: string, cookie?: string) =>
  proxy(new NextRequest(`${APP}${path}`, { headers: cookie ? { cookie } : {} }));

describe("signed-out guard (guarantee 1)", () => {
  const routes = enumerateRoutes();

  it("finds the routes (sanity)", () => {
    expect(routes.length).toBeGreaterThan(30);
    expect(routes.some((r) => r.url === "/investigations/00000000-0000-0000-0000-000000000000/results/graph")).toBe(true);
  });

  it("every page redirects signed-out visitors to the site's sign-in with an app-origin next", () => {
    for (const r of routes.filter((x) => x.kind === "page")) {
      const res = get(r.url);
      expect(res.status, r.url).toBe(307);
      const loc = new URL(res.headers.get("location")!);
      expect(loc.origin, r.url).toBe(SITE);
      expect(loc.pathname, r.url).toBe(r.url === "/sign-in" ? "/sign-in" : "/sign-in");
      const next = loc.searchParams.get("next");
      if (next) expect(new URL(next).origin, r.url).toBe(APP);
    }
  });

  it("every non-machine API route answers 401 JSON signed out; machine endpoints pass through", async () => {
    for (const r of routes.filter((x) => x.kind === "route")) {
      const res = get(r.url);
      if (MACHINE.some((m) => m.test(r.url))) {
        expect(res.headers.get("x-middleware-next"), r.url).toBe("1");
      } else {
        expect(res.status, r.url).toBe(401);
        expect(await res.json(), r.url).toEqual({ error: "Sign in required" });
      }
    }
  });

  it("unknown paths, dev surfaces and static-looking paths are guarded too", () => {
    for (const p of ["/nope", "/dev/ui", "/dev/ui/", "/api/nope", "/.env", "/investigations//x"]) {
      const res = get(p);
      expect([307, 401], p).toContain(res.status);
    }
  });

  it("next carries the original URL, query included; the root and weird paths carry none", () => {
    const loc = new URL(get("/investigations/abc/results?tab=graph").headers.get("location")!);
    expect(loc.searchParams.get("next")).toBe(`${APP}/investigations/abc/results?tab=graph`);
    expect(new URL(get("/").headers.get("location")!).searchParams.has("next")).toBe(false);
    for (const bad of ["//evil.com/x", "https://evil.com", "javascript:alert(1)"]) {
      expect(signInRedirect(SITE, APP, bad)).toBe(`${SITE}/sign-in`);
    }
  });

  it("a session cookie lets pages through (the page validates it) and tags the request path", () => {
    const res = get("/billing?x=1", "better-auth.session_token=abc.def");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-request-x-va-path")).toBe("/billing?x=1");
    expect(hasSessionCookie("a=b; __Secure-better-auth.session_token=abc")).toBe(true);
    expect(hasSessionCookie("better-auth.session_token=")).toBe(false);
    expect(hasSessionCookie("xbetter-auth.session_token=abc")).toBe(false);
    expect(hasSessionCookie(null)).toBe(false);
  });

  it("the moved auth pages redirect to the site, keeping the query (reset tokens)", () => {
    for (const p of ["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/check-email"]) {
      const res = get(`${p}?token=t1&email=a%40b.c`);
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toBe(`${SITE}${p}?token=t1&email=a%40b.c`);
    }
    expect(movedRedirect(SITE + "/", "/sign-in/", "")).toBe(`${SITE}/sign-in`);
    expect(classifyPath("/accept-terms")).toBe("page"); // stays in the app, behind the guard
  });

  it("classifyPath does not let look-alike paths through", () => {
    for (const p of ["/api/authx", "/api/health/x", "/api/cronjobs", "/api/engine", "/api/webhooks/dodo/x", "/api/founding/seats/x"]) {
      expect(classifyPath(p), p).not.toBe("machine");
    }
    for (const p of ["/api/auth", "/api/auth/sign-in/email", "/api/health", "/api/cron/watchdog", "/api/engine/runs/x/spec"]) {
      expect(classifyPath(p), p).toBe("machine");
    }
  });
});
