import { NextResponse } from "next/server";
import { hasFeature } from "@voidaccess/config";
import { json401, json404, sessionUser } from "@/lib/results/http";
import { getArtifact, getPlanId, loadSnapshot, UUID_RE } from "@/lib/results/queries";
import {
  FORMAT_META,
  buildCsvZip,
  buildIocZip,
  buildJson,
  buildMarkdown,
  exportFilename,
  isArtifact,
  isFormat,
  isGated,
} from "@/lib/results/exports";

export const dynamic = "force-dynamic";

/**
 * Exports are generated on request from the caller's own (RLS-scoped) snapshot. CSV and JSON are open to
 * every plan; everything else needs export_all, enforced here as well as in the UI.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; format: string }> }) {
  const userId = await sessionUser();
  if (!userId) return json401();
  const { id, format } = await params;
  if (!UUID_RE.test(id) || !isFormat(format)) return json404();

  const snapshot = await loadSnapshot(userId, id);
  if (!snapshot) return json404();

  if (isGated(format) && !hasFeature(await getPlanId(userId), "export_all")) {
    return NextResponse.json(
      { error: "upgrade_required", feature: "export_all" },
      { status: 403, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const now = new Date();
  const headers = {
    "Content-Type": FORMAT_META[format].mime,
    "Content-Disposition": `attachment; filename="${exportFilename(id, format)}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Investigation-Id": id,
    "X-Generated-At": now.toISOString(),
  };

  if (isArtifact(format)) {
    const a = await getArtifact(userId, id, format);
    if (!a) return json404();
    return new Response(new Uint8Array(a.bytes), { headers });
  }
  switch (format) {
    case "csv":
      return new Response(buildCsvZip(snapshot, now), { headers });
    case "json":
      return new Response(buildJson(snapshot, now), { headers });
    case "markdown":
      return new Response(buildMarkdown(snapshot, now), { headers });
    case "ioc":
      return new Response(buildIocZip(snapshot, now), { headers });
  }
  return json404();
}
