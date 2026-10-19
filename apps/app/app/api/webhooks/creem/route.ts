import { NextResponse } from "next/server";
import { runPostEffects } from "@/lib/billing/post-effects";
import { handleCreemWebhook } from "@/lib/billing/webhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Creem webhooks. The raw body is read as text: the signature covers the exact bytes. */
export async function POST(req: Request) {
  const raw = await req.text();
  const r = await handleCreemWebhook(raw, req.headers);
  if (r.post.length) await runPostEffects(r.post);
  return NextResponse.json(r.body, { status: r.status });
}
