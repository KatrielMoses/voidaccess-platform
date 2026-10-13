import { NextResponse } from "next/server";
import { withAdminRoute } from "@/lib/admin/guard";
import { setUserStatus, type StatusAction } from "@/lib/admin/actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const body = (req: Request) => req.json().catch(() => ({})) as Promise<Record<string, unknown>>;

/** POST { action: "suspend" | "unsuspend" | "ban", reason } */
export function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withAdminRoute(req, async (admin) => {
    const { id } = await params;
    const b = await body(req);
    return NextResponse.json(await setUserStatus(admin, id, b.action as StatusAction, b.reason));
  });
}
