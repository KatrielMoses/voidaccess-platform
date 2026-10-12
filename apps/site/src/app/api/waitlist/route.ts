import { after, NextResponse } from "next/server";
import { clientIp } from "@/lib/request";
import { joinWaitlist } from "@/lib/waitlist/service";
import { runtimeDeps } from "@/lib/waitlist/runtime";
import { minimalGuard } from "@/lib/site-mode";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const off = minimalGuard();
  if (off) return off;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_input" }, { status: 400 });
  }
  try {
    const result = await joinWaitlist(raw, { ip: clientIp(req.headers) }, await runtimeDeps());
    if (result.status === 200) {
      after(() => result.background().catch((e) => console.error("waitlist email failed", e instanceof Error ? e.message : e)));
    }
    return NextResponse.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("waitlist error", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "network" }, { status: 500 });
  }
}
