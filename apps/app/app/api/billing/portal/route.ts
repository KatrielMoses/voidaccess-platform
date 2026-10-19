import { NextResponse } from "next/server";
import { withUserRoute } from "@/lib/account/route-auth";
import { assertSameOrigin } from "@/lib/account/csrf";
import { billingPortal } from "@/lib/billing/plan-ops";

export const dynamic = "force-dynamic";

/** POST -> { url }: a fresh Creem customer-portal link (card, invoices, receipts). Not for a crypto pass (409). */
export function POST(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  return withUserRoute(async (user) => {
    const r = await billingPortal(user.id);
    return r.ok ? NextResponse.json({ url: r.url }) : NextResponse.json({ error: r.error }, { status: 409 });
  });
}
