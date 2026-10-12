import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteAccount } from "@/lib/account/delete";
import { assertSameOrigin } from "@/lib/account/csrf";
import { withUserRoute } from "@/lib/account/route-auth";

export const dynamic = "force-dynamic";

const body = z.object({ confirm: z.string() });

/** Typed confirmation: the body must carry the account's own email address. */
export function POST(req: Request) {
  const bad = assertSameOrigin(req);
  if (bad) return Promise.resolve(bad);
  return withUserRoute(async (user) => {
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success || parsed.data.confirm.trim().toLowerCase() !== user.email.toLowerCase()) {
      return NextResponse.json({ error: "confirmation_mismatch" }, { status: 400 });
    }
    await deleteAccount(user.id);
    const res = NextResponse.json({ ok: true });
    for (const name of [
      "better-auth.session_token",
      "__Secure-better-auth.session_token",
      "better-auth.session_data",
      "__Secure-better-auth.session_data",
    ]) {
      res.cookies.set(name, "", { maxAge: 0, path: "/" });
    }
    return res;
  });
}
