import { json401, json404, jsonOk, sessionUser } from "@/lib/results/http";
import { getArchiveContext } from "@/lib/archive/read";

export const dynamic = "force-dynamic";

/**
 * GET /api/investigations/[id]/archive[?entity=<bundleId>][&lite=1]: what the VoidAccess archive already knew about this
 * investigation's entities (from other sources), neighbours seen alongside as leads, and sources that went offline.
 * The investigation is looked up under RLS first: another user's id is a 404.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await sessionUser();
  if (!userId) return json401();
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const ctx = await getArchiveContext(userId, id, {
    only: sp.get("entity") ?? undefined,
    lite: sp.get("lite") === "1",
  });
  return ctx ? jsonOk(ctx) : json404();
}
