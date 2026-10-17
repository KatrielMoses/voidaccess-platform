import { notFound } from "next/navigation";
import { getSessionUserId } from "@/lib/dev-session";
import { getInvestigation } from "@/lib/results/queries";
import { ResultsHeader } from "@/components/results/results-header";
import { ResultsNav } from "@/components/results/results-nav";

export default async function ResultsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const userId = await getSessionUserId();
  const inv = userId ? await getInvestigation(userId, id) : null;
  if (!inv) notFound();
  return (
    <div className="flex flex-col gap-5">
      <ResultsHeader inv={inv} />
      <ResultsNav
        id={id}
        counts={{
          entities: inv.summary.stats?.entities ?? 0,
          actors: inv.summary.stats?.actors ?? 0,
          sources: inv.summary.stats?.sources ?? 0,
        }}
      />
      {children}
    </div>
  );
}
