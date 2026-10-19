import { NextResponse } from "next/server";
import { runPostEffects } from "@/lib/billing/post-effects";
import { handleNowPaymentsIpn } from "@/lib/billing/crypto/ipn";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** NOWPayments IPN callbacks. Read as text and parsed once: the signature is checked over the parsed body. */
export async function POST(req: Request) {
  const raw = await req.text();
  const r = await handleNowPaymentsIpn(raw, req.headers);
  if (r.post.length) await runPostEffects(r.post);
  return NextResponse.json(r.body, { status: r.status });
}
