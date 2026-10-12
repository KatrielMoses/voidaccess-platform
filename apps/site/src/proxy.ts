import { NextResponse, type NextRequest } from "next/server";
import { isAllowedPath, wwwRedirect } from "@/lib/site-mode";

/**
 * Runs before every route. 1) www.voidaccess.pro -> voidaccess.pro (301). 2) In SITE_MODE=minimal, anything outside
 * the allowlist in lib/site-mode.ts is rewritten to a path that does not exist, so it gets the real 404 page and
 * status without its route (waitlist, llms, og, ...) ever running.
 */
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const host = req.headers.get("host"); // not x-forwarded-host: clients can set that, and a redirect must only follow the real Host
  const target = wwwRedirect(host, pathname, search);
  if (target) return NextResponse.redirect(target, 301);
  if (!isAllowedPath(pathname)) return NextResponse.rewrite(new URL("/__not-served", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
