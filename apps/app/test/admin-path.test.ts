import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { NOT_FOUND_REWRITE, proxy } from "@/proxy";
import { adminHref, adminSlug, isInternalAdminPath, toInternalAdminPath } from "@/lib/admin/path";
import { parseEnv } from "@/env";
import { makeOwner, TEST_ADMIN_PATH, TEST_BASE } from "./admin-owner";
import { makeAdmin } from "./admin-helpers";
import { asUser, makeUser } from "./helpers";

const APP = "http://localhost:3000";
const COOKIE = "better-auth.session_token=abc.def";
const req = (path: string, cookie?: string) =>
  new NextRequest(`${APP}${path}`, { headers: cookie ? { cookie } : {} });
/** Every path but the secret one is answered synchronously. */
const get = (path: string, cookie?: string) => {
  const r = proxy(req(path, cookie));
  if (r instanceof Promise) throw new Error(`${path} was answered asynchronously`);
  return r;
};
const getAsync = async (path: string, cookie?: string) => await proxy(req(path, cookie));
const rewriteOf = (res: Response) => {
  const r = res.headers.get("x-middleware-rewrite");
  return r ? new URL(r).pathname + new URL(r).search : null;
};

const saved = process.env.ADMIN_PATH;
afterEach(() => {
  if (saved === undefined) delete process.env.ADMIN_PATH;
  else process.env.ADMIN_PATH = saved;
});

describe("ADMIN_PATH", () => {
  it("is optional; when set it must be >= 24 characters of [a-z0-9-] (env schema and the runtime helper agree)", () => {
    expect(parseEnv({}).ADMIN_PATH).toBeUndefined();
    expect(parseEnv({}).ADMIN_EMAIL).toBe("katriel@voidaccess.pro");
    expect(parseEnv({ ADMIN_PATH: TEST_ADMIN_PATH }).ADMIN_PATH).toBe(TEST_ADMIN_PATH);
    for (const bad of [
      "short-slug",
      "UPPER-case-slug-that-is-long",
      "with_underscore_long_enough_x",
      "a/b-c-d-e-f-g-h-i-j-k-l-m",
    ]) {
      expect(() => parseEnv({ ADMIN_PATH: bad }), bad).toThrow(/ADMIN_PATH/);
      expect(adminSlug({ ADMIN_PATH: bad }), bad).toBeNull();
    }
    expect(adminSlug({})).toBeNull();
    expect(adminSlug({ ADMIN_PATH: TEST_ADMIN_PATH })).toBe(TEST_ADMIN_PATH);
  });

  it("adminHref builds every console URL from the public base", () => {
    process.env.ADMIN_PATH = TEST_ADMIN_PATH;
    expect(adminHref("/")).toBe(TEST_BASE);
    expect(adminHref("")).toBe(TEST_BASE);
    expect(adminHref("/users/1")).toBe(`${TEST_BASE}/users/1`);
    expect(adminHref("?x=1")).toBe(`${TEST_BASE}?x=1`);
    delete process.env.ADMIN_PATH;
    expect(() => adminHref("/")).toThrow(/ADMIN_PATH/);
  });

  it("maps only the secret base to the internal path, and recognises /admin in any spelling", () => {
    expect(toInternalAdminPath(TEST_BASE, TEST_ADMIN_PATH)).toBe("/admin");
    expect(toInternalAdminPath(`${TEST_BASE}/`, TEST_ADMIN_PATH)).toBe("/admin");
    expect(toInternalAdminPath(`${TEST_BASE}/users/1`, TEST_ADMIN_PATH)).toBe("/admin/users/1");
    expect(toInternalAdminPath(`${TEST_BASE}x`, TEST_ADMIN_PATH)).toBeNull();
    expect(toInternalAdminPath("/admin", TEST_ADMIN_PATH)).toBeNull();
    expect(toInternalAdminPath(TEST_BASE, null)).toBeNull();
    for (const p of [
      "/admin",
      "/admin/",
      "/admin/users",
      "/ADMIN",
      "/Admin/x",
      "/%61dmin",
      "/%61dmin/users",
      "//admin",
    ])
      expect(isInternalAdminPath(p), p).toBe(true);
    for (const p of ["/administrator", "/admins", "/api/admin/x", "/x/admin", TEST_BASE])
      expect(isInternalAdminPath(p), p).toBe(false);
  });
});

