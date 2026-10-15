"use client";

import { Button, Checkbox } from "@voidaccess/ui";
import { EDGE_DISCLAIMER, typeLabel, typeStyle } from "@/lib/results/entity-style";
import { archiveCopy } from "@/lib/archive/copy";
import { ARCHIVE_GLYPH } from "@/lib/results/glyphs";
import { BIG_GRAPH_TOP, type GraphFilterState } from "@/lib/results/graph-model";
import { ShapeGlyph } from "./type-glyph";
import { InfoTip, UL } from "./ui";

export interface GraphControlsProps {
  filters: GraphFilterState;
  onChange: (next: GraphFilterState) => void;
  types: [string, number][];
  big: boolean;
  truncated: number;
  totalNodes: number;
  visibleNodes: number;
  visibleEdges: number;
  onReset: () => void;
  onExportPng: () => void;
  onExportSvg: () => void;
  exporting: boolean;
  tableHref: string;
  /** archive context overlay (off by default) */
  archive?: {
    on: boolean;
    onToggle: (on: boolean) => void;
    hops: 1 | 2;
    onHops: (h: 1 | 2) => void;
    minTier: "unconfirmed" | "corroborated" | "feed_validated";
    onMinTier: (t: "unconfirmed" | "corroborated" | "feed_validated") => void;
    loading: boolean;
    nodes: number;
    truncated: boolean;
    failed: boolean;
  };
}

const SELECT =
  "h-8 rounded-sm border border-line bg-bg px-2 font-mono text-[13px] text-paper transition-colors duration-300 hover:border-line-2";

export function GraphControls(p: GraphControlsProps) {
  const { filters, onChange } = p;
  const toggleType = (t: string) => {
    const hidden = new Set(filters.hiddenTypes);
    if (hidden.has(t)) hidden.delete(t);
    else hidden.add(t);
    onChange({ ...filters, hiddenTypes: hidden });
  };
  return (
    <div className="flex flex-col gap-4 text-[14px]" data-testid="graph-controls">
      <div role="group" aria-label="Filter by entity type" className="flex flex-wrap gap-2">
        {p.types.map(([t, n]) => {
          const on = !filters.hiddenTypes.has(t);
          const s = typeStyle(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              data-testid={`type-chip-${t}`}
              onClick={() => toggleType(t)}
              className={`flex h-8 items-center gap-2 rounded-sm border px-2.5 text-[13px] transition-colors duration-300 ${on ? "border-line-2 text-paper hover:border-line-3" : "border-line text-mute line-through decoration-line-3 hover:text-dim"}`}
            >
              <ShapeGlyph shape={s.glyph.shape} className={on ? "text-paper/80" : "text-faint"} />
              {s.label || typeLabel(t)}{" "}
              <span className="font-mono text-[12px] text-mute tabular-nums">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-3">
          <span className="text-dim">Min confidence</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={filters.minConfidence}
            aria-label="Minimum confidence"
            data-testid="min-confidence"
            onChange={(e) => onChange({ ...filters, minConfidence: Number(e.target.value) })}
            className="w-32 accent-paper"
          />
          <span className="w-9 font-mono text-[13px] text-paper tabular-nums">
            {filters.minConfidence.toFixed(2)}
          </span>
        </label>
        <label className="flex items-center gap-2 text-paper">
          <Checkbox
            checked={filters.typedOnly}
            onCheckedChange={(c) => onChange({ ...filters, typedOnly: c === true })}
            aria-label="Typed relationships only"
            data-testid="typed-only"
          />
          Typed relationships only
          <InfoTip content={EDGE_DISCLAIMER} label="About relationships" />
        </label>
        {p.big ? (
          <label className="flex items-center gap-2 text-paper">
            <Checkbox
              checked={filters.showAll}
              onCheckedChange={(c) => onChange({ ...filters, showAll: c === true })}
              aria-label="Show all nodes"
              data-testid="show-all"
            />
            Show all nodes
          </label>
        ) : null}
      </div>
      {p.archive ? (
        <div
          className="flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-line py-3"
          data-testid="archive-controls"
        >
          <label className="flex items-center gap-2 text-paper">
            <Checkbox
              checked={p.archive.on}
              onCheckedChange={(c) => p.archive!.onToggle(c === true)}
              aria-label={archiveCopy.graph.toggle}
              data-testid="archive-toggle"
            />
            {archiveCopy.graph.toggle}
          </label>
          {p.archive.on ? (
            <>
              <label className="flex items-center gap-2 text-dim">
                {archiveCopy.graph.hops}
                <select
                  value={p.archive.hops}
                  onChange={(e) => p.archive!.onHops(e.target.value === "2" ? 2 : 1)}
                  data-testid="archive-hops"
                  className={SELECT}
                >
                  <option value={1}>{archiveCopy.graph.hop1}</option>
                  <option value={2}>{archiveCopy.graph.hop2}</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-dim">
                {archiveCopy.graph.minTier}
                <select
                  value={p.archive.minTier}
                  onChange={(e) =>
                    p.archive!.onMinTier(e.target.value as "unconfirmed" | "corroborated" | "feed_validated")
                  }
                  data-testid="archive-min-tier"
                  className={SELECT}
                >
                  <option value="unconfirmed">{archiveCopy.tierLabel.unconfirmed}</option>
                  <option value="corroborated">{archiveCopy.tierLabel.corroborated}</option>
                  <option value="feed_validated">{archiveCopy.tierLabel.feed_validated}</option>
                </select>
              </label>
              <span
                className="flex items-center gap-2 text-[13px] text-dim"
                data-testid="archive-status"
                aria-live="polite"
              >
                <ShapeGlyph shape={ARCHIVE_GLYPH.shape} className="text-paper/80" />
                {archiveCopy.graph.legend}
                {p.archive.loading
                  ? " …"
                  : p.archive.failed
                    ? " (couldn't load)"
                    : p.archive.nodes === 0
                      ? `: ${archiveCopy.graph.none}`
                      : `: ${p.archive.nodes}`}
                {p.archive.truncated ? ` ${archiveCopy.graph.truncated}` : ""}
              </span>
            </>
          ) : null}
        </div>
      ) : null}
      {p.big && !filters.showAll ? (
        <p role="status" className="flex items-baseline gap-2 text-[13px] text-dim">
          <span aria-hidden className="font-mono text-paper">
            ▲
          </span>
          <span>
            <span className="font-medium text-paper">Large graph:</span> showing the top{" "}
            {BIG_GRAPH_TOP.toLocaleString("en-US")} of {p.totalNodes.toLocaleString("en-US")} nodes by
            connections ({p.truncated.toLocaleString("en-US")} hidden). Turn on “Show all nodes” to see
            everything.
          </span>
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={p.onReset}>
          Reset view
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={p.onExportPng}
          disabled={p.exporting}
          data-testid="export-png"
        >
          Export PNG
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={p.onExportSvg}
          disabled={p.exporting}
          data-testid="export-svg"
        >
          Export SVG
        </Button>
        <a href={p.tableHref} className={`${UL} ml-2 text-[14px]`}>
          View as table
        </a>
        <span className="ml-auto font-mono text-[12px] text-mute tabular-nums" data-testid="graph-counts">
          {p.visibleNodes.toLocaleString("en-US")} nodes · {p.visibleEdges.toLocaleString("en-US")} edges
        </span>
      </div>
    </div>
  );
}
