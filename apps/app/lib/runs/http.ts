/** Small HTTP helpers shared by the run routes: JSON errors, body parsing, CSRF (same-origin) check. */
import { AuthError } from "@/lib/auth/session";
import { getEnv } from "../../env";
import { RunError } from "./errors";
import { isUuid } from "./service";

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

/**
 * CSRF protection for every mutating user route (POST/PATCH/DELETE), on top of SameSite=Lax cookies.
 * Rule: a browser always sends `Sec-Fetch-Site` (modern engines) and `Origin` (on non-GET). We accept the
 * request only if `Sec-Fetch-Site` is `same-origin`, or, when that header is absent, `Origin` equals the
 * origin of APP_URL. A request with neither header (curl, forged) is rejected. Engine and cron routes are
 * NOT user-session routes: they authenticate with HMAC / OIDC / shared secret and skip this check.
 */
export function assertSameOrigin(req: Request): void {
  const site = req.headers.get("sec-fetch-site");
  if (site) {
    if (site === "same-origin") return;
    throw new RunError("csrf", "Cross-site request blocked.");
  }
  const origin = req.headers.get("origin");
  if (origin && origin === new URL(getEnv().APP_URL).origin) return;
  throw new RunError("csrf", "Cross-site request blocked.");
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const v: unknown = await req.json();
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new RunError("invalid_body", "Expected a JSON object body.");
}

/** Resolve the `[id]` param; a non-uuid id is simply "not found" (404), never a database error. */
export async function idParam(ctx: { params: Promise<{ id: string }> }): Promise<string> {
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new RunError("not_found", "Investigation not found.");
  return id;
}

/** Map thrown errors to responses. Other users' investigations are always 404, never 403. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthError)
      return json({ error: e.status === 401 ? "unauthorized" : "forbidden", message: e.message }, e.status);
    if (e instanceof RunError) return json({ error: e.code, message: e.message, ...e.details }, e.status);
    console.error("route error:", e instanceof Error ? e.message : e);
    return json({ error: "internal", message: "Something went wrong." }, 500);
  }
}
