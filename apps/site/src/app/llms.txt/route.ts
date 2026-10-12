import { buildLlmsTxt } from "@/lib/llms";
import { minimalGuard } from "@/lib/site-mode";

export const dynamic = "force-static";

export function GET() {
  const off = minimalGuard();
  if (off) return off;
  return new Response(buildLlmsTxt(), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
