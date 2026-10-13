import { NextResponse } from "next/server";
import { withAdminRoute } from "@/lib/admin/guard";
import { AdminError } from "@/lib/admin/errors";
import { refundInvestigation } from "@/lib/admin/actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const body = (req: Request) => req.json().catch(() => ({})) as Promise<Record<string, unknown>>;

/** POST { investigationId, reason }: full refund of one of the user's investigations (once). */
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withAdminRoute(req, async (admin) => {
    const { id } = await params;
    const b = await body(req);
    const r = await refundInvestigation(admin, String(b.investigationId ?? ""), b.reason, {
      expectUserId: id,
    });
    if (r.alreadyRefunded && r.refunded === 0 && r.charged === 0)
      throw new AdminError(409, "Nothing was charged for that investigation");
    return NextResponse.json(r);
  });
}
