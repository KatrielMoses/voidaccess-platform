import { NextResponse } from "next/server";
import { withUserRoute } from "@/lib/account/route-auth";
import { assertSameOrigin } from "@/lib/account/csrf";
import { emitClientPreviewEvent, parseClientPreviewEvent } from "@/lib/preview/events";

export const dynamic = "force-dynamic";

/** POST { name, investigationId, ... }: the preview funnel events only the browser can see. Always 204 when valid. */
export function POST(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  return withUserRoute(async (user) => {
    const e = parseClientPreviewEvent(await req.json().catch(() => null));
    if (!e) return NextResponse.json({ error: "bad_request" }, { status: 400 });
    await emitClientPreviewEvent(user.id, e);
    return new Response(null, { status: 204 });
  });
}
