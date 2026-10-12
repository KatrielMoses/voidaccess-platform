import { json401, json404, jsonOk, parseEntityQuery, sessionUser } from "@/lib/results/http";
import { searchEntities } from "@/lib/results/queries";
import { seenBundleIds } from "@/lib/archive/read";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await sessionUser();
  if (!userId) return json401();
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const query = parseEntityQuery(sp);
  // archive=new: only entities the archive has not seen from elsewhere; archive=seen: only the ones it has
  const archive = sp.get("archive");
  if (archive === "new" || archive === "seen") {
    const seen = await seenBundleIds(userId, id);
    if (!seen) return json404();
    query.bundleIds = archive === "seen" ? { include: [...seen] } : { exclude: [...seen] };
  }
  const page = await searchEntities(userId, id, query);
  return page ? jsonOk(page) : json404();
}
