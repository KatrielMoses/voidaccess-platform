import { NextResponse } from "next/server";
import { withUserRoute } from "@/lib/account/route-auth";
import { unlockCheckoutState } from "@/lib/preview/checkout-status";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

/** GET ?ref=<checkout ref>[&probe=1] -> { plan, paidPlan, completed, provider }. Only the caller's own checkouts. */
export function GET(req: Request) {
  return withUserRoute(async (user) => {
    const sp = new URL(req.url).searchParams;
    const state = await unlockCheckoutState(user.id, sp.get("ref") ?? "", { probe: sp.get("probe") === "1" });
    if (!state) return NextResponse.json({ error: "not_found" }, { status: 404, headers: noStore });
    return NextResponse.json(state, { headers: noStore });
  });
}
