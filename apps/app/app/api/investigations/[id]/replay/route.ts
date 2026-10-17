import { requireUser } from "@/lib/auth/session";
import { RunError } from "@/lib/runs/errors";
import { handle, idParam, json } from "@/lib/runs/http";
import { getReplay } from "@/lib/runs/replay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/investigations/{id}/replay: the stored events of a finished run (withUser), for "Replay run". */
export function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const id = await idParam(ctx);
    const replay = await getReplay(user.id, id);
    if (!replay) throw new RunError("not_found", "Investigation not found.");
    return json(replay);
  });
}
