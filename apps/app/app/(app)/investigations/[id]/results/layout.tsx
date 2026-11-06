import { notFound } from "next/navigation";
import { getSessionUserId } from "@/lib/dev-session";
import { getInvestigation, getPlanId } from "@/lib/results/queries";
import { ResultsHeader } from "@/components/results/results-header";
import { ResultsNav } from "@/components/results/results-nav";
import { NoDirectNotice, directIsEmpty } from "@/components/results/relevance";
import { PreviewProvider } from "@/components/results/preview/preview-context";
import { UnlockReturn } from "@/components/results/preview/unlock-return";
import { loadUnlockOffer } from "@/lib/preview/offer-server";
import { isPreview } from "@/lib/preview/types";
import { accessOf, totalsFromInvestigation } from "@/lib/preview/view";

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
  const access = accessOf(inv);
  const preview = isPreview(access);
  // the unlock price is only needed by accounts that can see a preview: never by Pro and Pro+
  const plan = await getPlanId(userId!);
  const offer = preview || plan === "free" ? await loadUnlockOffer(userId!) : null;
  const totals = preview ? access.totals : null;
  return (
    <PreviewProvider
      investigationId={id}
      access={access}
      fallbackTotals={totalsFromInvestigation(inv)}
      offer={offer}
    >
      <div className="flex flex-col gap-5">
        <ResultsHeader inv={inv} />
        <UnlockReturn investigationId={id} />
        {inv.relevance && directIsEmpty(inv.relevance) ? (
          <NoDirectNotice query={inv.query} relevance={inv.relevance} />
        ) : null}
        <ResultsNav
          id={id}
          counts={{
            // a preview's tabs show the full totals: the reader sees how much the report holds
            entities: totals?.entities ?? inv.summary.stats?.entities ?? 0,
            actors: totals?.actors ?? inv.summary.stats?.actors ?? 0,
            sources: totals?.sources ?? inv.summary.stats?.sources ?? 0,
          }}
        />
        {children}
      </div>
    </PreviewProvider>
  );
}
