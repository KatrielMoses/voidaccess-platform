import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ADMIN_ALLOW_LOCKED, ADMIN_API, ADMIN_PAGES } from "@/lib/admin/routes";
import { asUser, makeUser } from "./helpers";
import { makeAdmin, SAME_ORIGIN } from "./admin-helpers";
import { clearCookies, makeOwner, setRequestPath, stepUp, TEST_BASE } from "./admin-owner";
import type { TestSessionUser } from "./session-state";

vi.mock("next/headers", async () => (await import("./admin-owner")).nextHeadersMock);

const APP = join(__dirname, "../app");
const ID = "00000000-0000-4000-8000-000000000000";

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const f = join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else out.push(f);
  }
  return out;
}
/** `app/(admin)/admin/users/[id]/page.tsx` -> `/admin/users/[id]` */
const urlOf = (file: string) =>
  "/" +
  relative(APP, file)
    .split(sep)
    .slice(0, -1)
    .filter((s) => !/^\(.*\)$/.test(s))
    .join("/");

const pageFiles = walk(join(APP, "(admin)")).filter((f) => /\/page\.tsx$/.test(f));
const layoutFiles = walk(join(APP, "(admin)")).filter((f) => /\/layout\.tsx$/.test(f));
const apiFiles = walk(join(APP, "api/admin")).filter((f) => /\/route\.ts$/.test(f));
const allowLocked = new Set<string>(ADMIN_ALLOW_LOCKED);

const digest = (e: unknown) => String((e as { digest?: string })?.digest ?? "");
const isNotFound = (e: unknown) => digest(e) === "NEXT_HTTP_ERROR_FALLBACK;404";
const isRedirect = (e: unknown) => digest(e).startsWith("NEXT_REDIRECT");
/** NEXT_REDIRECT;<type>;<url>;<status>; */
const redirectUrl = (e: unknown) => digest(e).split(";")[2] ?? "";

