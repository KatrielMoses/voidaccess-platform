import { NextResponse } from "next/server";
import { withAdminRoute } from "@/lib/admin/guard";
import { addBlockedDomain, removeBlockedDomain } from "@/lib/admin/actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const body = (req: Request) => req.json().catch(() => ({})) as Promise<Record<string, unknown>>;

/** POST { domain, reason }: block sign-ups from a domain (H1 enforces it at sign-up). */
export function POST(req: Request) {
  return withAdminRoute(req, async (admin) => {
    const b = await body(req);
    return NextResponse.json(await addBlockedDomain(admin, b.domain, b.reason));
  });
}

/** DELETE { domain, reason }: unblock. */
export function DELETE(req: Request) {
  return withAdminRoute(req, async (admin) => {
    const b = await body(req);
    return NextResponse.json(await removeBlockedDomain(admin, b.domain, b.reason));
  });
}
