import { NextResponse } from "next/server";
import { withUserRoute } from "@/lib/account/route-auth";
import { assertSameOrigin } from "@/lib/account/csrf";
import { requestPlanChange } from "@/lib/billing/plan-ops";

export const dynamic = "force-dynamic";

/** POST { plan, interval, confirmReleaseFounding? }. Upgrades go to Creem now; downgrades are recorded for the period end. */
export function POST(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  return withUserRoute(async (user) => {
    const b = (await req.json().catch(() => null)) as {
      plan?: string;
      interval?: string;
      confirmReleaseFounding?: boolean;
    } | null;
    if (!b) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const r = await requestPlanChange(user.id, {
      plan: b.plan as never,
      interval: b.interval as never,
      confirmReleaseFounding: b.confirmReleaseFounding === true,
    });
    return r.ok
      ? NextResponse.json({ kind: r.kind, effectiveAt: r.effectiveAt })
      : NextResponse.json({ error: r.error }, { status: 409 });
  });
}
