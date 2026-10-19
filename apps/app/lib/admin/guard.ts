/**
 * Admin access control, enforced on the server from the real session on every request. There is no client-side
 * check that grants anything and no API to assign the role (it is the ops script, scripts/admin-grant-role.ts).
 *
 * The console is owner-only. Access needs ALL of:
 *  - the console is configured (ADMIN_PATH set and valid; see lib/admin/path.ts and proxy.ts);
 *  - a valid session, user status active, role "admin";
 *  - a verified email equal (trimmed, case-insensitive) to ADMIN_EMAIL (default katriel@voidaccess.pro);
 *  - a valid step-up: a signed cookie from a correct authenticator code in the last hour, bound to this session.
 *
 * Anyone who isn't the owner, signed out included, gets the ordinary 404 (pages) or 404 {error:"not_found"} (APIs),
 * so the console's existence is never revealed. The owner without a step-up: pages redirect to the code screen
 * (`<base>/unlock?next=<where they were going>`) before any data loads; APIs answer 403 {error:"mfa_required"}.
 *
 * Every page under app/(admin) calls adminPage() itself and every route under app/api/admin goes through
 * withAdminRoute(): a layout alone does not protect a page's data fetching in the App Router. Only the layout, the
 * code screen and the MFA routes may pass { allowLocked: true }. test/admin-routes.test.ts enforces all of this by
 * scanning the files.
 */
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getSessionWithId } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/account/csrf";
import { AdminError } from "./errors";
import { isOwner, type AdminUser } from "./owner";
import { adminHref, adminSlug } from "./path";
import { STEP_UP_COOKIE, verifyStepUp } from "./stepup";

export type { AdminUser } from "./owner";
export { isOwner, ownerEmail } from "./owner";
export type AdminSession = AdminUser & { unlocked: boolean; sessionId: string };

/** The owner's session with its step-up state, or null for everyone else (and when the console is off). */
const ownerSession = cache(async (): Promise<AdminSession | null> => {
  if (!adminSlug()) return null;
  const s = await getSessionWithId().catch(() => null);
  if (!s || !isOwner(s.user)) return null;
  const jar = await cookies();
  const unlocked = verifyStepUp(jar.get(STEP_UP_COOKIE)?.value, s.user.id, s.sessionId);
  return { ...s.user, unlocked, sessionId: s.sessionId };
});

/** The public URL of the request (proxy.ts sets x-va-path), for the code screen's return address. */
async function currentPath(): Promise<string> {
  const h = await headers();
  return h.get("x-va-path") ?? adminHref("/");
}

export async function adminPage(opts?: { allowLocked?: boolean }): Promise<AdminSession> {
  const s = await ownerSession();
  if (!s) notFound();
  if (!s.unlocked && !opts?.allowLocked)
    redirect(adminHref(`/unlock?${new URLSearchParams({ next: await currentPath() })}`));
  return s;
}

const json = (body: unknown, status: number) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export const notFoundJson = () => json({ error: "not_found" }, 404);

/**
 * Wrap an /api/admin handler. Non-owners (signed out included) get 404; the owner without a step-up gets 403
 * mfa_required. Mutating methods also require a same-origin request (on top of the cookies' SameSite), checked only
 * after the caller is known to be the owner so nobody else learns anything.
 */
export async function withAdminRoute(
  req: Request,
  fn: (admin: AdminSession) => Promise<Response>,
  opts?: { allowLocked?: boolean },
): Promise<Response> {
  const u = await ownerSession();
  if (!u) return notFoundJson();
  if (req.method !== "GET" && req.method !== "HEAD") {
    const blocked = assertSameOrigin(req);
    if (blocked) return blocked;
  }
  if (!u.unlocked && !opts?.allowLocked) return json({ error: "mfa_required" }, 403);
  try {
    return await fn(u);
  } catch (e) {
    if (e instanceof AdminError) return json({ error: e.message }, e.status);
    throw e;
  }
}
