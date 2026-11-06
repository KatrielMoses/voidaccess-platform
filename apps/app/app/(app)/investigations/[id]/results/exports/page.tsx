import { notFound } from "next/navigation";
import { hasFeature } from "@voidaccess/config";
import { getSessionUserId } from "@/lib/dev-session";
import { getPlanId, listArtifactFormats } from "@/lib/results/queries";
import { ExportsView } from "@/components/results/exports-view";
import { exportStates } from "@/lib/results/formats";

export const dynamic = "force-dynamic";

export default async function ExportsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getSessionUserId();
  const list = userId ? await listArtifactFormats(userId, id) : null;
  if (!userId || !list) notFound();
  const exportAll = hasFeature(await getPlanId(userId), "export_all");
  const states = exportStates({ exportAll, artifacts: list.formats, previewLocked: list.locked });
  return <ExportsView investigationId={id} states={states} />;
}
