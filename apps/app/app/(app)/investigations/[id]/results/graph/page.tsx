import { notFound } from "next/navigation";
import { getSessionUserId } from "@/lib/dev-session";
import { getInvestigation } from "@/lib/results/queries";
import { GraphLoader } from "@/components/results/graph-loader";

export const dynamic = "force-dynamic";

export default async function GraphPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getSessionUserId();
  if (!userId || !(await getInvestigation(userId, id))) notFound();
  return <GraphLoader investigationId={id} />;
}
