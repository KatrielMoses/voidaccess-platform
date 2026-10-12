/**
 * Session lookup for the results routes (lane RESULTS, P3).
 *
 * Production and normal development use P2's real session (Better Auth, httpOnly cookie): the user
 * must be signed in and active. The cookie/env shim below exists only for the results-lane Playwright
 * run (playwright.results.config.ts) and needs BOTH NODE_ENV=development AND VA_DEV_AUTH=1.
 * TODO: move e2e/results.spec.ts to real sign-in like e2e/app.spec.ts, then delete the shim.
 */
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth/session";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getSessionUserId(): Promise<string | null> {
  const user = await getSessionUser();
  if (user) return user.status === "active" ? user.id : null;
  if (process.env.NODE_ENV !== "development" || process.env.VA_DEV_AUTH !== "1") return null;
  const id = (await cookies()).get("va_dev_user")?.value ?? process.env.DEV_AS_USER;
  return id && UUID_RE.test(id) ? id : null;
}
