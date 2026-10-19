import { NextResponse, type NextRequest } from "next/server";
import { classifyPath, hasSessionCookie, movedRedirect, signInRedirect } from "@/lib/guard";
import { adminSlug, isInternalAdminPath, toInternalAdminPath } from "@/lib/admin/path";
import { isOwner } from "@/lib/admin/owner";
import { sessionFromHeaders } from "@/lib/auth/session";

/** A path no route serves: rewriting here renders the app's ordinary 404, exactly as for any unknown URL. */
export const NOT_FOUND_REWRITE = "/__va-not-found";

// Signed-out requests never reach a page or app API. This is the cheap first layer (cookie present); the pages
// and routes still validate the session itself, and pageUser sends an invalid one to the same sign-in redirect.
//
// The admin console: its pages live at the internal /admin/**, but are served only under the secret base
// /${ADMIN_PATH} (rewritten here), and only to the owner (lib/admin/owner.ts). Everyone else, a direct request for
// /admin or /admin/..., and every request when ADMIN_PATH is unset, is handled exactly like an unknown URL: the same
// sign-in redirect when signed out, the same 404 page when signed in. The pages check the owner and the step-up again.
// Never log the request path here: under the secret base it contains the slug.
export function proxy(req: NextRequest): NextResponse | Promise<NextResponse> {
  const siteUrl = process.env.SITE_URL ?? "https://voidaccess.pro";
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const { pathname, search } = req.nextUrl;
  const kind = classifyPath(pathname);
  if (kind === "machine") return NextResponse.next();
  if (kind === "moved") return NextResponse.redirect(movedRedirect(siteUrl, pathname, search), 307);
  if (!hasSessionCookie(req.headers.get("cookie"))) {
    if (kind === "api") return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    return NextResponse.redirect(signInRedirect(siteUrl, appUrl, `${pathname}${search}`), 307);
  }
  // Let server code build the same redirect for a cookie that turns out not to be a valid session.
  const headers = new Headers(req.headers);
  headers.set("x-va-path", `${pathname}${search}`);
  const rewrite = (path: string) =>
    NextResponse.rewrite(new URL(`${path}${search}`, req.url), { request: { headers } });
  if (kind === "page") {
    const internal = toInternalAdminPath(pathname, adminSlug());
    if (internal) return ownerOnly(req.headers).then((ok) => rewrite(ok ? internal : NOT_FOUND_REWRITE));
    if (isInternalAdminPath(pathname)) return rewrite(NOT_FOUND_REWRITE);
  }
  return NextResponse.next({ request: { headers } });
}

/** The secret path is served only to the owner; for anyone else it renders the very 404 of an unknown URL. */
async function ownerOnly(h: Headers): Promise<boolean> {
  const s = await sessionFromHeaders(h).catch(() => null);
  return isOwner(s?.user);
}

export const config = {
  // Public without a session: build output under /_next, the dev server's own endpoints (/__nextjs_*), and the
  // files in public/ (fonts, the logo and icons) so signed-out pages such as /unsubscribe render with the brand.
  // Everything else, including unknown paths, goes through the guard. Keep this list in step with apps/app/public.
  matcher: [
    "/((?!_next/|__nextjs|favicon.ico|favicon-32.png|apple-touch-icon.png|icon-192.png|icon-512.png|logo.png|fonts/).*)",
  ],
};
