import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin } from "@/lib/account/csrf";
import { withUserRoute } from "@/lib/account/route-auth";
import { getPrefs, setProductEmails } from "@/lib/ops/preferences";

export const dynamic = "force-dynamic";

export function GET() {
  return withUserRoute(async (user) => NextResponse.json(await getPrefs(user.id)));
}

const Body = z.object({ productEmails: z.boolean() }).strict();

/** Usage alerts are transactional and always on, so they are not a preference and are not accepted here. */
export async function PATCH(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  return withUserRoute(async (user) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    await setProductEmails(user.id, parsed.data.productEmails);
    return NextResponse.json(await getPrefs(user.id));
  });
}
