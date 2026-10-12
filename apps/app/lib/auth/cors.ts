import { corsOrigins } from "./origins";

const isProd = process.env.NODE_ENV === "production";

/** CORS for /api/auth/*: credentials allowed, and only for the site's origin(s). Anything else gets no CORS headers. */
export function corsHeaders(req: Request): Record<string, string> {
  const siteUrl = process.env.SITE_URL ?? "https://voidaccess.pro";
  const o = req.headers.get("origin");
  const h: Record<string, string> = { Vary: "Origin" };
  if (o && corsOrigins(siteUrl, isProd).includes(o)) {
    h["Access-Control-Allow-Origin"] = o;
    h["Access-Control-Allow-Credentials"] = "true";
    h["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Captcha-Response";
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}

export function withCors(req: Request, res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(corsHeaders(req))) out.headers.set(k, v);
  return out;
}
