import { NextResponse } from "next/server";
import { withAdminRoute } from "@/lib/admin/guard";
import { revokeSessions } from "@/lib/admin/actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const body = (req: Request) => req.json().catch(() => ({})) as Promise<Record<string, unknown>>;

/** POST { reason }: deletes every session of the user (they must sign in again). */
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withAdminRoute(req, async (admin) => {
    const { id } = await params;
    return NextResponse.json(await revokeSessions(admin, id, (await body(req)).reason));
  });
}
