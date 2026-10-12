import { NextResponse } from "next/server";
import { AuthError, requireUser, type SessionUser } from "@/lib/auth/session";

/** Run a handler as the signed-in user; maps AuthError to 401/403 JSON. */
export async function withUserRoute(fn: (user: SessionUser) => Promise<Response>): Promise<Response> {
  try {
    return await fn(await requireUser());
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
