import { NextResponse } from "next/server";
import { withAdminRoute } from "@/lib/admin/guard";
import { markAbuseReviewed, type ReviewItem, type ReviewStatus } from "@/lib/admin/actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const body = (req: Request) => req.json().catch(() => ({})) as Promise<Record<string, unknown>>;

/** POST { kind: "flag" | "run" | "user", id, status?: "reviewed" | "dismissed" | "actioned", reason } */
export function POST(req: Request) {
  return withAdminRoute(req, async (admin) => {
    const b = await body(req);
    return NextResponse.json(
      await markAbuseReviewed(
        admin,
        { kind: b.kind, id: b.id } as ReviewItem,
        (b.status ?? "reviewed") as ReviewStatus,
        b.reason,
      ),
    );
  });
}
