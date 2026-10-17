"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@voidaccess/ui";
import { GROUPS, groupShape, type GroupId } from "@/lib/results/categories";
import { activeFilterCount, filterSummary, NO_FILTERS, type Filters } from "@/lib/results/workspace-model";
import { ShapeGlyph } from "../type-glyph";
import { IconFilter } from "./icons";

/**
 * One "Filters" control (P9-6): min confidence, typed relationships only, archive context and per-group visibility.
 * Active filters show as a count on the control and a one-line "Filtered: …" note with a clear button.
 */
export function FiltersControl({
  filters,
  onChange,
  groups,
  archiveState,
  counts,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  /** groups present in this investigation, with their counts */
  groups: { id: GroupId; count: number }[];
  archiveState: { loading: boolean; nodes: number; failed: boolean };
  /** values drawn vs. in the run; `big` runs open showing the best-connected part first */
  counts: { visible: number; total: number; edges: number; big: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [maxH, setMaxH] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // the panel opens upward inside the sidebar: never taller than the room above the button (short viewports)
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const panel = ref.current.closest("aside");
    if (!panel) return;
    setMaxH(Math.max(160, ref.current.getBoundingClientRect().top - panel.getBoundingClientRect().top - 12));
  }, [open]);
  const n = activeFilterCount(filters);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const toggleGroup = (g: GroupId) => {
    const hidden = new Set(filters.hiddenGroups);
    if (hidden.has(g)) hidden.delete(g);
    else hidden.add(g);
    onChange({ ...filters, hiddenGroups: hidden });
  };

  return (
    <div ref={ref} className="relative">
      {n > 0 ? (
        <p
          className="flex items-start gap-2 border-b border-line px-3.5 py-2 text-[12.5px] leading-snug text-dim"
          data-testid="filtered-note"
        >
          <span className="min-w-0 flex-1">
            <span className="text-paper">Filtered: </span>
            {filterSummary(filters)}
          </span>
          <button
            type="button"
            className="shrink-0 font-mono text-[12px] text-mute hover:text-paper"
            onClick={() => onChange(NO_FILTERS)}
          >
            Clear
          </button>
        </p>
      ) : null}
      <button
        type="button"
        aria-expanded={open}
        aria-controls="filters-panel"
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-full items-center gap-2.5 px-3.5 text-left text-[14px] text-dim hover:text-paper"
        data-testid="filters-button"
      >
        <IconFilter />
        <span className="flex-1">Filters</span>
        {n > 0 ? (
          <span
            className="rounded-xs border border-line-2 px-1.5 font-mono text-[11px] leading-[18px] text-paper tabular-nums"
            data-testid="filters-count"
          >
            {n}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id="filters-panel"
          role="group"
          aria-label="Filters"
          className="absolute inset-x-2 bottom-full z-30 mb-2 flex flex-col gap-4 overflow-y-auto overscroll-contain rounded-md border border-line-2 bg-bg-2 p-4 shadow-[0_8px_24px_rgba(0,0,0,0.32)] [&>*]:shrink-0"
          style={{ maxHeight: maxH ?? 520 }}
          data-testid="filters-panel"
        >
          <p className="font-mono text-[12px] text-mute tabular-nums" data-testid="graph-counts">
            Showing {counts.visible.toLocaleString("en-US")} of {counts.total.toLocaleString("en-US")} values
            · {counts.edges.toLocaleString("en-US")} links
          </p>
          {counts.big ? (
            <label className="flex items-center gap-2.5 text-[13px] text-paper">
              <input
                type="checkbox"
                checked={filters.showAll}
                onChange={(e) => onChange({ ...filters, showAll: e.target.checked })}
                className="accent-paper"
                data-testid="show-all"
              />
              Show all values (large run: the best connected are shown first)
            </label>
          ) : null}
          <label className="flex flex-col gap-2">
            <span className="flex items-baseline justify-between text-[13px] text-dim">
              Min confidence
              <span className="font-mono text-[12px] text-paper tabular-nums">
                {filters.minConfidence.toFixed(2)}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={filters.minConfidence}
              onChange={(e) => onChange({ ...filters, minConfidence: Number(e.target.value) })}
              className="accent-paper"
              data-testid="filter-confidence"
            />
          </label>
          <label className="flex items-center gap-2.5 text-[13px] text-paper">
            <input
              type="checkbox"
              checked={filters.typedOnly}
              onChange={(e) => onChange({ ...filters, typedOnly: e.target.checked })}
              className="accent-paper"
              data-testid="filter-typed"
            />
            Typed relationships only
          </label>
          <label className="flex items-center gap-2.5 text-[13px] text-paper">
            <input
              type="checkbox"
              checked={filters.archive}
              onChange={(e) => onChange({ ...filters, archive: e.target.checked })}
              className="accent-paper"
              data-testid="archive-toggle"
            />
            Show archive context
            {filters.archive ? (
              <span className="font-mono text-[11px] text-mute" data-testid="archive-status">
                {archiveState.loading
                  ? "Archive context: loading…"
                  : archiveState.failed
                    ? "Archive context: unavailable"
                    : `Archive context nodes: ${archiveState.nodes}`}
              </span>
            ) : null}
          </label>
          <fieldset className="flex flex-col gap-1 border-t border-line pt-3">
            <legend className="mb-1.5 text-[13px] text-dim">Show on the graph</legend>
            {GROUPS.filter((g) => groups.some((x) => x.id === g.id)).map((g) => {
              const on = !filters.hiddenGroups.has(g.id);
              return (
                <label
                  key={g.id}
                  className={cn(
                    "flex items-center gap-2.5 py-1 text-[13px]",
                    on ? "text-paper" : "text-mute",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleGroup(g.id)}
                    className="accent-paper"
                    data-testid={`filter-group-${g.id}`}
                  />
                  <ShapeGlyph shape={groupShape(g.id)} />
                  <span className="flex-1">{g.label}</span>
                  <span className="font-mono text-[11px] text-mute tabular-nums">
                    {groups.find((x) => x.id === g.id)!.count}
                  </span>
                </label>
              );
            })}
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}
