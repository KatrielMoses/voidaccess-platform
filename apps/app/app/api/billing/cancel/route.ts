import { NextResponse } from "next/server";
import { withUserRoute } from "@/lib/account/route-auth";
import { assertSameOrigin } from "@/lib/account/csrf";
import { cancelAtPeriodEnd } from "@/lib/billing/plan-ops";

export const dynamic = "force-dynamic";

/** POST { reason? }: cancel at the end of the paid period. One call, no confirmation maze. */
export function POST(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  return withUserRoute(async (user) => {
    const b = (await req.json().catch(() => ({}))) as { reason?: string };
    const r = await cancelAtPeriodEnd(
      user.id,
      typeof b.reason === "string" ? b.reason.slice(0, 500) : undefined,
    );
    return r.ok
      ? NextResponse.json({ endsAt: r.endsAt })
      : NextResponse.json({ error: "no_subscription" }, { status: 409 });
  });
}
