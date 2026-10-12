import { NextResponse } from "next/server";
import { withUserRoute } from "@/lib/account/route-auth";
import { assertSameOrigin } from "@/lib/account/csrf";
import { resumeSubscription } from "@/lib/billing/plan-ops";

export const dynamic = "force-dynamic";

export function POST(req: Request) {
  const blocked = assertSameOrigin(req);
  if (blocked) return blocked;
  return withUserRoute(async (user) =>
    (await resumeSubscription(user.id))
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "nothing_to_resume" }, { status: 409 }),
  );
}
