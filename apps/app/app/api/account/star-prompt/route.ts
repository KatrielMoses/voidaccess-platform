import { NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/account/csrf";
import { withUserRoute } from "@/lib/account/route-auth";
import { dismissStarPrompt } from "@/lib/ops/star-prompt";

export const dynamic = "force-dynamic";

/** DELETE = dismiss the prompt for good (remembered on the user row). */
export async function DELETE(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  return withUserRoute(async (user) => {
    await dismissStarPrompt(user.id);
    return NextResponse.json({ ok: true });
  });
}
