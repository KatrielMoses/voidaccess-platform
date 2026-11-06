import { PreviewLockedError } from "@/lib/access";
import { json401, json402, json404, jsonOk, sessionUser } from "@/lib/results/http";
import { getEntityDetail } from "@/lib/results/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; bundleId: string }> }) {
  const userId = await sessionUser();
  if (!userId) return json401();
  const { id, bundleId } = await params;
  try {
    const detail = await getEntityDetail(userId, id, bundleId);
    return detail ? jsonOk(detail) : json404();
  } catch (e) {
    if (e instanceof PreviewLockedError) return json402();
    throw e;
  }
}
