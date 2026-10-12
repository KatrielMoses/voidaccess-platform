import { notFound } from "next/navigation";
import { getSessionUserId } from "@/lib/dev-session";
import { getActors } from "@/lib/results/queries";
import { ActorsView } from "@/components/results/actors-view";

export const dynamic = "force-dynamic";

export default async function ActorsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getSessionUserId();
  const actors = userId ? await getActors(userId, id) : null;
  if (!actors) notFound();
  return <ActorsView actors={actors} investigationId={id} />;
}
