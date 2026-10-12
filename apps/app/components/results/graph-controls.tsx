"use client";

import { Button, Checkbox, Tooltip } from "@voidaccess/ui";
import { EDGE_DISCLAIMER, typeLabel, typeStyle } from "@/lib/results/entity-style";
import { BIG_GRAPH_TOP, type GraphFilterState } from "@/lib/results/graph-model";

export interface GraphControlsProps {
  filters: GraphFilterState;
  onChange: (next: GraphFilterState) => void;
  types: [string, number][];
  communityColors: boolean;
  onCommunityColors: (v: boolean) => void;
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
  cssColor: (type: string) => string;
}

export function GraphControls(p: GraphControlsProps) {
  const { filters, onChange } = p;
  const toggleType = (t: string) => {
    const hidden = new Set(filters.hiddenTypes);
    if (hidden.has(t)) hidden.delete(t);
    else hidden.add(t);
    onChange({ ...filters, hiddenTypes: hidden });
  };
  return (
    <div className="flex flex-col gap-4 text-sm" data-testid="graph-controls">
      <div role="group" aria-label="Filter by entity type" className="flex flex-wrap gap-2">
        {p.types.map(([t, n]) => {
          const on = !filters.hiddenTypes.has(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              data-testid={`type-chip-${t}`}
              onClick={() => toggleType(t)}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs focus-visible:outline-2 focus-visible:outline-accent ${on ? "border-border-strong text-fg" : "border-border-dim text-fg-muted line-through"}`}
            >
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{
                  background: on ? p.cssColor(t) : "transparent",
                  border: `1px solid ${p.cssColor(t)}`,
                }}
              />
              {typeStyle(t).label || typeLabel(t)} <span className="font-mono">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="flex items-center gap-2">
          <span className="text-fg-secondary">Min confidence</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={filters.minConfidence}
            aria-label="Minimum confidence"
            data-testid="min-confidence"
            onChange={(e) => onChange({ ...filters, minConfidence: Number(e.target.value) })}
            className="accent-[var(--color-accent)]"
          />
          <span className="w-9 font-mono text-xs">{filters.minConfidence.toFixed(2)}</span>
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={filters.typedOnly}
            onCheckedChange={(c) => onChange({ ...filters, typedOnly: c === true })}
            aria-label="Typed relationships only"
            data-testid="typed-only"
          />
          Typed relationships only
          <Tooltip content={EDGE_DISCLAIMER}>
            <button
              type="button"
              aria-label="About relationships"
              className="flex size-5 items-center justify-center rounded-full border border-border-strong text-xs text-fg-secondary"
            >
              i
            </button>
          </Tooltip>
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={p.communityColors}
            onCheckedChange={(c) => p.onCommunityColors(c === true)}
            aria-label="Colour by community"
            data-testid="community-colors"
          />
          Colour by community
        </label>
        {p.big ? (
          <label className="flex items-center gap-2">
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
      {p.big && !filters.showAll ? (
        <p role="status" className="text-xs text-warning">
          Large graph: showing the top {BIG_GRAPH_TOP.toLocaleString("en-US")} of{" "}
          {p.totalNodes.toLocaleString("en-US")} nodes by connections ({p.truncated.toLocaleString("en-US")}{" "}
          hidden). Turn on “Show all nodes” to see everything.
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
        <a
          href={p.tableHref}
          className="text-sm text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          View as table
        </a>
        <span className="ml-auto font-mono text-xs text-fg-secondary" data-testid="graph-counts">
          {p.visibleNodes.toLocaleString("en-US")} nodes · {p.visibleEdges.toLocaleString("en-US")} edges
        </span>
      </div>
    </div>
  );
}
