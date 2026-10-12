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
  const artifacts = userId ? await listArtifactFormats(userId, id) : null;
  if (!userId || !artifacts) notFound();
  const exportAll = hasFeature(await getPlanId(userId), "export_all");
  return <ExportsView investigationId={id} states={exportStates({ exportAll, artifacts })} />;
}
