import { notFound } from "next/navigation";
import { pageUser } from "@/lib/page-user";
import { getInvestigation, isUuid } from "@/lib/runs/service";
import { isTerminalStatus } from "@/lib/runs/settle";
import { ReplayView } from "./replay-view";

export const metadata = { title: "Replay | VoidAccess" };

export default async function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await pageUser();
  if (!isUuid(id)) notFound();
  const run = await getInvestigation(user.id, id);
  if (!run || !isTerminalStatus(run.status)) notFound();
  return <ReplayView id={run.id} title={run.title} />;
}
