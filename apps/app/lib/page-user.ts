import { cache } from "react";
import { redirect } from "next/navigation";
import { AuthError, getSessionUser, type SessionUser } from "@/lib/auth/session";

/**
 * The user for an authenticated page or layout. Redirects instead of throwing:
 * signed out -> /sign-in, inactive -> /sign-in?error=inactive, AUP not accepted -> /accept-terms.
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
  if (!u) redirect("/sign-in");
  if (u.status !== "active") redirect("/sign-in?error=inactive");
  if (!u.aupAcceptedAt) redirect("/accept-terms");
  return u;
});
