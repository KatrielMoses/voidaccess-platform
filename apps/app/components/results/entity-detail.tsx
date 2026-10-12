"use client";

import { useEffect, useState } from "react";
import { Badge, Skeleton, Tooltip } from "@voidaccess/ui";
import { EDGE_DISCLAIMER, edgeKindLabel, edgeTypeLabel } from "@/lib/results/entity-style";
import { formatDate } from "@/lib/results/format";
import type { EntityDetail, RelationshipView } from "@/lib/results/types";
import { ArchivePanel } from "./archive-panel";
import { CopyButton, CopyOnlyUrl } from "./copy-text";
import { TypeBadge } from "./type-badge";

export function useEntityDetail(invId: string, bundleId: string | null) {
  const [state, setState] = useState<{ key: string; data: EntityDetail | null; error: boolean } | null>(null);
  useEffect(() => {
    if (!bundleId) return;
    const key = `${invId}/${bundleId}`;
    let cancelled = false;
    fetch(`/api/investigations/${invId}/entities/${encodeURIComponent(bundleId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<EntityDetail>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => !cancelled && setState({ key, data, error: false }))
      .catch(() => !cancelled && setState({ key, data: null, error: true }));
    return () => {
      cancelled = true;
    };
  }, [invId, bundleId]);
  const current = bundleId && state?.key === `${invId}/${bundleId}` ? state : null;
  return {
    detail: current?.data ?? null,
    loading: Boolean(bundleId) && !current,
    error: current?.error ?? false,
  };
}

function groupRelationships(rels: RelationshipView[]) {
  const m = new Map<string, RelationshipView[]>();
  for (const r of rels) m.set(r.type, [...(m.get(r.type) ?? []), r]);
  return [...m].sort((a, b) => b[1].length - a[1].length);
}

export function EntityDetailView({
  invId,
  bundleId,
  onOpenEntity,
}: {
  invId: string;
  bundleId: string;
  onOpenEntity?: (bundleId: string) => void;
}) {
  const { detail, loading, error } = useEntityDetail(invId, bundleId);
  if (loading)
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-20" />
        <Skeleton className="h-32" />
      </div>
    );
  if (error || !detail) return <p className="text-sm text-danger">Couldn&apos;t load this entity.</p>;

  return (
    <div className="flex flex-col gap-5 text-sm" data-testid="entity-detail">
      <section className="flex flex-col gap-2">
        <div className="flex items-start gap-2">
          <code
            className="min-w-0 flex-1 rounded bg-void px-2 py-1.5 font-mono text-sm break-all"
            data-testid="entity-value"
          >
            {detail.displayValue}
          </code>
          <CopyButton
            text={detail.displayValue}
            label={detail.sensitive ? "Copy masked value" : "Copy value"}
          />
        </div>
        {detail.sensitive ? (
          <p className="text-xs text-warning">
            Masked: the raw value is stored encrypted and is never shown here.
          </p>
        ) : null}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
          <div>
            <dt className="text-xs text-fg-secondary">Type</dt>
            <dd>
              <TypeBadge type={detail.type} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-secondary">Confidence</dt>
            <dd className="font-mono">{detail.confidence.toFixed(2)}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-secondary">First seen</dt>
            <dd>{formatDate(detail.firstSeen, true)}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-secondary">Connections</dt>
            <dd className="font-mono">{detail.degree}</dd>
          </div>
        </dl>
        {detail.tags.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
            {detail.tags.map((t) => (
              <li key={t}>
                <Badge>{t}</Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {detail.actors.length > 0 ? (
        <section>
          <h3 className="mb-1.5 font-medium">Belongs to actors</h3>
          <ul className="flex flex-wrap gap-1.5">
            {detail.actors.map((a) => (
              <li key={a.bundleId}>
                <Badge variant="actor">{a.handle}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className="mb-1.5 flex items-center gap-2 font-medium">
          Relationships
          <Tooltip content={EDGE_DISCLAIMER}>
            <button
              type="button"
              aria-label="About relationships"
              className="flex size-5 items-center justify-center rounded-full border border-border-strong text-xs text-fg-secondary"
            >
              i
            </button>
          </Tooltip>
        </h3>
        {detail.relationships.length === 0 ? (
          <p className="text-fg-secondary">No relationships recorded.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {groupRelationships(detail.relationships).map(([type, list]) => (
              <div key={type}>
                <p className="mb-1 flex items-center gap-2 text-xs text-fg-secondary">
                  <span className="font-medium tracking-wide uppercase">{edgeTypeLabel(type)}</span>
                  <Badge variant={type === "CO_APPEARED_ON" ? "neutral" : "accent"}>
                    {edgeKindLabel(type)}
                  </Badge>
                  <span className="font-mono">{list.length}</span>
                </p>
                <ul className="flex flex-col gap-1.5">
                  {list.slice(0, 25).map((r, i) => (
                    <li
                      key={`${r.other.bundleId}-${i}`}
                      className="rounded border border-border-dim bg-surface px-2.5 py-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        {onOpenEntity ? (
                          <button
                            type="button"
                            onClick={() => onOpenEntity(r.other.bundleId)}
                            className="min-w-0 truncate text-left font-mono text-xs text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                          >
                            {r.other.displayValue}
                          </button>
                        ) : (
                          <span className="min-w-0 truncate font-mono text-xs">{r.other.displayValue}</span>
                        )}
                        <TypeBadge type={r.other.type} />
                      </div>
                      {r.evidence.length > 0 ? (
                        <p className="mt-1 text-xs text-fg-secondary">
                          Evidence: {r.evidence.map((e) => e.name).join(", ")}
                        </p>
                      ) : null}
                    </li>
                  ))}
                  {list.length > 25 ? (
                    <li className="text-xs text-fg-secondary">…and {list.length - 25} more</li>
                  ) : null}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <ArchivePanel investigationId={invId} entityKey={bundleId} compact />

      <section>
        <h3 className="mb-1.5 font-medium">Sources ({detail.sources.length})</h3>
        {detail.sources.length === 0 ? (
          <p className="text-fg-secondary">No sources recorded.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.sources.map((s) => (
              <li key={s.bundleId} className="rounded border border-border-dim bg-surface p-2.5">
                <p className="font-medium">{s.name}</p>
                {s.excerpt ? (
                  <p className="mt-1 text-xs whitespace-pre-wrap text-fg-secondary">{s.excerpt}</p>
                ) : null}
                {s.url ? (
                  <div className="mt-2">
                    <CopyOnlyUrl url={s.url} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
