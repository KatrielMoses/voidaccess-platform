import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@voidaccess/ui";
import { getSessionUserId } from "@/lib/dev-session";
import { formatDuration } from "@/lib/results/format";
import { getInvestigation } from "@/lib/results/queries";
import { SafeMarkdown } from "@/components/results/markdown";
import { TypeBadge } from "@/components/results/type-badge";
import { ArchivePanel } from "@/components/results/archive-panel";

export const dynamic = "force-dynamic";

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface px-4 py-3">
      <dt className="text-xs tracking-wide text-fg-secondary uppercase">{label}</dt>
      <dd className="mt-1 font-display text-2xl font-semibold">{value}</dd>
      {hint ? <p className="text-xs text-fg-secondary">{hint}</p> : null}
    </div>
  );
}

export default async function SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getSessionUserId();
  const inv = userId ? await getInvestigation(userId, id) : null;
  if (!inv) notFound();
  const { summary } = inv;
  const stats = summary.stats;
  const empty = summary.markdown.trim().length === 0;
  const fallback = inv.summaryKind !== null && inv.summaryKind !== "ai";
  const types = Object.entries(summary.entityCounts).sort((a, b) => b[1] - a[1]);
  const maxCount = types[0]?.[1] ?? 1;

  return (
    <div className="flex flex-col gap-6">
      {fallback || empty ? (
        <div
          role="note"
          className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning"
        >
          {empty
            ? "The AI summary is empty for this run. The entities, graph and sources below are still complete."
            : "This is a fallback summary: the AI step couldn't finish, so this text was assembled from the extracted findings. The entities, graph and sources are unaffected."}
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6" aria-label="Run statistics">
        <Stat label="Entities" value={stats?.entities ?? 0} />
        <Stat label="Actors" value={stats?.actors ?? 0} />
        <Stat label="Sources" value={summary.sourceCount} />
        <Stat
          label="Relationships"
          value={stats?.relationships ?? 0}
          hint={`${stats?.typedRelationships ?? 0} typed (leads)`}
        />
        <Stat label="Duration" value={stats ? formatDuration(stats.durationMs) : "n/a"} />
        <Stat label="Confidence" value={summary.confidence} hint={`from ${summary.sourceCount} sources`} />
      </dl>

      <ArchivePanel investigationId={id} />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-6">
          {summary.keyFindings.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Key findings</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-2 pl-5 text-sm marker:text-accent">
                  {summary.keyFindings.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
          {summary.riskNotes.length > 0 ? (
            <Card className="border-warning/30">
              <CardHeader>
                <CardTitle>Risk notes</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-disc space-y-2 pl-5 text-sm marker:text-warning">
                  {summary.riskNotes.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
          {!empty ? (
            <Card>
              <CardHeader>
                <CardTitle>Intelligence summary</CardTitle>
              </CardHeader>
              <CardContent data-testid="summary-markdown">
                <SafeMarkdown>{summary.markdown}</SafeMarkdown>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Entities by type</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {types.map(([type, n]) => (
                <li key={type}>
                  <Link
                    href={`/investigations/${id}/results/entities?types=${encodeURIComponent(type)}`}
                    className="group flex flex-col gap-1 rounded px-1 py-1 hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <TypeBadge type={type} />
                      <span className="font-mono text-sm">{n}</span>
                    </span>
                    <span aria-hidden className="h-1 rounded bg-raised">
                      <span
                        className="block h-1 rounded bg-accent/60"
                        style={{ width: `${Math.max(3, (n / maxCount) * 100)}%` }}
                      />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {stats && stats.sensitiveEntities > 0 ? (
              <p className="mt-4 text-xs text-fg-secondary">
                <Badge variant="warning">{stats.sensitiveEntities} masked</Badge> Credentials and personal
                data are masked everywhere.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
