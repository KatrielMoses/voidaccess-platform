"use client";

import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { APP_URL } from "./config";

/** Talks to Better Auth on the app domain. The cookie is set there; this site never reads the session. */
export const authClient = createAuthClient({
  baseURL: APP_URL,
  plugins: [magicLinkClient()],
  fetchOptions: { credentials: "include" },
});
