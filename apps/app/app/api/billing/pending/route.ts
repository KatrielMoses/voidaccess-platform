import { NextResponse } from "next/server";
import { withUserRoute } from "@/lib/account/route-auth";
import { assertSameOrigin } from "@/lib/account/csrf";
import { cancelPendingChange } from "@/lib/billing/plan-ops";

export const dynamic = "force-dynamic";

/** DELETE: drop a scheduled downgrade. */
export function DELETE(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  return withUserRoute(async (user) => {
    await cancelPendingChange(user.id);
    return NextResponse.json({ ok: true });
  });
}
