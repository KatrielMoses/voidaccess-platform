import { requireUser } from "@/lib/auth/session";
import { assertSameOrigin, handle, json, readJson } from "@/lib/runs/http";
import { clientIp } from "@/lib/rate-limit";
import { listInvestigations, startInvestigation } from "@/lib/runs/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/investigations?q=&status=&limit=&offset=  (withUser) */
export function GET(req: Request) {
  return handle(async () => {
    const user = await requireUser();
    const sp = new URL(req.url).searchParams;
    const num = (k: string) => (sp.has(k) && /^\d{1,6}$/.test(sp.get(k)!) ? Number(sp.get(k)) : undefined);
    return json(
      await listInvestigations(user.id, {
        q: sp.get("q") ?? undefined,
        status: sp.get("status") || undefined,
        limit: num("limit"),
        offset: num("offset"),
      }),
    );
  });
}

/** POST /api/investigations {query, depth}: create + reserve in one withUser tx, then launch. */
export function POST(req: Request) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const body = await readJson(req);
    const r = await startInvestigation(
      user,
      { query: body.query, depth: body.depth },
      { ip: clientIp(req.headers) },
    );
    return json(r, 201);
  });
}
