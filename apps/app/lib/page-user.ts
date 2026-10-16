import { cache } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getEnv } from "@/env";
import { signInRedirect } from "@/lib/guard";
import { AuthError, getSessionUser, type SessionUser } from "@/lib/auth/session";

/** The site's sign-in, remembering where the visitor was headed (set by proxy.ts). */
export async function signInUrl(): Promise<string> {
  const env = getEnv();
  return signInRedirect(env.SITE_URL, env.APP_URL, (await headers()).get("x-va-path") ?? "/");
}

/**
 * The user for an authenticated page or layout. Redirects instead of throwing:
 * signed out -> the site's sign-in, inactive -> its ?error=inactive, AUP not accepted -> /accept-terms.
 * Memoised per request so the layout and the page share one lookup.
 */
export const pageUser = cache(async (): Promise<SessionUser> => {
  let u: SessionUser | null;
  try {
    u = await getSessionUser();
  } catch (e) {
    if (e instanceof AuthError) u = null;
    else throw e;
  }
  if (!u) redirect(await signInUrl());
  if (u.status !== "active") redirect(`${getEnv().SITE_URL}/sign-in?error=inactive`);
  if (!u.aupAcceptedAt) {
    const path = (await headers()).get("x-va-path") ?? "/";
    redirect(`/accept-terms?next=${encodeURIComponent(path)}`);
  }
  return u;
});
