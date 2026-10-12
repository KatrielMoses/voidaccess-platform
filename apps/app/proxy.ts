import { NextResponse, type NextRequest } from "next/server";
import { classifyPath, hasSessionCookie, movedRedirect, signInRedirect } from "@/lib/guard";

// Signed-out requests never reach a page or app API. This is the cheap first layer (cookie present); the pages
// and routes still validate the session itself, and pageUser sends an invalid one to the same sign-in redirect.
export function proxy(req: NextRequest) {
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
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Static assets are public; everything else, including unknown paths, goes through the guard.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
