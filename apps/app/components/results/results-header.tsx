import { Badge } from "@voidaccess/ui";
import type { InvestigationView } from "@/lib/results/types";
import { formatDate } from "@/lib/results/format";
import { HeaderActions } from "./header-actions";

export function ResultsHeader({ inv }: { inv: InvestigationView }) {
  const extra = inv.refinedQueries.filter(
    (q) => q.trim() && q.trim().toLowerCase() !== inv.query.trim().toLowerCase(),
  );
  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs tracking-wide text-fg-secondary uppercase">Investigation</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight break-words">{inv.query}</h1>
        </div>
        <HeaderActions id={inv.id} />
      </div>
      <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-fg-secondary">
        <div className="flex items-center gap-2">
          <dt className="sr-only">Depth</dt>
          <dd>
            <Badge variant="accent">{inv.depth}</Badge>
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Credits used</dt>
          <dd className="font-mono text-fg" data-testid="credits-used">
            {inv.creditsCharged}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Completed</dt>
          <dd className="text-fg">{formatDate(inv.completedAt ?? inv.createdAt, true)}</dd>
        </div>
      </dl>
      {extra.length > 0 ? (
        <p className="text-sm text-fg-secondary">
          <span className="font-medium text-fg">Searched as: </span>
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
