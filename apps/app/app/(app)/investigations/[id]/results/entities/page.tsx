import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getSessionUserId } from "@/lib/dev-session";
import { getInvestigation } from "@/lib/results/queries";
import { EntitiesView } from "@/components/results/entities-view";

export const dynamic = "force-dynamic";

export default async function EntitiesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getSessionUserId();
  const inv = userId ? await getInvestigation(userId, id) : null;
  if (!inv) notFound();
  return (
    <Suspense fallback={<p className="font-mono text-[13px] text-mute">Loading entities…</p>}>
      <EntitiesView investigationId={id} typeCounts={inv.summary.entityCounts} />
    </Suspense>
  );
}
