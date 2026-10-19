import { NextResponse } from "next/server";
import { withAdminRoute } from "@/lib/admin/guard";
import { verifyAdminCode } from "@/lib/admin/mfa";
import { STEP_UP_COOKIE, signStepUp, stepUpCookieOptions } from "@/lib/admin/stepup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS = { invalid_code: 400, enrolment_expired: 410, too_many_attempts: 429 } as const;

/**
 * POST { code }: the owner's authenticator code. Confirms the enrolment in progress (first visit) or verifies the
 * enrolled authenticator, then sets the one-hour step-up cookie. Non-owners get 404 like every admin route.
 */
export function POST(req: Request) {
  return withAdminRoute(
    req,
    async (admin) => {
      const b = (await req.json().catch(() => ({}))) as { code?: unknown };
      const code = typeof b.code === "string" ? b.code.slice(0, 16) : "";
      const r = await verifyAdminCode(admin.id, code);
      if (!r.ok)
        return NextResponse.json(
          { error: r.error },
          { status: STATUS[r.error], headers: { "Cache-Control": "private, no-store" } },
        );
      const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
      res.cookies.set(STEP_UP_COOKIE, signStepUp(admin.id, admin.sessionId), stepUpCookieOptions());
      return res;
    },
    { allowLocked: true },
  );
}
