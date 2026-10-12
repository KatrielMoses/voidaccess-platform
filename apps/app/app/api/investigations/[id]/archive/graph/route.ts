import type { Tier } from "@voidaccess/archive";
import { json401, json404, jsonOk, sessionUser } from "@/lib/results/http";
import { getArchiveGraph } from "@/lib/archive/read";

export const dynamic = "force-dynamic";

const TIERS: Tier[] = ["unconfirmed", "corroborated", "feed_validated"];

/** GET .../archive/graph?hops=1|2&minTier=unconfirmed|corroborated|feed_validated: archive neighbours, each edge a lead with evidence and dates. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await sessionUser();
  if (!userId) return json401();
  const { id } = await params;
  const sp = new URL(req.url).searchParams;
  const tier = sp.get("minTier");
  const g = await getArchiveGraph(userId, id, {
    hops: sp.get("hops") === "2" ? 2 : 1,
    minTier: TIERS.includes(tier as Tier) ? (tier as Tier) : undefined,
  });
  return g ? jsonOk(g) : json404();
}
