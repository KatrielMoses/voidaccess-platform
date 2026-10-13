import { NextResponse } from "next/server";
import { unsubscribeUser } from "@/lib/ops/preferences";
import { verifyUnsubscribe } from "@/lib/ops/unsubscribe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bad = () => NextResponse.json({ error: "invalid_link" }, { status: 400 });

/**
 * One-click unsubscribe (RFC 8058): the List-Unsubscribe header points here and mail clients POST. No sign-in; the signed
 * `u`/`t` pair in the query is the credential and only ever unsubscribes that one user. The confirmation page's button
 * posts here too (`from=page`) and is sent back to the page.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const u = url.searchParams.get("u") ?? "";
  const t = url.searchParams.get("t") ?? "";
  if (!verifyUnsubscribe(u, t)) return bad();
  await unsubscribeUser(u);
  const form = await req.formData().catch(() => null);
  if (form?.get("from") === "page")
    return NextResponse.redirect(
      new URL(`/unsubscribe?u=${encodeURIComponent(u)}&t=${t}&done=1`, req.url),
      303,
    );
  return NextResponse.json({ ok: true });
}

/** A link opened (or prefetched by a mail scanner) must never unsubscribe by itself: send people to the confirm page. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  return NextResponse.redirect(new URL(`/unsubscribe${url.search}`, req.url), 303);
}
