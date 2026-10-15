"use client";

import Link from "next/link";
import { useMemo } from "react";
import { edgeKindLabel } from "@/lib/results/entity-style";
import { formatDate } from "@/lib/results/format";
import { neighborsByType } from "@/lib/results/graph-model";
import type { GraphData } from "@/lib/results/types";
import { CopyButton, CopyOnlyUrl } from "./copy-text";
import { useEntityDetail } from "./entity-detail";
import { TypeBadge } from "./type-badge";
import { CloseButton, Field, H, MaskedMark, RULED, UL, VALUE_LINK } from "./ui";

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
      className="flex max-h-[min(65vh,42rem)] flex-col gap-5 overflow-y-auto p-5 text-[14px] lg:max-h-[calc(min(65vh,42rem)+3rem)]"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-mono text-[12px] text-mute">Node details</h3>
        <CloseButton onClick={onClose} label="Close node details" />
      </div>
      <div className="flex flex-col gap-3">
        <TypeBadge type={type} />
        <div className="flex items-start gap-2">
          <code
            className="min-w-0 flex-1 font-mono text-[15px] leading-snug break-all text-v-200"
            data-testid="node-value"
          >
            {label}
          </code>
          <CopyButton text={label} label={sensitive ? "Copy masked value" : "Copy value"} />
        </div>
        {sensitive ? (
          <p>
            <MaskedMark />
          </p>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-y border-line py-4">
        <Field label="Confidence" mono>
          {confidence.toFixed(2)}
        </Field>
        <Field label="Connections" mono>
          {degree}
        </Field>
        <Field label="First seen" className="col-span-2">
          {detail ? formatDate(detail.firstSeen) : "…"}
        </Field>
      </dl>
      {detail && detail.tags.length > 0 ? (
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
      <section className="flex flex-col gap-3">
        <h4 className={H}>Connected nodes</h4>
        {groups.length === 0 ? (
          <p className="text-dim">No connections.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map(([t, list]) => (
              <div key={t}>
                <p className="mb-1.5 flex items-center justify-between font-mono text-[12px] text-mute">
                  <TypeBadge type={t} className="text-mute" />
                  <span className="tabular-nums">{list.length}</span>
                </p>
                <ul className={RULED}>
                  {list.slice(0, 12).map((n) => (
                    <li key={n.id + n.edgeType} className="flex items-center justify-between gap-2 py-1.5">
                      <button type="button" onClick={() => onSelect(n.id)} className={VALUE_LINK}>
                        {n.label}
                      </button>
                      <span className="shrink-0 font-mono text-[11px] text-mute">
                        {edgeKindLabel(n.edgeType)}
                      </span>
                    </li>
                  ))}
                  {list.length > 12 ? (
                    <li className="py-1.5 text-[13px] text-dim">…and {list.length - 12} more</li>
                  ) : null}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <h4 className={H}>
          Sources{" "}
          {detail ? (
            <span className="font-mono text-[12px] text-mute tabular-nums">{detail.sources.length}</span>
          ) : null}
        </h4>
        {!detail ? (
          <p className="text-dim">Loading…</p>
        ) : detail.sources.length === 0 ? (
          <p className="text-dim">None recorded.</p>
        ) : (
          <ul className={RULED}>
            {detail.sources.slice(0, 5).map((s) => (
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
      <Link
        href={`/investigations/${invId}/results/entities?focus=${encodeURIComponent(nodeId)}`}
        className={`${UL} self-start`}
      >
        Open in Entities tab <span aria-hidden>→</span>
      </Link>
    </aside>
  );
}
