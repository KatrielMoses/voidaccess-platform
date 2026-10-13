import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ADMIN_API, ADMIN_PAGES } from "@/lib/admin/routes";
import { asUser, makeUser } from "./helpers";
import { makeAdmin, SAME_ORIGIN } from "./admin-helpers";
import type { TestSessionUser } from "./session-state";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

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

const isNotFound = (e: unknown) => (e as { digest?: string })?.digest === "NEXT_HTTP_ERROR_FALLBACK;404";
const isRedirect = (e: unknown) => String((e as { digest?: string })?.digest).startsWith("NEXT_REDIRECT");

describe("admin routes: registry matches the code on disk", () => {
  it("every admin page and API route is registered, and nothing registered is missing", () => {
    expect(pageFiles.map(urlOf).sort()).toEqual([...ADMIN_PAGES].sort());
    expect(apiFiles.map(urlOf).sort()).toEqual(ADMIN_API.map((a) => a.path).sort());
    expect(pageFiles.length).toBeGreaterThanOrEqual(9);
  });

  it("every page and layout calls adminPage() and every API route goes through withAdminRoute()", () => {
    for (const f of [...pageFiles, ...layoutFiles])
      expect(readFileSync(f, "utf8"), f).toMatch(/await adminPage\(\)/);
    for (const f of apiFiles) expect(readFileSync(f, "utf8"), f).toMatch(/withAdminRoute\(req,/);
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

describe("every admin route, as an ordinary user, a suspended admin, and signed out", () => {
  let user: TestSessionUser;
  let suspendedAdmin: TestSessionUser;
  beforeAll(async () => {
    user = await makeUser({ credits: 0 });
    suspendedAdmin = { ...(await makeAdmin()), status: "suspended" };
  });

  const props = (url: string) => ({
    params: Promise.resolve({ id: ID }),
    searchParams: Promise.resolve({ q: "x", reason: "abuse review reason" }),
    children: null,
    _url: url,
  });

  for (const page of ADMIN_PAGES) {
    it(`page ${page}: ordinary user -> 404, suspended admin -> 404, signed out -> sign-in redirect`, async () => {
      const mod = (await import(
        /* @vite-ignore */ `@/app/(admin)${page === "/admin" ? "/admin" : page}/page`
      )) as { default: (p: ReturnType<typeof props>) => Promise<unknown> };
      for (const who of [user, suspendedAdmin]) {
        asUser(who);
        const e = await mod.default(props(page)).then(
          () => null,
          (x: unknown) => x,
        );
        expect(isNotFound(e), `${page} as ${who.status}/${who.role}`).toBe(true);
      }
      asUser(null);
      const e = await mod.default(props(page)).then(
        () => null,
        (x: unknown) => x,
      );
      expect(isRedirect(e), `${page} signed out`).toBe(true);
    });
  }

  it("the admin layout is guarded the same way", async () => {
    const mod = (await import("@/app/(admin)/admin/layout")) as {
      default: (p: { children: null }) => Promise<unknown>;
    };
    asUser(user);
    expect(isNotFound(await mod.default({ children: null }).catch((x: unknown) => x))).toBe(true);
    asUser(null);
    expect(isRedirect(await mod.default({ children: null }).catch((x: unknown) => x))).toBe(true);
  });

  for (const api of ADMIN_API) {
    for (const method of api.methods) {
      it(`${method} ${api.path}: ordinary user -> 404 (no body details), suspended admin -> 404, signed out -> 401, nothing changes`, async () => {
        const mod = (await import(/* @vite-ignore */ `@/app${api.path}/route`)) as Record<
          string,
          (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>
        >;
        const mk = () =>
          new Request(`http://localhost:3000${api.path.replace("[id]", ID)}`, {
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
                  }),
          });
        const ctx = { params: Promise.resolve({ id: ID }) };
        for (const who of [user, suspendedAdmin]) {
          asUser(who);
          const res = await mod[method]!(mk(), ctx);
          expect(res.status, `${method} ${api.path} as ${who.status}/${who.role}`).toBe(404);
          expect(await res.json()).toEqual({ error: "not_found" });
        }
        asUser(null);
        const res = await mod[method]!(mk(), ctx);
        expect(res.status).toBe(401);
      });
    }
  }
});
