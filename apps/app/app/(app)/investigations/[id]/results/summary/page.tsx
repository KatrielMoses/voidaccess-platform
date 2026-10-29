import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUserId } from "@/lib/dev-session";
import { formatDuration } from "@/lib/results/format";
import { getInvestigation } from "@/lib/results/queries";
import { InlineMarkdown, SafeMarkdown, stripLeadingTitle } from "@/components/results/markdown";
import { TypeBadge } from "@/components/results/type-badge";
import { ArchivePanel } from "@/components/results/archive-panel";
import { MaskedMark } from "@/components/results/ui";
import { StarPrompt } from "@/components/results/star-prompt";
import { RelevancePanel } from "@/components/results/relevance";
import { starPromptVisible } from "@/lib/ops/star-prompt";
import { GITHUB_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

/** A meter (design.md §6 pipeline meters): mono label, Geist Mono value with tabular numerals. */
function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="flex flex-col gap-3 bg-bg px-5 py-5">
      <dt className="font-mono text-[12px] text-mute">{label}</dt>
      <dd className="font-mono text-[24px] leading-none tracking-[-0.04em] text-paper tabular-nums sm:text-[28px]">
        {value}
      </dd>
      {hint ? <p className="-mt-1 font-mono text-[12px] text-mute">{hint}</p> : null}
    </div>
  );
}

function Notes({ title, items, mark }: { title: string; items: string[]; mark?: string }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-[22px] leading-tight font-medium tracking-[-0.025em]">{title}</h2>
      <ol className="flex flex-col divide-y divide-line border-y border-line">
        {items.map((f, i) => (
          <li
            key={i}
            className="grid grid-cols-[2.5rem_1fr] gap-2 py-3.5 text-[16px] leading-[1.55] text-paper"
          >
            <span className="pt-[3px] font-mono text-[12px] text-mute tabular-nums">
              {mark ?? String(i + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <InlineMarkdown>{f}</InlineMarkdown>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default async function SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getSessionUserId();
  const inv = userId ? await getInvestigation(userId, id) : null;
  if (!inv) notFound();
  const { summary } = inv;
  // PRD §3.9: after a successful investigation, one dismissible prompt (never a banner), remembered per user.
  // Shown on the Summary tab only, never over the graph.
  const showStar = inv.status === "completed" && (await starPromptVisible(userId!));
  const stats = summary.stats;
  // the page has its own "Intelligence summary" heading, so a leading duplicate in the body is dropped
  const body = stripLeadingTitle(summary.markdown);
  const empty = body.trim().length === 0;
  // summary_kind is set at ingest: llm | fallback | none (legacy seed rows: "ai"). Only a real fallback gets the notice.
  const fallback = inv.summaryKind === "fallback";
  const types = Object.entries(summary.entityCounts).sort((a, b) => b[1] - a[1]);
  const maxCount = types[0]?.[1] ?? 1;

  return (
    <div className="flex flex-col gap-12">
      {showStar ? <StarPrompt href={GITHUB_URL} /> : null}
      {fallback || empty ? (
        <div role="note" className="border-l border-line-3 pl-4 text-[15px] text-dim">
          <span className="font-medium text-paper">Note. </span>
          {empty
            ? "The AI summary is empty for this run. The entities, graph and sources below are still complete."
            : "This is a fallback summary: the AI step couldn't finish, so this text was assembled from the extracted findings. The entities, graph and sources are unaffected."}
        </div>
      ) : null}

      <dl
        className="grid grid-cols-2 gap-px border border-line bg-line md:grid-cols-3 lg:grid-cols-6"
        aria-label="Run statistics"
      >
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

      {inv.relevance ? <RelevancePanel id={id} relevance={inv.relevance} /> : null}

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-16">
        <div className="flex min-w-0 flex-col gap-12">
          {summary.keyFindings.length > 0 ? <Notes title="Key findings" items={summary.keyFindings} /> : null}
          {summary.riskNotes.length > 0 ? (
            <Notes title="Risk notes" items={summary.riskNotes} mark="▲" />
          ) : null}
          {!empty ? (
            <section className="flex flex-col gap-5">
              <h2 className="text-[22px] leading-tight font-medium tracking-[-0.025em]">
                Intelligence summary
              </h2>
              <div data-testid="summary-markdown" className="border-t border-line pt-6">
                <SafeMarkdown>{body}</SafeMarkdown>
              </div>
            </section>
          ) : null}
        </div>

        <aside aria-labelledby="by-type" className="flex h-fit flex-col gap-4">
          <h2 id="by-type" className="text-[17px] font-medium tracking-[-0.015em]">
            Entities by type
          </h2>
          <ul className="flex flex-col">
            {types.map(([type, n]) => (
              <li key={type}>
                <Link
                  href={`/investigations/${id}/results/entities?types=${encodeURIComponent(type)}`}
                  className="group flex flex-col gap-2 py-2.5 transition-colors duration-300 hover:bg-bg-2"
                >
                  <span className="flex items-center justify-between gap-2 px-1">
                    <TypeBadge type={type} className="group-hover:text-paper" />
                    <span className="font-mono text-[13px] text-paper tabular-nums">{n}</span>
                  </span>
                  <span aria-hidden className="mx-1 block h-px bg-line">
                    <span
                      className="block h-px bg-paper/60"
                      style={{ width: `${Math.max(3, (n / maxCount) * 100)}%` }}
                    />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {stats && stats.sensitiveEntities > 0 ? (
            <p className="flex flex-col items-start gap-2 text-[13px] text-dim">
              <MaskedMark />
              <span>
                <span className="font-mono text-paper tabular-nums">{stats.sensitiveEntities}</span> values
                are masked. Credentials and personal data are masked everywhere.
              </span>
            </p>
          ) : null}
        </aside>
      </div>

      <ArchivePanel investigationId={id} />
    </div>
  );
}
