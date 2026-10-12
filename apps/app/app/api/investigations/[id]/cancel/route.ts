import { requireUser } from "@/lib/auth/session";
import { assertSameOrigin, handle, idParam, json } from "@/lib/runs/http";
import { cancelInvestigation } from "@/lib/runs/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/investigations/{id}/cancel: launcher.cancel + cancelRequestedAt; settles on the `cancelled` event or via the watchdog. */
export function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    return json(await cancelInvestigation(user.id, await idParam(ctx)), 202);
  });
}
