/**
 * Build-time site mode. `SITE_MODE=minimal` serves only the home page, the auth pages and the legal pages;
 * every marketing route (and the waitlist with its database) answers 404. This is the single allowlist: the proxy,
 * the route-handler guards, robots, the layout and the not-found page all read it. Pure functions take the mode as
 * a parameter so they can be unit tested.
 */
export type SiteMode = "full" | "minimal";

// next.config.ts copies SITE_MODE into NEXT_PUBLIC_SITE_MODE so the value is inlined at build time on server and client.
export const SITE_MODE: SiteMode = process.env.NEXT_PUBLIC_SITE_MODE === "minimal" ? "minimal" : "full";
export const IS_MINIMAL = SITE_MODE === "minimal";

/** Pages that sign users in or manage their login. Never indexed. */
export const AUTH_PATHS = ["/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/check-email", "/verified"] as const;
export const LEGAL_PATHS = ["/acceptable-use", "/privacy", "/terms"] as const;

const MINIMAL_ALLOWED: ReadonlySet<string> = new Set([
  "/",
  ...AUTH_PATHS,
  ...LEGAL_PATHS,
  "/pricing",
  "/robots.txt",
  // Static files from /public used by the pages above.
  "/site.webmanifest",
]);

/**
 * Folders in /public that hold the home page's static files (CSS, JS, vendor libraries, fonts, images). They contain
 * only those files, so anything else under them is a plain 404 from the static file server.
 */
export const STATIC_DIRS = ["/assets/", "/css/", "/js/", "/vendor/", "/fonts/"] as const;

/** Next internals must stay reachable (JS, CSS, fonts); they carry no content of their own. */
const isInternal = (pathname: string) => pathname === "/_next" || pathname.startsWith("/_next/");
const isStatic = (pathname: string) => !pathname.includes("..") && STATIC_DIRS.some((d) => pathname.startsWith(d));

export function normalizePath(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

export function isAllowedPath(pathname: string, mode: SiteMode = SITE_MODE): boolean {
  if (mode === "full") return true;
  if (isInternal(pathname) || isStatic(pathname)) return true;
  return MINIMAL_ALLOWED.has(normalizePath(pathname));
}

/**
 * `www.` is not a separate site: send it to the bare host (same path and query). Always https, except for *.localhost
 * so local testing works. Null when no redirect applies.
 */
export function wwwRedirect(host: string | null, pathname: string, search: string): string | null {
  if (!host || !/^www\./i.test(host)) return null;
  const bare = host.replace(/^www\./i, "");
  const scheme = /(^|\.)localhost(:\d+)?$/i.test(bare) ? "http" : "https";
  return `${scheme}://${bare}${pathname}${search}`;
}

/** For route handlers: a 404 response when the route is not served in this mode, else null. */
export function minimalGuard(mode: SiteMode = SITE_MODE): Response | null {
  return mode === "minimal" ? new Response("Not found", { status: 404 }) : null;
}
