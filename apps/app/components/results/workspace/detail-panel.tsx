"use client";
import Link from "next/link";
import { useMemo } from "react";
import { cn } from "@voidaccess/ui";
import { archiveCopy } from "@/lib/archive/copy";
import { GROUPS, GROUP_LABEL, groupOf, groupShape, type GroupId } from "@/lib/results/categories";
import { edgeKindLabel, typeLabel } from "@/lib/results/entity-style";
import { formatDate } from "@/lib/results/format";
import { neighborsByType } from "@/lib/results/graph-model";
import { middleTruncate } from "@/lib/results/search";
import type { GraphData } from "@/lib/results/types";
import { CopyButton, CopyOnlyUrl } from "../copy-text";
import { useEntityDetail } from "../entity-detail";
import { TierBadge } from "../tier-badge";
import { ShapeGlyph, TypeGlyph } from "../type-glyph";
import { CloseButton, MaskedMark } from "../ui";
import { IconBack } from "./icons";

export interface ArchiveNeighbour {
  id: string;
  label: string;
  type: string;
  tier: "unconfirmed" | "corroborated" | "feed_validated";
}

const PER_GROUP = 8;

/**
 * The floating detail panel (P9-5): the selected value (masked, copy-only), its facts, sources (copy-only text) and
 * connections grouped by category, each one a step of the trail. Nothing here links to a found value.
 */
