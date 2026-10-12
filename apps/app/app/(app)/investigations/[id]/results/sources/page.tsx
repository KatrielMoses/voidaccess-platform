import { notFound } from "next/navigation";
import { getSessionUserId } from "@/lib/dev-session";
import { getSources } from "@/lib/results/queries";
import { SourcesList } from "@/components/results/sources-list";

export const dynamic = "force-dynamic";

export default async function SourcesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getSessionUserId();
  const sources = userId ? await getSources(userId, id) : null;
  if (!sources) notFound();
  return <SourcesList sources={sources} />;
}
