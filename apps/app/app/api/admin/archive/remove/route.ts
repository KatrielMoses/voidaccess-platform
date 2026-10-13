import { NextResponse } from "next/server";
import { withAdminRoute } from "@/lib/admin/guard";
import { removeArchiveItem } from "@/lib/admin/actions";
import { archiveDepsFor } from "@/lib/archive/deps";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const body = (req: Request) => req.json().catch(() => ({})) as Promise<Record<string, unknown>>;

/** POST { kind: "entity" | "source" | "page", key, reason }: tombstone + object deletion, audited by the archive package. */
export function POST(req: Request) {
  return withAdminRoute(req, async (admin) => {
    const b = await body(req);
    return NextResponse.json(
      await removeArchiveItem(
        admin,
        { kind: b.kind, key: b.key, reason: b.reason },
        archiveDepsFor().objectStore,
      ),
    );
  });
}
