// Anonymous sign-up-started beacon. Whitelisted event name, per-IP in-memory rate limit, first-touch attribution
// from the va_ft cookie (via the one parser). Never throws to the client.
import { NextResponse } from "next/server";
import { trackEvent } from "@/lib/analytics";
import { FIRST_TOUCH_COOKIE, parseAttribution } from "@/lib/auth/attribution";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["signup_started"]);
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const hits = new Map<string, number[]>();

function limited(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  return false;
}

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  if (limited(ip)) return NextResponse.json({ ok: false }, { status: 429 });
  const body = (await req.json().catch(() => null)) as { event?: unknown } | null;
  if (typeof body?.event !== "string" || !ALLOWED.has(body.event))
    return NextResponse.json({ ok: false }, { status: 400 });
  const cookie = req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${FIRST_TOUCH_COOKIE}=`))
    ?.slice(FIRST_TOUCH_COOKIE.length + 1);
  const ft = parseAttribution({ cookie });
  await trackEvent("signup_started", {
    props: {
      ...(ft?.utm ? { utm: ft.utm } : {}),
      ...(ft?.ref ? { ref: ft.ref } : {}),
      ...(ft?.landing ? { landing: ft.landing } : {}),
    },
  });
  return NextResponse.json({ ok: true });
}
