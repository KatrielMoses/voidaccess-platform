"use client";

import { useEffect, useState } from "react";
import { Skeleton } from "@voidaccess/ui";
import { EDGE_DISCLAIMER, edgeKindLabel, edgeTypeLabel } from "@/lib/results/entity-style";
import { formatDate } from "@/lib/results/format";
import type { EntityDetail, RelationshipView } from "@/lib/results/types";
import { ArchivePanel } from "./archive-panel";
import { CopyButton, CopyOnlyUrl } from "./copy-text";
import { TypeBadge } from "./type-badge";
import { TypeGlyph } from "./type-glyph";
import { Field, H, InfoTip, MaskedMark, RULED, VALUE_LINK } from "./ui";

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
  if (error || !detail) return <p className="text-[15px] text-paper">Couldn&apos;t load this entity.</p>;

  return (
    <div className="flex flex-col gap-7 text-[14px]" data-testid="entity-detail">
      <section className="flex flex-col gap-3">
        <TypeBadge type={detail.type} />
        <div className="flex items-start gap-2">
          <code
            className="min-w-0 flex-1 font-mono text-[16px] leading-snug break-all text-v-200"
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
          <p className="flex items-center gap-2 text-[13px] text-dim">
            <MaskedMark />
            Masked: the raw value is stored encrypted and is never shown here.
          </p>
        ) : null}
        <dl className="mt-1 grid grid-cols-3 gap-x-4 border-y border-line py-4">
          <Field label="Confidence" mono>
            {detail.confidence.toFixed(2)}
          </Field>
          <Field label="Connections" mono>
            {detail.degree}
          </Field>
          <Field label="First seen">{formatDate(detail.firstSeen, true)}</Field>
        </dl>
        {detail.tags.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
            {detail.tags.map((t) => (
              <li
                key={t}
                className="rounded-xs border border-line px-1.5 py-1 font-mono text-[12px] leading-none text-dim"
              >
                {t}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {detail.actors.length > 0 ? (
        <section className="flex flex-col gap-2.5">
          <h3 className={H}>Belongs to actors</h3>
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
            {detail.actors.map((a) => (
              <li key={a.bundleId} className="flex items-center gap-1.5 font-mono text-[13px] text-paper">
                <TypeGlyph type="THREAT_ACTOR" className="text-paper/80" />
                {a.handle}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h3 className={`${H} flex items-center gap-2`}>
          Relationships
          <InfoTip content={EDGE_DISCLAIMER} label="About relationships" />
        </h3>
        {detail.relationships.length === 0 ? (
          <p className="text-dim">No relationships recorded.</p>
        ) : (
          <div className="flex flex-col gap-5">
            {groupRelationships(detail.relationships).map(([type, list]) => (
              <div key={type}>
                <p className="mb-1.5 flex items-center gap-2 font-mono text-[12px] text-mute">
                  <span className="text-dim">{edgeTypeLabel(type)}</span>
                  {edgeKindLabel(type) !== edgeTypeLabel(type) ? (
                    <>
                      <span aria-hidden>·</span>
                      <span>{edgeKindLabel(type)}</span>
                    </>
                  ) : null}
                  <span className="ml-auto tabular-nums">{list.length}</span>
                </p>
                <ul className={RULED}>
                  {list.slice(0, 25).map((r, i) => (
                    <li key={`${r.other.bundleId}-${i}`} className="py-2">
                      <div className="flex items-center justify-between gap-3">
                        {onOpenEntity ? (
                          <button
                            type="button"
                            onClick={() => onOpenEntity(r.other.bundleId)}
                            className={VALUE_LINK}
                          >
                            {r.other.displayValue}
                          </button>
                        ) : (
                          <span className="min-w-0 truncate font-mono text-[13px] text-paper">
                            {r.other.displayValue}
                          </span>
                        )}
                        <TypeBadge type={r.other.type} className="shrink-0" />
                      </div>
                      {r.evidence.length > 0 ? (
                        <p className="mt-1 text-[13px] text-dim">
                          Evidence: {r.evidence.map((e) => e.name).join(", ")}
                        </p>
                      ) : null}
                    </li>
                  ))}
                  {list.length > 25 ? (
                    <li className="py-2 text-[13px] text-dim">…and {list.length - 25} more</li>
                  ) : null}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <ArchivePanel investigationId={invId} entityKey={bundleId} compact />

      <section className="flex flex-col gap-3">
        <h3 className={H}>
          Sources{" "}
          <span className="font-mono text-[12px] text-mute tabular-nums">{detail.sources.length}</span>
        </h3>
        {detail.sources.length === 0 ? (
          <p className="text-dim">No sources recorded.</p>
        ) : (
          <ul className={RULED}>
            {detail.sources.map((s) => (
              <li key={s.bundleId} className="py-3">
                <p className="font-medium text-paper">{s.name}</p>
                {s.excerpt ? (
                  <p className="mt-1 text-[13px] whitespace-pre-wrap text-dim">{s.excerpt}</p>
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
