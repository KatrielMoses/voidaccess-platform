import { isUuid } from "@/lib/runs/service";
import { json } from "@/lib/runs/http";
import { consumeSpecToken } from "@/lib/runs/spec";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/engine/runs/{id}/spec?t=<token>: single-use RunSpec fetch for the launched engine. withSystem('engine.spec'). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const t = new URL(req.url).searchParams.get("t");
  const notFound = () => json({ error: "not_found" }, 404);
  if (!isUuid(id) || !t || t.length > 128) return notFound();
  const spec = await consumeSpecToken(id, t);
  return spec ? json(spec) : notFound();
}
