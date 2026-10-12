// Mutation routes under /api/account require a same-origin request (on top of SameSite=Lax cookies): Sec-Fetch-Site same-origin, or Origin equal to APP_URL; neither means rejected.
import { NextResponse } from "next/server";

export function assertSameOrigin(req: Request): NextResponse | null {
  const site = req.headers.get("sec-fetch-site");
  if (site)
    return site === "same-origin" ? null : NextResponse.json({ error: "cross_site" }, { status: 403 });
  const origin = req.headers.get("origin");
  const allowed = new URL(process.env.APP_URL ?? "http://localhost:3000").origin;
  if (origin && origin === allowed) return null;
  return NextResponse.json({ error: "cross_site" }, { status: 403 });
}
