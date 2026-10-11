import { requireUser } from "@/lib/auth/session";
import { handle, idParam } from "@/lib/runs/http";
import { openEventStream, parseLastEventId } from "@/lib/runs/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/investigations/{id}/events: SSE progress stream (withUser; resumable via Last-Event-ID). */
export function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireUser();
    const id = await idParam(ctx);
    const last = parseLastEventId(
      req.headers.get("last-event-id") ?? new URL(req.url).searchParams.get("lastEventId"),
    );
    return openEventStream(user.id, id, req.signal, last);
  });
}
