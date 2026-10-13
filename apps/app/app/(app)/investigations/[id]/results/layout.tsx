import { notFound } from "next/navigation";
import { getSessionUserId } from "@/lib/dev-session";
import { getInvestigation } from "@/lib/results/queries";
import { ResultsHeader } from "@/components/results/results-header";
import { ResultsNav } from "@/components/results/results-nav";
import { StarPrompt } from "@/components/results/star-prompt";
import { starPromptVisible } from "@/lib/ops/star-prompt";
import { GITHUB_URL } from "@/lib/site";

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
  // PRD §3.9: after a successful investigation, one dismissible prompt (never a banner), remembered per user
  const showStar = inv.status === "completed" && (await starPromptVisible(userId!));
  return (
    <div className="flex flex-col gap-6">
      <ResultsHeader inv={inv} />
      <ResultsNav
        id={id}
        counts={{
          entities: inv.summary.stats?.entities ?? 0,
          actors: inv.summary.stats?.actors ?? 0,
          sources: inv.summary.stats?.sources ?? 0,
        }}
      />
      {showStar ? <StarPrompt href={GITHUB_URL} /> : null}
      {children}
    </div>
  );
}
