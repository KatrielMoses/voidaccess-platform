/**
 * DEV-ONLY session shim (lane RESULTS, P3). P2 owns real auth: at merge, replace the body of
 * getSessionUserId() with the real session helper (or delete this file and update the imports).
 *
 * Active only when NODE_ENV === "development": the user is the `va_dev_user` cookie if present
 * (used by the Playwright test to switch between a pro and a free user), else DEV_AS_USER.
 * In every other environment it returns null, so results routes answer 404/401.
 */
import { cookies } from "next/headers";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getSessionUserId(): Promise<string | null> {
  if (process.env.NODE_ENV !== "development") return null;
  const fromCookie = (await cookies()).get("va_dev_user")?.value;
  const id = fromCookie ?? process.env.DEV_AS_USER;
  return id && UUID_RE.test(id) ? id : null;
}
