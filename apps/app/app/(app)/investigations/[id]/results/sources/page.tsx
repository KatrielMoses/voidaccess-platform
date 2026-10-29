import { notFound } from "next/navigation";
import { getSessionUserId } from "@/lib/dev-session";
import { getInvestigation, getSources } from "@/lib/results/queries";
import { SourcesList } from "@/components/results/sources-list";

export const dynamic = "force-dynamic";

export default async function SourcesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getSessionUserId();
  const [inv, sources] = userId
    ? await Promise.all([getInvestigation(userId, id), getSources(userId, id)])
    : [null, null];
  if (!inv || !sources) notFound();
  // tiered investigations group by relevance first; older ones render exactly as before
  return <SourcesList sources={sources} tiered={inv.relevance !== null} query={inv.query} />;
}
