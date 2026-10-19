import { NextResponse } from "next/server";
import { withAdminRoute } from "@/lib/admin/guard";
import { auditLock } from "@/lib/admin/mfa";
import { STEP_UP_COOKIE, stepUpCookieOptions } from "@/lib/admin/stepup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST: "Lock now". Clears the step-up cookie; the next console request asks for a code again. */
export function POST(req: Request) {
  return withAdminRoute(
    req,
    async (admin) => {
      await auditLock(admin.id);
      const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
      res.cookies.set(STEP_UP_COOKIE, "", stepUpCookieOptions(0));
      return res;
    },
    { allowLocked: true },
  );
}
