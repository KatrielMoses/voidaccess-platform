import { NextResponse } from "next/server";
import { withUserRoute } from "@/lib/account/route-auth";
import { assertSameOrigin } from "@/lib/account/csrf";
import { previewPlanChange } from "@/lib/billing/plan-ops";

export const dynamic = "force-dynamic";

/** POST { plan, interval } -> what the change would do, with the estimated prorated charge for upgrades. */
export function POST(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  return withUserRoute(async (user) => {
    const b = (await req.json().catch(() => null)) as { plan?: string; interval?: string } | null;
    if (!b) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    const r = await previewPlanChange(user.id, { plan: b.plan as never, interval: b.interval as never });
    return r.ok ? NextResponse.json(r.preview) : NextResponse.json({ error: r.error }, { status: 409 });
  });
}