describe("proxy: the console is only at the secret path", () => {
  it("signed in as the owner, the secret path is rewritten to the internal /admin path, query kept, public path tagged", async () => {
    process.env.ADMIN_PATH = TEST_ADMIN_PATH;
    asUser(await makeOwner());
    for (const [pub, internal] of [
      [TEST_BASE, "/admin"],
      [`${TEST_BASE}/users?q=a`, "/admin/users?q=a"],
      [`${TEST_BASE}/review/abc`, "/admin/review/abc"],
    ]) {
      const res = await getAsync(pub!, COOKIE);
      expect(rewriteOf(res), pub).toBe(internal);
      expect(res.headers.get("x-middleware-request-x-va-path"), pub).toBe(pub);
    }
    asUser(null);
  });

  it("signed in as anyone else (an admin with another email, a suspended owner, an invalid session), the secret path is the ordinary 404", async () => {
    process.env.ADMIN_PATH = TEST_ADMIN_PATH;
    const owner = await makeOwner();
    const others = [
      await makeUser({ credits: 0 }),
      await makeAdmin(),
      { ...owner, status: "suspended" as const },
      null,
    ];
    for (const who of others) {
      asUser(who);
      for (const p of [TEST_BASE, `${TEST_BASE}/users?q=a`]) {
        const res = await getAsync(p, COOKIE);
        expect(rewriteOf(res)?.split("?")[0], p).toBe(NOT_FOUND_REWRITE);
        expect(res.headers.get("location")).toBeNull();
      }
    }
    asUser(null);
  });

  it("signed in, /admin and /admin/... get the ordinary 404 (rewritten to a path nothing serves), never a redirect", () => {
    for (const set of [TEST_ADMIN_PATH, undefined]) {
      if (set) process.env.ADMIN_PATH = set;
      else delete process.env.ADMIN_PATH;
      for (const p of [
        "/admin",
        "/admin/",
        "/admin/users",
        "/admin/users/x?y=1",
        "/ADMIN",
        "/%61dmin/costs",
      ]) {
        const res = get(p, COOKIE);
        expect(res.status, p).toBe(200); // the 404 status comes from rendering the rewritten path
        expect(res.headers.get("location"), p).toBeNull();
        expect(rewriteOf(res)?.split("?")[0], p).toBe(NOT_FOUND_REWRITE);
      }
    }
  });

  it("with ADMIN_PATH unset the secret path is just an unknown URL", () => {
    delete process.env.ADMIN_PATH;
    const res = get(TEST_BASE, COOKIE);
    expect(rewriteOf(res)).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("signed out, /admin, /admin/x and the secret path are handled exactly like an unknown URL", () => {
    process.env.ADMIN_PATH = TEST_ADMIN_PATH;
    const shape = (p: string) => {
      const res = get(p);
      const loc = new URL(res.headers.get("location")!);
      return {
        status: res.status,
        origin: loc.origin,
        path: loc.pathname,
        next: loc.searchParams.get("next"),
      };
    };
    for (const p of ["/admin", "/admin/users", TEST_BASE, `${TEST_BASE}/users`]) {
      const unknown = shape("/no-such-page");
      const s = shape(p);
      expect({ ...s, next: null }, p).toEqual({ ...unknown, next: null });
      expect(s.next, p).toBe(`${APP}${p}`);
    }
    // APIs: the same 401 as any unknown API without a cookie
    expect(get("/api/admin/costs/export").status).toBe(401);
    expect(get("/api/no-such-route").status).toBe(401);
  });

  it("the NOT_FOUND_REWRITE path is served by no route", () => {
    const appDir = join(__dirname, "../app");
    expect(readdirSync(appDir)).not.toContain(NOT_FOUND_REWRITE.slice(1));
  });
});

// The repo is public: no real slug may ever be committed, and no in-console link may hardcode the internal path.
describe("no secret slug and no hardcoded /admin links in the source", () => {
  const ROOT = join(__dirname, "../../..");
  const SKIP = new Set([
    "node_modules",
    ".git",
    ".turbo",
    "test-results",
    "playwright-report",
    "screenshots",
  ]);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      if (SKIP.has(n) || n.startsWith(".next")) continue;
      const f = join(dir, n);
      const st = statSync(f);
      if (st.isDirectory()) walk(f);
      else if (
        /\.(ts|tsx|js|mjs|cjs|md|json|tf|tfvars|sh|yaml|yml|env|example|txt)$/.test(n) &&
        st.size < 2_000_000
      )
        files.push(f);
    }
  };
  walk(ROOT);

  it("finds the source (sanity)", () => {
    expect(files.some((f) => f.endsWith("apps/app/proxy.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("infra/terraform/modules/app/main.tf"))).toBe(true);
  });

  it("no file contains an admin-<hex> slug or assigns ADMIN_PATH a value other than the test slugs", () => {
    const hexSlug = new RegExp("admin-" + "[0-9a-f]{16,}", "i");
    const assign = new RegExp("ADMIN_PATH" + "\\s*[:=]\\s*[\"'`]([^\"'`$]+)[\"'`]", "g");
    const allowed = new Set([
      TEST_ADMIN_PATH,
      "ops-e2e-console-path-not-a-secret",
      "e2e-console-path-not-a-secret",
      "admin-path", // the Secret Manager secret NAME in terraform (too short to be a slug)
    ]);
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(hexSlug.test(src), relative(ROOT, f)).toBe(false);
      for (const m of src.matchAll(assign))
        expect(allowed.has(m[1]!), `${relative(ROOT, f)}: ${m[0]}`).toBe(true);
    }
  });

  it("no link or redirect in the app hardcodes /admin (they use adminHref or the base prop)", () => {
    const app = files.filter((f) => /apps\/app\/(app|components|lib)\//.test(f) && /\.(ts|tsx)$/.test(f));
    expect(app.length).toBeGreaterThan(50);
    const hard = new RegExp(
      "(href|redirect|push|replace|assign|location)\\s*(=|:|\\()\\s*\\{?\\s*[\"'`]/" + "admin(?![-\\w])",
    );
    for (const f of app) expect(hard.test(readFileSync(f, "utf8")), relative(ROOT, f)).toBe(false);
  });
});