export function DetailPanel({
  invId,
  data,
  nodeId,
  trail,
  labelOf,
  onStep,
  onTrail,
  onClose,
  archive,
  mobile,
}: {
  invId: string;
  data: GraphData;
  nodeId: string;
  trail: string[];
  labelOf: (id: string) => string;
  /** follow a connection (extends the trail) */
  onStep: (id: string) => void;
  /** jump back to a trail entry */
  onTrail: (index: number) => void;
  onClose: () => void;
  archive: ArchiveNeighbour[] | null;
  mobile: boolean;
}) {
  const node = useMemo(() => data.nodes.find((n) => n[0] === nodeId), [data, nodeId]);
  const groups = useMemo(() => {
    const m = new Map<GroupId, { id: string; label: string; edgeType: string; type: string }[]>();
    const seen = new Set<string>(); // one row per neighbour, even with several edges to it
    for (const [type, list] of neighborsByType(data, nodeId))
      for (const n of list) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        const g = groupOf(type);
        if (!m.has(g)) m.set(g, []);
        m.get(g)!.push({ ...n, type });
      }
    return GROUPS.filter((g) => m.has(g.id)).map((g) => [g.id, m.get(g.id)!] as const);
  }, [data, nodeId]);
  const { detail } = useEntityDetail(invId, nodeId);
  if (!node) return null;
  const [, type, label, confidence, degree, , sensitive] = node;

  return (
    <aside
      aria-label="Selected value"
      data-testid="node-panel"
      className={cn(
        "pointer-events-auto absolute z-30 flex flex-col overflow-hidden border border-line bg-bg-2",
        mobile
          ? "inset-x-0 bottom-0 max-h-[68%] rounded-t-md border-b-0 shadow-[0_-8px_24px_rgba(0,0,0,0.3)]"
          : "top-4 right-4 bottom-4 w-[360px] rounded-md shadow-[0_8px_24px_rgba(0,0,0,0.28)]",
      )}
    >
      <header className="flex shrink-0 items-start gap-2 border-b border-dashed border-line-2 px-3.5 py-2.5">
        <nav aria-label="Trail" className="min-w-0 flex-1" data-testid="trail">
          <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[11.5px] leading-5">
            {trail.length > 1 ? (
              <li>
                <button
                  type="button"
                  onClick={() => onTrail(trail.length - 2)}
                  aria-label="Back to the previous value"
                  className="flex size-5 items-center justify-center rounded-xs text-mute hover:text-paper"
                  data-testid="trail-back"
                >
                  <IconBack />
                </button>
              </li>
            ) : null}
            {trail.map((id, i) => (
              <li key={`${id}-${i}`} className="flex min-w-0 items-center gap-1.5">
                {i > 0 ? (
                  <span aria-hidden className="text-mute">
                    →
                  </span>
                ) : null}
                {i === trail.length - 1 ? (
                  <span aria-current="location" className="truncate text-paper">
                    {middleTruncate(labelOf(id), 22)}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onTrail(i)}
                    className="truncate text-dim underline decoration-line-3 underline-offset-2 hover:text-paper"
                  >
                    {middleTruncate(labelOf(id), 18)}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </nav>
        <CloseButton onClick={onClose} label="Close the selected value" />
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain p-4 text-[14px] [&>*]:shrink-0">
        <div className="flex flex-col gap-2.5">
          <p className="flex items-center gap-2 font-mono text-[12px] text-dim">
            <TypeGlyph type={type} />
            {typeLabel(type)}
            {sensitive ? <MaskedMark /> : null}
          </p>
          <div className="flex items-start gap-2">
            <code
              className="min-w-0 flex-1 font-mono text-[15px] leading-snug break-all text-v-200"
              data-testid="node-value"
            >
              {label}
            </code>
            <CopyButton text={label} label={sensitive ? "Copy masked value" : "Copy value"} />
          </div>
        </div>

        <dl className="grid grid-cols-[0.85fr_0.95fr_1.3fr] gap-px overflow-hidden rounded-sm border border-line bg-line">
          {[
            ["Confidence", confidence.toFixed(2)],
            ["Connections", String(degree)],
            ["First seen", detail ? formatDate(detail.firstSeen) : "…"],
          ].map(([k, v]) => (
            <div key={k} className="flex flex-col gap-1.5 bg-bg-2 px-3 py-2.5">
              <dt className="font-mono text-[11px] text-mute">{k}</dt>
              <dd className="truncate font-mono text-[13px] text-paper tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>

        <section className="flex flex-col gap-3" aria-labelledby="conn-h">
          <h3 id="conn-h" className="text-[14px] font-medium text-paper">
            Connections{" "}
            <span className="font-mono text-[12px] font-normal text-mute tabular-nums">{degree}</span>
          </h3>
          {groups.length === 0 ? <p className="text-dim">No connections.</p> : null}
          {groups.map(([g, list]) => (
            <div key={g} className="flex flex-col">
              <p className="mb-1 flex items-center gap-2 font-mono text-[11.5px] text-mute">
                <ShapeGlyph shape={groupShape(g)} />
                <span className="flex-1">{GROUP_LABEL[g]}</span>
                <span className="tabular-nums">{list.length}</span>
              </p>
              <ul className="flex flex-col border-t border-line">
                {list.slice(0, PER_GROUP).map((n) => (
                  <li key={n.id} className="border-b border-line">
                    <button
                      type="button"
                      onClick={() => onStep(n.id)}
                      className="flex w-full items-center gap-2 py-1.5 text-left hover:text-paper"
                      data-testid="connection"
                    >
                      <TypeGlyph type={n.type} className="text-paper/70" />
                      <span
                        className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-paper"
                        title={n.label}
                      >
                        {n.label}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-mute">
                        {edgeKindLabel(n.edgeType)}
                      </span>
                    </button>
                  </li>
                ))}
                {list.length > PER_GROUP ? (
                  <li className="py-1.5 text-[12.5px] text-mute">…and {list.length - PER_GROUP} more</li>
                ) : null}
              </ul>
            </div>
          ))}
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="src-h">
          <h3 id="src-h" className="text-[14px] font-medium text-paper">
            Sources{" "}
            {detail ? (
              <span className="font-mono text-[12px] font-normal text-mute tabular-nums">
                {detail.sources.length}
              </span>
            ) : null}
          </h3>
          {!detail ? (
            <p className="text-dim">Loading…</p>
          ) : detail.sources.length === 0 ? (
            <p className="text-dim">None recorded.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line border-y border-line">
              {detail.sources.slice(0, 5).map((s) => (
                <li key={s.bundleId} className="flex flex-col gap-1.5 py-2.5">
                  <p className="text-[13px] font-medium text-paper">{s.name}</p>
                  {s.excerpt ? (
                    <p className="line-clamp-3 text-[12.5px] whitespace-pre-wrap text-dim">{s.excerpt}</p>
                  ) : null}
                  {s.url ? <CopyOnlyUrl url={s.url} /> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        {archive && archive.length > 0 ? (
          <section className="flex flex-col gap-3" aria-labelledby="arc-h" data-testid="detail-archive">
            <h3 id="arc-h" className="text-[14px] font-medium text-paper">
              {archiveCopy.title}
            </h3>
            <ul className="flex flex-col divide-y divide-line border-y border-line">
              {archive.slice(0, 8).map((a) => (
                <li key={a.id} className="flex items-center gap-2 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-dim">{a.label}</span>
                  <TierBadge tier={a.tier} />
                </li>
              ))}
            </ul>
            <p className="text-[12.5px] text-mute">{archiveCopy.graph.nodeNote}</p>
          </section>
        ) : null}

        <Link
          href={`/investigations/${invId}/results/entities?focus=${encodeURIComponent(nodeId)}`}
          className="va-link self-start text-[13px]"
        >
          Open in the table
        </Link>
      </div>
    </aside>
  );
}
