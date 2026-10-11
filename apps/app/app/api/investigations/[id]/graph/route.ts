import { json401, json404, jsonOk, sessionUser } from "@/lib/results/http";
import { getGraph } from "@/lib/results/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await sessionUser();
  if (!userId) return json401();
  const { id } = await params;
  const graph = await getGraph(userId, id);
  return graph ? jsonOk(graph) : json404();
}
