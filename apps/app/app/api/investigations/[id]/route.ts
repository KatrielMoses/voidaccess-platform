import { requireUser } from "@/lib/auth/session";
import { RunError } from "@/lib/runs/errors";
import { assertSameOrigin, handle, idParam, json, readJson } from "@/lib/runs/http";
import { deleteInvestigation, getInvestigation, renameInvestigation } from "@/lib/runs/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };

/** GET /api/investigations/{id}: status snapshot (withUser; another user's id is a 404). */
export function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const user = await requireUser();
    const r = await getInvestigation(user.id, await idParam(ctx));
    if (!r) throw new RunError("not_found", "Investigation not found.");
    return json(r);
  });
}

/** PATCH /api/investigations/{id} {title}: rename (null or blank resets to the query). */
export function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    const id = await idParam(ctx);
    const body = await readJson(req);
    if (!("title" in body)) throw new RunError("invalid_body", "title is required");
    return json(await renameInvestigation(user.id, id, body.title));
  });
}

/** DELETE /api/investigations/{id}: only terminal runs; cancel first otherwise (409). */
export function DELETE(req: Request, ctx: Ctx) {
  return handle(async () => {
    assertSameOrigin(req);
    const user = await requireUser();
    await deleteInvestigation(user.id, await idParam(ctx));
    return json({ ok: true });
  });
}
