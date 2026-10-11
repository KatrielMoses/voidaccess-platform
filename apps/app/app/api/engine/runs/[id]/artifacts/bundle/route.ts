import { launcherKind } from "@/lib/launcher";
import { putMockBundle } from "@/lib/launcher/artifacts";
import { json } from "@/lib/runs/http";
import { deriveArtifactToken, safeEqualHex } from "@/lib/runs/secrets";
import { isUuid } from "@/lib/runs/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * PUT /api/engine/runs/{id}/artifacts/bundle?t=<hmac>: the mock engine's bundle upload (dev/test only).
 * 404 unless the mock launcher is selected. The token is HMAC(ENGINE_CALLBACK_SECRET, run id), nothing stored.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const t = new URL(req.url).searchParams.get("t") ?? "";
  if (launcherKind() !== "mock" || !isUuid(id) || !safeEqualHex(t, deriveArtifactToken(id)))
    return json({ error: "not_found" }, 404);
  const body = await req.text();
  if (body.length > MAX_BYTES) return json({ error: "too_large" }, 413);
  await putMockBundle(id, body);
  return json({ ok: true });
}
