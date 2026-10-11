import { handleEngineCallback } from "@/lib/runs/callbacks";
import { json } from "@/lib/runs/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/engine/runs/{id}/events: HMAC-signed engine callback. withSystem('engine.callback'). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const raw = await req.text();
  try {
    const r = await handleEngineCallback(id, req.headers, raw);
    return json(r.body, r.status);
  } catch (e) {
    console.error("engine callback error:", e instanceof Error ? e.message : e);
    return json({ error: "internal" }, 500); // 5xx: the engine retries; (run_id, seq) dedupe makes that safe
  }
}
