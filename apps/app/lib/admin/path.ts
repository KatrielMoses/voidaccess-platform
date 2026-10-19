/**
 * Where the admin console is reachable. The pages live under app/(admin)/admin/** (internal path /admin), but the
 * public URL is /${ADMIN_PATH}/**, a secret slug supplied only at runtime (Secret Manager in production; never in
 * the repo, tests, commits or logs). proxy.ts rewrites the secret path to the internal one and answers any direct
 * request for /admin or /admin/... with the ordinary 404, so the console is invisible without the slug. With
 * ADMIN_PATH unset (or invalid) the console is unreachable everywhere.
 *
 * Every in-console link and redirect is built with adminHref(); client components receive the base as a prop.
 * This module reads process.env directly (no next/headers) so proxy.ts can use it.
 */

/** A slug like "admin-<32 hex>": at least 24 characters of [a-z0-9-]. */
export const ADMIN_PATH_RE = /^[a-z0-9-]{24,}$/;

/** The internal route prefix of the console pages (the folder under app/(admin)). */
export const INTERNAL_ADMIN = "/admin";

/** The valid slug, or null (unset or invalid: fail closed). */
export function adminSlug(env: Record<string, string | undefined> = process.env): string | null {
  const s = env.ADMIN_PATH?.trim();
  return s && ADMIN_PATH_RE.test(s) ? s : null;
}

/** The public base of the console, e.g. "/<slug>". Throws when the console is not configured (callers are guarded). */
export function adminBase(): string {
  const s = adminSlug();
  if (!s) throw new Error("ADMIN_PATH is not configured");
  return `/${s}`;
}

/** A public console URL: adminHref("/users/1") -> "/<slug>/users/1"; adminHref("/") or "" -> "/<slug>". */
export function adminHref(path = "/", base: string = adminBase()): string {
  if (!path || path === "/") return base;
  if (path.startsWith("?")) return `${base}${path}`;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function safeDecode(p: string): string {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

/** True for /admin and /admin/... in any spelling Next might route (case, percent-encoding, doubled slashes). */
export function isInternalAdminPath(pathname: string): boolean {
  const p = safeDecode(pathname)
    .toLowerCase()
    .replace(/\/{2,}/g, "/");
  return p === INTERNAL_ADMIN || p === `${INTERNAL_ADMIN}/` || p.startsWith(`${INTERNAL_ADMIN}/`);
}

/** For a request under the secret base, the internal path it maps to; otherwise null. */
export function toInternalAdminPath(pathname: string, slug: string | null): string | null {
  if (!slug) return null;
  const base = `/${slug}`;
  if (pathname === base || pathname === `${base}/`) return INTERNAL_ADMIN;
  if (pathname.startsWith(`${base}/`)) return `${INTERNAL_ADMIN}${pathname.slice(base.length)}`;
  return null;
}

/**
 * A safe place to return to after the code screen: only a console URL under `base` (no other origin, no
 * protocol-relative or backslash tricks). Anything else falls back to the console's overview.
 */
export function safeAdminNext(raw: unknown, base: string): string {
  const v = typeof raw === "string" ? raw : Array.isArray(raw) ? String(raw[0] ?? "") : "";
  if (!v || v.includes("\\") || v.startsWith("//") || [...v].some((c) => c.charCodeAt(0) < 0x20)) return base;
  if (/\/\.|%2e/i.test(v)) return base; // no dot segments: the browser would resolve them out of the console
  const path = v.split(/[?#]/)[0]!;
  if (path !== base && !path.startsWith(`${base}/`)) return base;
  if (path === `${base}/unlock` || path.startsWith(`${base}/unlock/`)) return base;
  return v;
}
