import { notFound } from "next/navigation";
import { pageUser } from "@/lib/page-user";
import { getInvestigation, isUuid } from "@/lib/runs/service";
import { LiveProgress, type RunSnapshot } from "./live-progress";

export const metadata = { title: "Investigation | VoidAccess" };

export default async function InvestigationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser();
  if (!isUuid(id)) notFound();
  const run = await getInvestigation(user.id, id);
  if (!run) notFound();
  const snapshot: RunSnapshot = {
    id: run.id,
    title: run.title,
    depth: run.depth,
    status: run.status,
    failureReason: run.failureReason,
    refinedQueries: run.refinedQueries,
    startedAt: (run.startedAt ?? run.createdAt).toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    cancelRequested: run.cancelRequested,
    creditsReserved: run.creditsReserved,
    creditsRefunded: run.creditsRefunded,
    stagesCompleted: run.stagesCompleted,
    currentStage: run.currentStage,
    counts: run.counts,
  };
  return <LiveProgress initial={snapshot} />;
}
