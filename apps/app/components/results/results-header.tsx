import type { InvestigationView } from "@/lib/results/types";
import { formatDate } from "@/lib/results/format";
import { HeaderActions } from "./header-actions";

/** Compact results header: the title, one mono status line, actions on the right (the graph gets the height). */
export function ResultsHeader({ inv }: { inv: InvestigationView }) {
  const extra = inv.refinedQueries.filter(
    (q) => q.trim() && q.trim().toLowerCase() !== inv.query.trim().toLowerCase(),
  );
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-2.5">
        <h1 className="text-[clamp(24px,2.4vw,32px)] leading-[1.08] font-medium tracking-[-0.03em] break-words">
          {inv.query}
        </h1>
        <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 font-mono text-[12px] text-mute">
          <div className="flex gap-2">
            <dt>Depth</dt>
            <dd className="text-paper">{inv.depth}</dd>
          </div>
          <div className="flex gap-2">
            <dt>Credits used</dt>
            <dd className="text-paper tabular-nums" data-testid="credits-used">
              {inv.creditsCharged}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt>Completed</dt>
            <dd className="text-paper tabular-nums">{formatDate(inv.completedAt ?? inv.createdAt, true)}</dd>
          </div>
          {extra.length > 0 ? (
            <div className="flex min-w-0 gap-2 max-[960px]:hidden">
              <dt>Searched as</dt>
              <dd className="max-w-[44ch] truncate text-dim" title={extra.join(" · ")}>
                {extra.map((q) => `“${q}”`).join(" · ")}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
      <HeaderActions id={inv.id} />
    </header>
  );
}
