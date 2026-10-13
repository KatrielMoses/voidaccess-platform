import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth/auth";
import { corsHeaders, withCors } from "@/lib/auth/cors";
import { parseAttribution } from "@/lib/auth/attribution";
import { trackEvent } from "@/lib/analytics";

/**
 * PRD §7 `signup_started`: recorded server-side the moment an email sign-up request reaches the auth API (the site's
 * beacon was removed in D1). Only attribution from the body is kept; no IP address or user agent is read.
 */
async function trackSignupStarted(req: Request): Promise<void> {
  try {
    if (req.method !== "POST" || !new URL(req.url).pathname.endsWith("/sign-up/email")) return;
    const body = (await req.clone().json()) as { firstTouch?: unknown } | null;
    const ft =
      body?.firstTouch && typeof body.firstTouch === "object"
        ? parseAttribution({ cookie: JSON.stringify(body.firstTouch) })
        : null;
    await trackEvent("signup_started", { props: { method: "password" }, firstTouch: ft });
  } catch {
    /* analytics never affects sign-up */
  }
}

const handler = (method: "GET" | "POST") => async (req: Request) => {
  if (method === "POST") await trackSignupStarted(req);
  return withCors(req, await toNextJsHandler(getAuth())[method](req));
};

export const GET = handler("GET");
export const POST = handler("POST");
export const OPTIONS = (req: Request) => new Response(null, { status: 204, headers: corsHeaders(req) });
