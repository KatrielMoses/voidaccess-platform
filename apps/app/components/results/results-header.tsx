import type { InvestigationView } from "@/lib/results/types";
import { formatDate } from "@/lib/results/format";
import { HeaderActions } from "./header-actions";

export function ResultsHeader({ inv }: { inv: InvestigationView }) {
  const extra = inv.refinedQueries.filter(
    (q) => q.trim() && q.trim().toLowerCase() !== inv.query.trim().toLowerCase(),
  );
  return (
    <header className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[13px] text-dim">Investigation</p>
          <h1 className="mt-2 text-[clamp(28px,3.2vw,40px)] leading-[1.08] font-medium tracking-[-0.03em] break-words">
            {inv.query}
          </h1>
        </div>
        <HeaderActions id={inv.id} />
      </div>
      <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-2 font-mono text-[12px] text-mute">
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
      </dl>
      {extra.length > 0 ? (
        <p className="text-[14px] text-dim">
          <span className="text-paper">Searched as: </span>
          {extra.map((q, i) => (
            <span key={q}>
              {i > 0 ? " · " : ""}
              <q>{q}</q>
            </span>
          ))}
        </p>
      ) : null}
    </header>
  );
}
