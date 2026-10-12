import { clientIp } from "@/lib/request";
import { minimalGuard } from "@/lib/site-mode";

export const dynamic = "force-dynamic";

/** First-party proxy for Plausible events, forwarding the visitor's IP and user agent (never stored by us). */
export async function POST(req: Request) {
  const off = minimalGuard();
  if (off) return off;
  const headers = new Headers({ "Content-Type": "application/json", "User-Agent": req.headers.get("user-agent") ?? "" });
  const ip = clientIp(req.headers);
  if (ip) headers.set("X-Forwarded-For", ip);
  const res = await fetch("https://plausible.io/api/event", { method: "POST", headers, body: await req.text() }).catch(() => null);
  return new Response(res ? await res.text() : "", { status: res?.status ?? 502, headers: { "Content-Type": "text/plain" } });
}
