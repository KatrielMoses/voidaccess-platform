import { notFound } from "next/navigation";
import { hasFeature } from "@voidaccess/config";
import { getSessionUserId } from "@/lib/dev-session";
import { getPlanId, listArtifactFormats } from "@/lib/results/queries";
import { ExportsView } from "@/components/results/exports-view";
import { exportStates } from "@/lib/results/formats";
import { getReportAccess } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function ExportsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getSessionUserId();
  const artifacts = userId ? await listArtifactFormats(userId, id) : null;
  if (!userId || !artifacts) notFound();
  const [plan, access] = await Promise.all([getPlanId(userId), getReportAccess(userId, id)]);
  const exportAll = hasFeature(plan, "export_all");
  // a preview locks every export (the routes answer 402); the buttons stay visible and open the unlock panel
  const preview = access === "preview";
  return (
    <ExportsView
      investigationId={id}
      states={exportStates({ exportAll, artifacts, preview })}
      preview={preview}
    />
  );
}
