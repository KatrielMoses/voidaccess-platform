import { NextResponse } from "next/server";
import { withUserRoute } from "@/lib/account/route-auth";
import { assertSameOrigin } from "@/lib/account/csrf";
import { portalLinkFor } from "@/lib/billing/post-effects";

export const dynamic = "force-dynamic";

/** POST -> { url }: a fresh Dodo customer-portal link (card, invoices, receipts). */
export function POST(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  return withUserRoute(async (user) => NextResponse.json({ url: await portalLinkFor(user.id) }));
}
