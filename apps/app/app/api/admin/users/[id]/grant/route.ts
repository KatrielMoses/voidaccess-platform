import { NextResponse } from "next/server";
import { withAdminRoute } from "@/lib/admin/guard";
import { grantCredits } from "@/lib/admin/actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const body = (req: Request) => req.json().catch(() => ({})) as Promise<Record<string, unknown>>;

/** POST { credits, reason, requestId? }: a manual credit grant (a top-up-style lot). */
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withAdminRoute(req, async (admin) => {
    const { id } = await params;
    const b = await body(req);
    return NextResponse.json(await grantCredits(admin, id, b.credits, b.reason, b.requestId));
  });
}
