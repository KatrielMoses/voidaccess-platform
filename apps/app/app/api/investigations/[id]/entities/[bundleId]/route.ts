import { json401, json404, jsonOk, sessionUser } from "@/lib/results/http";
import { getEntityDetail } from "@/lib/results/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; bundleId: string }> }) {
  const userId = await sessionUser();
  if (!userId) return json401();
  const { id, bundleId } = await params;
  const detail = await getEntityDetail(userId, id, bundleId);
  return detail ? jsonOk(detail) : json404();
}
