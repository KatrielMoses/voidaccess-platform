import { json401, json404, jsonOk, parseEntityQuery, sessionUser } from "@/lib/results/http";
import { searchEntities } from "@/lib/results/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await sessionUser();
  if (!userId) return json401();
  const { id } = await params;
  const page = await searchEntities(userId, id, parseEntityQuery(new URL(req.url).searchParams));
  return page ? jsonOk(page) : json404();
}
