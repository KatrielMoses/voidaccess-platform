import { NextResponse } from "next/server";
import { SITE_URL } from "@/lib/site";
import { getDb } from "@/lib/waitlist/db";
import { confirmWaitlist } from "@/lib/waitlist/service";
import { drizzleStore } from "@/lib/waitlist/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  try {
    const outcome = await confirmWaitlist(token, drizzleStore(await getDb()));
    const to = outcome === "invalid" ? "/waitlist/check-email?error=invalid" : "/waitlist/confirmed";
    return NextResponse.redirect(new URL(to, SITE_URL), { status: 303, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (e) {
    console.error("confirm error", e instanceof Error ? e.message : e);
    return NextResponse.redirect(new URL("/waitlist/check-email?error=invalid", SITE_URL), { status: 303 });
  }
}