describe("admin routes: registry matches the code on disk", () => {
  it("every admin page and API route is registered, and nothing registered is missing", () => {
    expect(pageFiles.map(urlOf).sort()).toEqual([...ADMIN_PAGES].sort());
    expect(apiFiles.map(urlOf).sort()).toEqual(ADMIN_API.map((a) => a.path).sort());
    expect(pageFiles.length).toBeGreaterThanOrEqual(10);
  });

  it("every page and layout calls adminPage() and every API route goes through withAdminRoute(); only the code screen, the layout and the MFA routes may allow a locked owner", () => {
    for (const f of [...pageFiles, ...layoutFiles]) {
      const src = readFileSync(f, "utf8");
      const isLayout = f.endsWith("layout.tsx");
      if (isLayout || allowLocked.has(urlOf(f)))
        expect(src, f).toMatch(/await adminPage\(\{ allowLocked: true \}\)/);
      else {
        expect(src, f).toMatch(/await adminPage\(\)/);
        expect(src, f).not.toMatch(/allowLocked/);
      }
    }
    for (const f of apiFiles) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toMatch(/withAdminRoute\(\s*req,/);
      if (!allowLocked.has(urlOf(f))) expect(src, f).not.toMatch(/allowLocked/);
    }
  });

  it("no admin file decides access from the client: no 'use client' page and no role check outside lib/admin/guard", () => {
    for (const f of [...pageFiles, ...layoutFiles])
      expect(readFileSync(f, "utf8"), f).not.toMatch(/["']use client["']/);
    for (const f of [...pageFiles, ...layoutFiles, ...apiFiles])
      expect(readFileSync(f, "utf8"), f).not.toMatch(/\.role\s*[=!]==?/);
  });

  it("each API file's exported methods match the registry", () => {
    for (const a of ADMIN_API) {
      const file = apiFiles.find((f) => urlOf(f) === a.path)!;
      const src = readFileSync(file, "utf8");
      const exported = [...src.matchAll(/export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/g)]
        .map((m) => m[1])
        .sort();
      expect(exported, a.path).toEqual([...a.methods].sort());
    }
  });
});

type PageMod = { default: (p: unknown) => Promise<unknown> };
const loadPage = async (page: string) =>
  (await import(/* @vite-ignore */ `@/app/(admin)${page}/page`)) as PageMod;
const props = () => ({
  params: Promise.resolve({ id: ID }),
  searchParams: Promise.resolve({ q: "x", reason: "abuse review reason" }),
  children: null,
});
const outcome = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (x: unknown) => x,
  );
type ApiMod = Record<string, (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>>;
const loadApi = async (path: string) => (await import(/* @vite-ignore */ `@/app${path}/route`)) as ApiMod;
const apiReq = (path: string, method: string) =>
  new Request(`http://localhost:3000${path.replace("[id]", ID)}`, {
    method,
    headers: SAME_ORIGIN,
    body:
      method === "GET"
        ? undefined
        : JSON.stringify({
            reason: "enumeration probe reason",
            action: "ban",
            credits: 5,
            domain: "x.example",
            code: "000000",
          }),
  });
const ctx = { params: Promise.resolve({ id: ID }) };

describe("every admin route: everyone but the owner gets the ordinary 404", () => {
  let user: TestSessionUser;
  let suspendedAdmin: TestSessionUser;
  let otherAdmin: TestSessionUser;
  let unverifiedOwner: TestSessionUser;
  let owner: TestSessionUser;
  beforeAll(async () => {
    user = await makeUser({ credits: 0 });
    otherAdmin = await makeAdmin(); // role admin, but not ADMIN_EMAIL
    owner = await makeOwner();
    suspendedAdmin = { ...owner, status: "suspended" };
    unverifiedOwner = { ...owner, emailVerified: false };
  });
  afterEach(() => {
    clearCookies();
    asUser(null);
  });

  const nonOwners = () =>
    [
      ["ordinary user", user],
      ["admin role, other email", otherAdmin],
      ["owner email, suspended", suspendedAdmin],
      ["owner email, unverified", unverifiedOwner],
      ["signed out", null],
    ] as const;

  for (const page of ADMIN_PAGES) {
    it(`page ${page}: non-owners (signed out too) -> 404, even holding a step-up cookie`, async () => {
      const mod = await loadPage(page);
      for (const [label, who] of nonOwners()) {
        asUser(who);
        if (who) stepUp(who);
        expect(isNotFound(await outcome(mod.default(props()))), `${page} as ${label}`).toBe(true);
        clearCookies();
      }
    });
  }

  it("the admin layout is guarded the same way", async () => {
    const mod = (await import("@/app/(admin)/admin/layout")) as PageMod;
    for (const [label, who] of nonOwners()) {
      asUser(who);
      expect(isNotFound(await outcome(mod.default({ children: null }))), label).toBe(true);
    }
  });

  for (const api of ADMIN_API) {
    for (const method of api.methods) {
      it(`${method} ${api.path}: non-owners (signed out too) -> 404 {error:"not_found"}`, async () => {
        const mod = await loadApi(api.path);
        for (const [label, who] of nonOwners()) {
          asUser(who);
          if (who) stepUp(who);
          const res = await mod[method]!(apiReq(api.path, method), ctx);
          expect(res.status, `${method} ${api.path} as ${label}`).toBe(404);
          expect(await res.json()).toEqual({ error: "not_found" });
          clearCookies();
        }
      });
    }
  }

  it("with ADMIN_PATH unset the console is off, even for the owner with a step-up", async () => {
    const saved = process.env.ADMIN_PATH;
    try {
      for (const v of [undefined, "too-short", "Has-Upper-Case-And-Long-Enough-0000"]) {
        if (v === undefined) delete process.env.ADMIN_PATH;
        else process.env.ADMIN_PATH = v;
        asUser(owner);
        stepUp(owner);
        expect(isNotFound(await outcome((await loadPage("/admin")).default(props()))), String(v)).toBe(true);
        const res = await (
          await loadApi("/api/admin/costs/export")
        ).GET!(apiReq("/api/admin/costs/export", "GET"), ctx);
        expect(res.status, String(v)).toBe(404);
      }
    } finally {
      process.env.ADMIN_PATH = saved;
    }
  });

  it("the owner without a step-up: every page redirects to the code screen (keeping the place), every API answers 403 mfa_required", async () => {
    asUser(owner);
    for (const page of ADMIN_PAGES.filter((p) => !allowLocked.has(p))) {
      const want = `${TEST_BASE}${page.slice("/admin".length).replace("[id]", ID)}?q=x`;
      setRequestPath(want);
      const e = await outcome((await loadPage(page)).default(props()));
      expect(isRedirect(e), page).toBe(true);
      const to = new URL(redirectUrl(e), "http://x");
      expect(to.pathname, page).toBe(`${TEST_BASE}/unlock`);
      expect(to.searchParams.get("next"), page).toBe(want);
    }
    setRequestPath(null);
    for (const api of ADMIN_API.filter((a) => !allowLocked.has(a.path)))
      for (const method of api.methods) {
        const res = await (await loadApi(api.path))[method]!(apiReq(api.path, method), ctx);
        expect(res.status, `${method} ${api.path}`).toBe(403);
        expect(await res.json()).toEqual({ error: "mfa_required" });
      }
  });

  it("the owner with a step-up for another session (signed out and in again) is locked again", async () => {
    asUser(owner, "a-new-session");
    stepUp(owner, `test-session-${owner.id}`);
    expect(isRedirect(await outcome((await loadPage("/admin")).default(props())))).toBe(true);
    const res = await (
      await loadApi("/api/admin/costs/export")
    ).GET!(apiReq("/api/admin/costs/export", "GET"), ctx);
    expect(res.status).toBe(403);
  });

  it("the owner with a step-up sees the console", async () => {
    asUser(owner);
    stepUp(owner);
    for (const page of ADMIN_PAGES) {
      const e = await outcome((await loadPage(page)).default(props()));
      if (page === "/admin/unlock") {
        // already unlocked: straight back to the console
        expect(isRedirect(e)).toBe(true);
        expect(redirectUrl(e)).toBe(TEST_BASE);
      } else if (page.includes("[id]")) {
        expect(isRedirect(e), page).toBe(false); // an unknown id is a plain 404, never the code screen
      } else expect(e, page).toBeNull();
    }
    const layout = (await import("@/app/(admin)/admin/layout")) as PageMod;
    expect(await outcome(layout.default({ children: null }))).toBeNull();
    const res = await (
      await loadApi("/api/admin/costs/export")
    ).GET!(new Request("http://localhost:3000/api/admin/costs/export?days=1"), ctx);
    expect(res.status).toBe(200);
  });
});
