"use client";

import { useEffect, useState } from "react";
import type { ArchiveContext } from "@voidaccess/archive";
import { Skeleton } from "@voidaccess/ui";
import { archiveCopy as copy, fillArchive as fill } from "@/lib/archive/copy";
import { formatDate } from "@/lib/results/format";
import { CopyOnlyUrl } from "./copy-text";
import { TierBadge } from "./tier-badge";
import { TypeBadge } from "./type-badge";
import { H, InfoTip, RULED } from "./ui";

/** The archive's view of an investigation (or of one entity, in the drawer). All text is escaped; source URLs are copy-only. */
export function ArchivePanel({
  investigationId,
  entityKey,
  compact = false,
}: {
  investigationId: string;
  entityKey?: string;
  compact?: boolean;
}) {
  const [state, setState] = useState<{ key: string; ctx: ArchiveContext | null; error: boolean } | null>(
    null,
  );
  const key = `${investigationId}/${entityKey ?? ""}`;
  useEffect(() => {
    let cancelled = false;
    const q = entityKey ? `?entity=${encodeURIComponent(entityKey)}` : "";
    fetch(`/api/investigations/${investigationId}/archive${q}`)
      .then((r) =>
        r.ok ? (r.json() as Promise<ArchiveContext>) : Promise.reject(new Error(String(r.status))),
      )
      .then((ctx) => !cancelled && setState({ key, ctx, error: false }))
      .catch(() => !cancelled && setState({ key, ctx: null, error: true }));
    return () => {
      cancelled = true;
    };
  }, [investigationId, entityKey, key]);
  const cur = state?.key === key ? state : null;

  const wrap = (children: React.ReactNode) =>
    compact ? (
      <section
        aria-labelledby="arc-h"
        className="flex flex-col gap-3 text-[14px]"
        data-testid="archive-panel"
      >
        <h3 id="arc-h" className={H}>
          {copy.title}
        </h3>
        {children}
      </section>
    ) : (
      <section
        aria-labelledby="arc-h"
        className="grid gap-x-10 gap-y-5 border-t border-line pt-6 lg:grid-cols-[minmax(0,20rem)_1fr]"
        data-testid="archive-panel"
      >
        <div className="flex flex-col gap-2">
          <h2 id="arc-h" className="text-[22px] leading-tight font-medium tracking-[-0.02em]">
            {copy.title}
          </h2>
          <p className="text-[14px] text-dim">{copy.intro}</p>
        </div>
        <div className="flex min-w-0 flex-col gap-6 text-[14px]">{children}</div>
      </section>
    );

  if (!cur) return wrap(<Skeleton className="h-24" />);
  if (cur.error || !cur.ctx) return wrap(<p className="text-paper">Couldn&apos;t load archive context.</p>);
  const ctx = cur.ctx;
  const seen = Object.entries(ctx.seen).sort(
    (a, b) => b[1].independentSources - a[1].independentSources || b[1].observations - a[1].observations,
  );
  const nothing = seen.length === 0 && ctx.neighbours.length === 0 && ctx.offline.length === 0;
  if (nothing) return wrap(<p className="text-dim">{copy.empty}</p>);

  return wrap(
    <>
      {!entityKey ? (
        <p data-testid="archive-summary" className="text-[16px] leading-relaxed text-paper">
          {fill(copy.seenSummary, {
            seen: ctx.totals.seenBefore,
            total: ctx.totals.entities,
            fresh: ctx.totals.newToArchive,
          })}
        </p>
      ) : null}

      {seen.length > 0 ? (
        <div>
          <h4 className={`${H} mb-2`}>{copy.seenHeading}</h4>
          <ul className={RULED} data-testid="archive-seen">
            {seen.slice(0, compact ? 3 : 8).map(([k, s]) => (
              <li key={k} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2.5">
                <span
                  className="min-w-0 max-w-full truncate font-mono text-[13px] text-paper"
                  title={s.display}
                >
                  {s.display}
                </span>
                <TypeBadge type={s.type} />
                <TierBadge tier={s.tier} />
                <span className="text-[13px] text-dim tabular-nums">
                  {formatDate(s.firstSeen)} to {formatDate(s.lastSeen)} · {s.independentSources} independent{" "}
                  {s.independentSources === 1 ? "site" : "sites"} · {s.observations}{" "}
                  {s.observations === 1 ? "sighting" : "sightings"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {ctx.neighbours.length > 0 ? (
        <div>
          <h4 className={`${H} mb-1 flex items-center gap-2`}>
            {copy.neighboursHeading}
            <InfoTip content={copy.neighboursNote} label="About these leads" />
          </h4>
          <p className="mb-2 text-[13px] text-dim">{copy.neighboursNote}</p>
          <ul className={RULED} data-testid="archive-neighbours">
            {ctx.neighbours.slice(0, compact ? 4 : 10).map((n) => (
              <li key={n.archiveId} className="py-2.5" data-testid="archive-neighbour">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <span className="min-w-0 truncate font-mono text-[13px] text-paper" title={n.display}>
                    {n.display}
                  </span>
                  <TypeBadge type={n.type} />
                  <TierBadge tier={n.relationship.tier} />
                </div>
                <p className="mt-1 text-[13px] text-dim">
                  {n.relationship.type === "CO_APPEARED_ON"
                    ? "co-occurrence"
                    : `typed (lead): ${n.relationship.type.toLowerCase().replaceAll("_", " ")}`}{" "}
                  · {n.relationship.evidence} {n.relationship.evidence === 1 ? "page" : "pages"} ·{" "}
                  {n.relationship.independentSources} independent{" "}
                  {n.relationship.independentSources === 1 ? "site" : "sites"} ·{" "}
                  {formatDate(n.relationship.firstSeen)} to {formatDate(n.relationship.lastSeen)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {ctx.offline.length > 0 ? (
        <div>
          <h4 className={`${H} mb-2`}>{copy.offlineHeading}</h4>
          <ul className={RULED} data-testid="archive-offline">
            {ctx.offline.slice(0, compact ? 2 : 6).map((o) => (
              <li key={o.url} className="py-3" data-testid="archive-offline-item">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="inline-flex items-center gap-1.5 font-mono text-[12px] text-paper">
                    <span aria-hidden className="size-2 rounded-full border border-current" />
                    {fill(copy.offlineLine, { date: formatDate(o.lastAlive) })}
                  </span>
                  <span className="text-[13px] text-dim">
                    {fill(copy.lastSeenMention, { date: formatDate(o.lastSeen) })}
                  </span>
                </p>
                {o.excerpt ? (
                  <p className="mt-1.5 text-[13px] whitespace-pre-wrap text-dim">{o.excerpt}</p>
                ) : null}
                <div className="mt-2">
                  <CopyOnlyUrl url={o.url} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>,
  );
}
