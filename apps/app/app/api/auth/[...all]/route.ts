import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth/auth";
import { corsHeaders, withCors } from "@/lib/auth/cors";

const handler = (method: "GET" | "POST") => async (req: Request) =>
  withCors(req, await toNextJsHandler(getAuth())[method](req));

export const GET = handler("GET");
export const POST = handler("POST");
export const OPTIONS = (req: Request) => new Response(null, { status: 204, headers: corsHeaders(req) });
