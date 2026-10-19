// The one place that decides who may reach what on the app origin. proxy.ts applies it to every request.
//   - machine endpoints authenticate themselves (Better Auth, the engine's per-run tokens, cron OIDC, the Creem
//     webhook signature, the signed unsubscribe link) or are public by design (health, the founding seat counter);
//   - the old auth pages moved to the site and redirect there;
//   - everything else needs a session cookie here and a valid session in the page/route (requireUser/pageUser):
//     pages redirect to the site's sign-in, APIs answer 401 JSON.
export type RouteClass = "machine" | "moved" | "api" | "page";

const MACHINE_PREFIXES = ["/api/auth", "/api/engine/", "/api/cron/"];
// /unsubscribe and /api/unsubscribe are public on purpose: an email's signed link works without signing in.
const MACHINE_EXACT = new Set([
  "/api/webhooks/creem",
  "/api/health",
  "/api/founding/seats",
  "/unsubscribe",
  "/api/unsubscribe",
]);

/** Auth pages that now live on the site. The app keeps only /accept-terms. */
export const MOVED_PAGES = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/check-email",
] as const;

export function classifyPath(pathname: string): RouteClass {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (MACHINE_EXACT.has(p)) return "machine";
  if (
    p === "/api/auth" ||
    MACHINE_PREFIXES.some((x) => (x.endsWith("/") ? p.startsWith(x) : p.startsWith(`${x}/`)))
  )
    return "machine";
  if ((MOVED_PAGES as readonly string[]).includes(p)) return "moved";
  if (p === "/api" || p.startsWith("/api/")) return "api";
  return "page";
}

/** Where a signed-out visitor goes. `next` is always an absolute URL on the app origin. */
export function signInRedirect(siteUrl: string, appUrl: string, pathAndQuery: string): string {
  const site = siteUrl.replace(/\/$/, "");
  const app = appUrl.replace(/\/$/, "");
  const u = new URL(`${site}/sign-in`);
  if (pathAndQuery.startsWith("/") && !pathAndQuery.startsWith("//") && pathAndQuery !== "/") {
    u.searchParams.set("next", `${app}${pathAndQuery}`);
  }
  return u.toString();
}

/** A moved auth page's equivalent on the site, query string preserved (reset tokens, errors, emails). */
export function movedRedirect(siteUrl: string, pathname: string, search: string): string {
  return `${siteUrl.replace(/\/$/, "")}${pathname.replace(/\/+$/, "")}${search}`;
}

/** Better Auth session cookie, in both forms (plain and the production __Secure- prefix). */
export function hasSessionCookie(cookieHeader: string | null): boolean {
  if (!cookieHeader) return false;
  return /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=[^;]+/.test(cookieHeader);
}
