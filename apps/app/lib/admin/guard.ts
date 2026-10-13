/**
 * Admin access control, enforced on the server from the real session on every request. There is no client-side
 * check that grants anything and no API to assign the role (it is the ops script, scripts/admin-grant-role.ts).
 *
 *  - signed out: pages go to the site's sign-in (proxy.ts already does this; adminPage repeats it for invalid cookies),
 *    APIs answer 401.
 *  - signed in but not an active admin: 404, so the existence of /admin is not revealed.
 *
 * Every page under app/(admin) calls adminPage() itself and every route under app/api/admin goes through
 * withAdminRoute(): a layout alone does not protect a page's data fetching in the App Router. test/admin-routes.test.ts
 * enforces both by scanning the files.
 */
import { notFound, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getSessionUser, type SessionUser } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/account/csrf";
import { signInUrl } from "@/lib/page-user";
import { AdminError } from "./errors";

export type AdminUser = SessionUser & { role: "admin" };

const isAdmin = (u: SessionUser | null): u is AdminUser => !!u && u.role === "admin" && u.status === "active";

export async function adminPage(): Promise<AdminUser> {
  const u = await getSessionUser().catch(() => null);
  if (!u) redirect(await signInUrl());
  if (!isAdmin(u)) notFound();
  return u;
}

const json = (body: unknown, status: number) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export const notFoundJson = () => json({ error: "not_found" }, 404);

/**
 * Wrap an /api/admin handler. Mutating methods also require a same-origin request (on top of SameSite=Lax cookies),
 * checked only after the caller is known to be an admin so a non-admin learns nothing.
 */
export async function withAdminRoute(
  req: Request,
  fn: (admin: AdminUser) => Promise<Response>,
): Promise<Response> {
  const u = await getSessionUser().catch(() => null);
  if (!u) return json({ error: "Sign in required" }, 401);
  if (!isAdmin(u)) return notFoundJson();
  if (req.method !== "GET" && req.method !== "HEAD") {
    const blocked = assertSameOrigin(req);
    if (blocked) return blocked;
  }
  try {
    return await fn(u);
  } catch (e) {
    if (e instanceof AdminError) return json({ error: e.message }, e.status);
    throw e;
  }
}
