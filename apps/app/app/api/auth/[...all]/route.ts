import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth/auth";
import { corsHeaders, withCors } from "@/lib/auth/cors";
import { parseAttribution } from "@/lib/auth/attribution";
import { trackEvent } from "@/lib/analytics";

/**
 * PRD §7 `signup_started`: recorded server-side when someone asks for an email sign-in code (the first step of every
 * email sign-in; account creation itself is `signup_completed`). Only attribution from the body is kept; no IP address
 * or user agent is read.
 */
async function trackSignupStarted(req: Request): Promise<void> {
  try {
    if (req.method !== "POST" || !new URL(req.url).pathname.endsWith("/email-otp/send-verification-otp"))
      return;
    const body = (await req.clone().json()) as { firstTouch?: unknown } | null;
    const ft =
      body?.firstTouch && typeof body.firstTouch === "object"
        ? parseAttribution({ cookie: JSON.stringify(body.firstTouch) })
        : null;
    await trackEvent("signup_started", { props: { method: "email_code" }, firstTouch: ft });
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
