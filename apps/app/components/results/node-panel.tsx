"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@voidaccess/ui";
import { edgeKindLabel, typeLabel } from "@/lib/results/entity-style";
import { formatDate } from "@/lib/results/format";
import { neighborsByType } from "@/lib/results/graph-model";
import type { GraphData } from "@/lib/results/types";
import { CopyButton, CopyOnlyUrl } from "./copy-text";
import { useEntityDetail } from "./entity-detail";
import { TypeBadge } from "./type-badge";

export function NodePanel({
  invId,
  data,
  nodeId,
  onSelect,
  onClose,
}: {
  invId: string;
  data: GraphData;
  nodeId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const node = useMemo(() => data.nodes.find((n) => n[0] === nodeId), [data, nodeId]);
  const groups = useMemo(
    () => [...neighborsByType(data, nodeId)].sort((a, b) => b[1].length - a[1].length),
    [data, nodeId],
  );
  const { detail } = useEntityDetail(invId, nodeId);
  if (!node) return null;
  const [, type, label, confidence, degree, , sensitive] = node;
  return (
    <aside
      aria-label="Node details"
      data-testid="node-panel"
      className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto rounded-lg border border-border-subtle bg-surface p-4 text-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display text-base font-semibold">Node details</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close node details"
          className="text-fg-secondary hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
        >
          ✕
        </button>
      </div>
      <div className="flex items-start gap-2">
        <code
          className="min-w-0 flex-1 rounded bg-void px-2 py-1.5 font-mono text-xs break-all"
          data-testid="node-value"
        >
          {label}
        </code>
        <CopyButton text={label} label={sensitive ? "Copy masked value" : "Copy value"} />
      </div>
      {sensitive ? <Badge variant="warning">masked</Badge> : null}
      <dl className="grid grid-cols-2 gap-2">
        <div>
          <dt className="text-xs text-fg-secondary">Type</dt>
          <dd>
            <TypeBadge type={type} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-secondary">Confidence</dt>
          <dd className="font-mono">{confidence.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-secondary">First seen</dt>
          <dd>{detail ? formatDate(detail.firstSeen) : "…"}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-secondary">Connections</dt>
          <dd className="font-mono">{degree}</dd>
        </div>
      </dl>
      {detail && detail.tags.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
          {detail.tags.map((t) => (
            <li key={t}>
              <Badge>{t}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
      <section>
        <h4 className="mb-1.5 font-medium">Connected nodes</h4>
        {groups.length === 0 ? (
          <p className="text-fg-secondary">No connections.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {groups.map(([t, list]) => (
              <div key={t}>
                <p className="mb-1 text-xs text-fg-secondary">
                  {typeLabel(t)} <span className="font-mono">{list.length}</span>
                </p>
                <ul className="flex flex-col gap-1">
                  {list.slice(0, 12).map((n) => (
                    <li key={n.id + n.edgeType} className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onSelect(n.id)}
                        className="min-w-0 truncate text-left font-mono text-xs text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                      >
                        {n.label}
                      </button>
                      <span className="shrink-0 text-[10px] text-fg-muted">{edgeKindLabel(n.edgeType)}</span>
                    </li>
                  ))}
                  {list.length > 12 ? (
                    <li className="text-xs text-fg-secondary">…and {list.length - 12} more</li>
                  ) : null}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
      <section>
        <h4 className="mb-1.5 font-medium">Sources{detail ? ` (${detail.sources.length})` : ""}</h4>
        {!detail ? (
          <p className="text-fg-secondary">Loading…</p>
        ) : detail.sources.length === 0 ? (
          <p className="text-fg-secondary">None recorded.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {detail.sources.slice(0, 5).map((s) => (
              <li key={s.bundleId} className="rounded border border-border-dim p-2">
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
      <Link
        href={`/investigations/${invId}/results/entities?focus=${encodeURIComponent(nodeId)}`}
        className="text-accent underline-offset-2 hover:underline"
      >
        Open in Entities tab
      </Link>
    </aside>
  );
}
