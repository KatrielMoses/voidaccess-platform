"use client";

import { useEffect, useState } from "react";
import { authClient } from "./client";

/**
 * Whether the visitor is signed in, asked once per page load. The session cookie is shared with the app's domain
 * (COOKIE_DOMAIN), and the app answers /api/auth/get-session to this site with credentials (lib/auth/cors.ts).
 * Only used to adjust links ("Open console" instead of "Sign in"): the app enforces access, never this site.
 */
let ask: Promise<boolean> | null = null;
export function signedIn(): Promise<boolean> {
  ask ??= authClient
    .getSession()
    .then((r) => !!r.data?.user)
    .catch(() => false);
  return ask;
}

export function useSignedIn(): boolean {
  const [yes, setYes] = useState(false);
  useEffect(() => {
    let live = true;
    void signedIn().then((v) => live && setYes(v));
    return () => {
      live = false;
    };
  }, []);
  return yes;
}
