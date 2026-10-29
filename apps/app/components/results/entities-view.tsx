"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Checkbox, Input } from "@voidaccess/ui";
import {
  filtersToParams,
  parseFilters,
  toggleSort,
  toggleType,
  type EntityFilters,
} from "@/lib/results/entity-filters";
import { archiveCopy } from "@/lib/archive/copy";
import { typeLabel } from "@/lib/results/entity-style";
import { glyphFor } from "@/lib/results/glyphs";
import { TierBadge } from "./tier-badge";
import { formatDate } from "@/lib/results/format";
import {
  TIERS,
  type EntityPage,
  type EntityRowView,
  type EntitySort,
  type Tier,
  type TierCounts,
} from "@/lib/results/types";
import { CopyButton } from "./copy-text";
import { EntityDetailView } from "./entity-detail";
import { SideDrawer } from "./side-drawer";
import { TypeBadge } from "./type-badge";
import { ShapeGlyph } from "./type-glyph";
import { MaskedMark, UL } from "./ui";
import { TierHeading, tierHelp } from "./relevance";

type SeenMap = Record<string, { firstSeen: string; tier: "unconfirmed" | "corroborated" | "feed_validated" }>;

const PAGE = 100;
const ROW_H = 44;
const GRID =
  "grid grid-cols-[2.25rem_minmax(14rem,2.4fr)_10rem_6rem_7.5rem_5rem_11rem_minmax(8rem,1fr)] items-center gap-x-4 px-3";

const COLS: { key: EntitySort | null; label: string }[] = [
  { key: "value", label: "Value" },
  { key: "type", label: "Type" },
  { key: "confidence", label: "Confidence" },
  { key: "firstSeen", label: "First seen" },
  { key: "sources", label: "Sources" },
  { key: null, label: archiveCopy.entities.column },
  { key: null, label: "Tags" },
];

export function EntitiesView({
  investigationId,
  typeCounts,
  tierCounts = null,
  query = "",
}: {
  investigationId: string;
  typeCounts: Record<string, number>;
  /** entity counts per relevance tier; null for investigations without tiers (one table, exactly as before) */
  tierCounts?: TierCounts | null;
  /** the investigation's query, for the tier explanations */
  query?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const filters = useMemo(() => parseFilters(new URLSearchParams(sp.toString())), [sp]);

  const [seenMap, setSeenMap] = useState<SeenMap | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/investigations/${investigationId}/archive?lite=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then((c: { seen: SeenMap } | null) => !cancelled && setSeenMap(c?.seen ?? {}))
      .catch(() => !cancelled && setSeenMap({}));
    return () => {
      cancelled = true;
    };
  }, [investigationId]);
  const [search, setSearch] = useState(filters.q);
  const [showBackground, setShowBackground] = useState(false);

  const setFilters = useCallback(
    (next: EntityFilters) => {
      const qs = filtersToParams(next).toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  // debounce the search box into the URL
  useEffect(() => {
    if (search === filters.q) return;
    const t = setTimeout(() => setFilters({ ...filters, q: search }), 250);
    return () => clearTimeout(t);
  }, [search, filters, setFilters]);

  const types = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  const anyFilter =
    filters.q ||
    filters.types.length ||
    filters.min !== null ||
    filters.max !== null ||
    filters.sensitive ||
    filters.archive !== "all";
  const table = (tier?: Tier) => (
    <EntityTable
      key={tier ?? "all"}
      investigationId={investigationId}
      filters={filters}
      setFilters={setFilters}
      seenMap={seenMap}
      tier={tier}
    />
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex min-w-56 flex-1 flex-col gap-1.5 text-[13px] text-dim">
          Search values and tags
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="e.g. cve-2023, onion, lockbit"
          />
        </label>
        <fieldset className="flex items-end gap-2 text-[13px] text-dim">
          <legend className="mb-1.5">Confidence</legend>
          <label className="flex flex-col gap-1">
            <span className="sr-only">Minimum confidence</span>
            <Input
              type="number"
              min={0}
              max={1}
              step={0.05}
              placeholder="min"
              className="w-20"
              value={filters.min ?? ""}
              onChange={(e) =>
                setFilters({ ...filters, min: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          </label>
          <span aria-hidden className="pb-2">
            to
          </span>
          <label className="flex flex-col gap-1">
            <span className="sr-only">Maximum confidence</span>
            <Input
              type="number"
              min={0}
              max={1}
              step={0.05}
              placeholder="max"
              className="w-20"
              value={filters.max ?? ""}
              onChange={(e) =>
                setFilters({ ...filters, max: e.target.value === "" ? null : Number(e.target.value) })
              }
            />
          </label>
        </fieldset>
        <label className="flex items-center gap-2 pb-2.5 text-[14px] text-paper">
          <Checkbox
            checked={filters.sensitive}
            onCheckedChange={(c) => setFilters({ ...filters, sensitive: c === true })}
            aria-label="Sensitive only"
          />
          Sensitive only
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] text-dim">
          {archiveCopy.entities.filterLabel}
          <select
            value={filters.archive}
            onChange={(e) => setFilters({ ...filters, archive: e.target.value as "all" | "new" | "seen" })}
            data-testid="archive-filter"
            className="h-10 rounded-sm border border-line bg-bg px-3 text-[14px] text-paper transition-colors duration-300 hover:border-line-2"
          >
            <option value="all">{archiveCopy.entities.all}</option>
            <option value="new">{archiveCopy.entities.onlyNew}</option>
            <option value="seen">{archiveCopy.entities.onlySeen}</option>
          </select>
        </label>
        {anyFilter ? (
          <button
            type="button"
            onClick={() => (
              setSearch(""),
              setFilters({
                ...filters,
                q: "",
                types: [],
                min: null,
                max: null,
                sensitive: false,
                archive: "all",
              })
            )}
            className={`${UL} mb-2.5 text-[14px]`}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      <div role="group" aria-label="Filter by type" className="flex flex-wrap gap-2">
        {types.map(([t, n]) => {
          const on = filters.types.includes(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              onClick={() => setFilters(toggleType(filters, t))}
              className={`flex h-8 items-center gap-2 rounded-sm border px-2.5 text-[13px] transition-colors duration-300 ${on ? "border-line-3 bg-paper/[0.06] text-paper" : "border-line text-dim hover:border-line-2 hover:text-paper"}`}
            >
              <ShapeGlyph shape={glyphFor(t).shape} className={on ? "text-paper" : "text-paper/60"} />
              {typeLabel(t)} <span className="font-mono text-[12px] text-mute tabular-nums">{n}</span>
            </button>
          );
        })}
      </div>

      {tierCounts
        ? TIERS.map((tier) => {
            const n = tierCounts[tier];
            const bg = tier === "background";
            const open = !bg || showBackground;
            return (
              <section
                key={tier}
                aria-labelledby={`entities-tier-${tier}`}
                data-testid={`entities-tier-${tier}`}
                className={`flex flex-col gap-4 ${bg ? "border-t border-line pt-6" : ""}`}
              >
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <TierHeading
                    tier={tier}
                    count={n}
                    help={tierHelp(tier, query, "entities")}
                    id={`entities-tier-${tier}`}
                  />
                  {bg && n > 0 ? (
                    <button
                      type="button"
                      aria-expanded={showBackground}
                      aria-controls="entities-background-table"
                      onClick={() => setShowBackground((v) => !v)}
                      className={`${UL} text-[14px] text-dim`}
                      data-testid="toggle-background"
                    >
                      {showBackground
                        ? "Hide background"
                        : `Show ${n} background ${n === 1 ? "entity" : "entities"}`}
                    </button>
                  ) : null}
                </div>
                {n === 0 ? (
                  <p className="font-mono text-[13px] text-mute">
                    {tier === "direct"
                      ? `Nothing collected names “${query}” directly.`
                      : `No ${tier} entities.`}
                  </p>
                ) : open ? (
                  <div
                    id={bg ? "entities-background-table" : undefined}
                    className={bg ? "opacity-75" : undefined}
                  >
                    {table(tier)}
                  </div>
                ) : null}
              </section>
            );
          })
        : table()}
      <p className="font-mono text-[12px] text-mute">
        Keyboard: ↑ ↓ move between rows, Enter opens details, Space selects.
      </p>

      <SideDrawer
        open={filters.focus !== null}
        onClose={() => setFilters({ ...filters, focus: null })}
        title="Entity details"
      >
        {filters.focus ? (
          <EntityDetailView
            key={filters.focus}
            invId={investigationId}
            bundleId={filters.focus}
            onOpenEntity={(id) => setFilters({ ...filters, focus: id })}
          />
        ) : null}
      </SideDrawer>
    </div>
  );
}

/** One entity grid: its own paging, selection and keyboard handling. `tier` limits it to one relevance tier. */
function EntityTable({
  investigationId,
  filters,
  setFilters,
  seenMap,
  tier,
}: {
  investigationId: string;
  filters: EntityFilters;
  setFilters: (f: EntityFilters) => void;
  seenMap: SeenMap | null;
  tier?: Tier;
}) {
  const queryKey = filtersToParams(filters, false).toString();
  const [rows, setRows] = useState<EntityRowView[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState(0);
  const inFlight = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const rowEls = useRef(new Map<number, HTMLDivElement>());

  const fetchPage = useCallback(
    async (offset: number, signal?: AbortSignal): Promise<EntityPage | null> => {
      const p = filtersToParams(filters, false);
      if (tier) p.set("tier", tier);
      p.set("offset", String(offset));
      p.set("limit", String(PAGE));
      const res = await fetch(`/api/investigations/${investigationId}/entities?${p}`, { signal });
      return res.ok ? ((await res.json()) as EntityPage) : null;
    },
    [filters, investigationId, tier],
  );
  // first page whenever the filters change
  useEffect(() => {
    const ctl = new AbortController();
    inFlight.current = true;
    setLoading(true);
    setFailed(false);
    fetchPage(0, ctl.signal)
      .then((page) => {
        if (!page) return setFailed(true);
        setRows(page.rows);
        setTotal(page.total);
        setActive(0);
        scroller.current?.scrollTo({ top: 0 });
      })
      .catch((e) => e?.name !== "AbortError" && setFailed(true))
      .finally(() => {
        inFlight.current = false;
        if (!ctl.signal.aborted) setLoading(false);
      });
    return () => ctl.abort();
  }, [queryKey]);

  const hasMore = total !== null && rows.length < total;
  const loadMore = useCallback(async () => {
    if (inFlight.current || !hasMore) return;
    inFlight.current = true;
    setLoading(true);
    try {
      const page = await fetchPage(rows.length);
      if (page) setRows((r) => [...r, ...page.rows]);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [fetchPage, hasMore, rows.length]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_H,
    overscan: 12,
    initialRect: { width: 1000, height: 640 },
  });
  const items = virtualizer.getVirtualItems();
  const lastIndex = items.at(-1)?.index ?? 0;
  useEffect(() => {
    if (rows.length > 0 && lastIndex >= rows.length - 20) void loadMore();
  }, [lastIndex, rows.length, loadMore]);

  const move = (to: number) => {
    const i = Math.max(0, Math.min(rows.length - 1, to));
    setActive(i);
    virtualizer.scrollToIndex(i);
    requestAnimationFrame(() => rowEls.current.get(i)?.focus());
  };
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    const row = rows[i];
    if (!row) return;
    const go = (to: number) => {
      e.preventDefault();
      move(to);
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(rows.length - 1);
    else if (e.key === "PageDown") go(i + 10);
    else if (e.key === "PageUp") go(i - 10);
    else if (e.key === "Enter") {
      e.preventDefault();
      setFilters({ ...filters, focus: row.bundleId });
    } else if (e.key === " ") {
      e.preventDefault();
      toggleSelect(row.bundleId);
    }
  };
  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const selectedRows = rows.filter((r) => selected.has(r.bundleId));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const arrow = (k: EntitySort | null) =>
    k && filters.sort === k ? (filters.dir === "asc" ? " ↑" : " ↓") : "";
  // a tier section is only as tall as its rows (up to the usual height); the untiered table keeps its fixed height
  const height = tier ? Math.min(Math.max(total ?? 2, 2) * ROW_H + 8, 640) : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[14px] text-dim">
        <p aria-live="polite" data-testid="entity-count" className="tabular-nums">
          {total === null
            ? "Loading…"
            : `Showing ${rows.length.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} entities`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton
            text={rows.map((r) => r.displayValue).join("\n")}
            label={`Copy ${rows.length} loaded values (sensitive values masked)`}
          />
          <span className="font-mono text-[12px] text-mute tabular-nums">column ({rows.length})</span>
          {selectedRows.length > 0 ? (
            <>
              <CopyButton
                text={selectedRows.map((r) => r.displayValue).join("\n")}
                label="Copy selected values (sensitive values masked)"
              />
              <span className="font-mono text-[12px] text-mute tabular-nums">
                {selectedRows.length} selected
              </span>
            </>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto border-y border-line">
        <div role="grid" aria-label="Entities" aria-rowcount={total ?? undefined} className="min-w-[68rem]">
          <div role="row" className={`${GRID} h-10 border-b border-line-2 font-mono text-[12px] text-mute`}>
            <div role="columnheader">
              <Checkbox
                checked={allSelected ? true : selectedRows.length > 0 ? "indeterminate" : false}
                onCheckedChange={(c) =>
                  setSelected(c === true ? new Set(rows.map((r) => r.bundleId)) : new Set())
                }
                aria-label="Select all loaded rows"
              />
            </div>
            {COLS.map((c) => (
              <div
                key={c.label}
                role="columnheader"
                aria-sort={
                  c.key && filters.sort === c.key
                    ? filters.dir === "asc"
                      ? "ascending"
                      : "descending"
                    : undefined
                }
              >
                {c.key ? (
                  <button
                    type="button"
                    onClick={() => setFilters(toggleSort(filters, c.key!))}
                    className="transition-colors duration-300 hover:text-paper aria-[sort]:text-paper"
                  >
                    {c.label}
                    {arrow(c.key)}
                  </button>
                ) : (
                  c.label
                )}
              </div>
            ))}
          </div>
          <div
            ref={scroller}
            className={`relative overflow-y-auto ${tier ? "max-h-[min(65vh,40rem)]" : "h-[min(65vh,40rem)]"}`}
            style={height ? { height } : undefined}
            data-testid="entity-scroller"
          >
            {failed ? (
              <p className="p-6 text-[15px] text-paper">Couldn&apos;t load entities. Try again.</p>
            ) : null}
            {!failed && total === 0 ? (
              <p className="p-6 text-[15px] text-dim">No entities match these filters.</p>
            ) : null}
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {items.map((v) => {
                const r = rows[v.index];
                if (!r) return null;
                const isSel = selected.has(r.bundleId);
                return (
                  <div
                    key={r.bundleId}
                    ref={(el) => {
                      if (el) rowEls.current.set(v.index, el);
                      else rowEls.current.delete(v.index);
                    }}
                    role="row"
                    aria-rowindex={v.index + 2}
                    aria-selected={isSel}
                    tabIndex={v.index === active ? 0 : -1}
                    data-testid="entity-row"
                    onKeyDown={(e) => onKeyDown(e, v.index)}
                    onFocus={() => setActive(v.index)}
                    onClick={() => setFilters({ ...filters, focus: r.bundleId })}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: ROW_H,
                      transform: `translateY(${v.start}px)`,
                    }}
                    className={`${GRID} group cursor-pointer border-b border-line text-[14px] transition-colors duration-300 hover:bg-bg-2 focus-visible:bg-bg-2 focus-visible:outline-offset-[-2px] ${isSel ? "bg-bg-2" : ""}`}
                  >
                    <div role="gridcell" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSel}
                        onCheckedChange={() => toggleSelect(r.bundleId)}
                        aria-label={`Select ${r.displayValue}`}
                      />
                    </div>
                    <div role="gridcell" className="flex min-w-0 items-center gap-2">
                      <span
                        className="truncate font-mono text-[13px] text-paper transition-colors duration-300 group-hover:text-v-200 group-focus-visible:text-v-200"
                        title={r.displayValue}
                      >
                        {r.displayValue}
                      </span>
                      {r.sensitive ? <MaskedMark /> : null}
                      <CopyButton
                        text={r.displayValue}
                        label={r.sensitive ? "Copy masked value" : "Copy value"}
                        className="ml-auto"
                      />
                    </div>
                    <div role="gridcell">
                      <TypeBadge type={r.type} />
                    </div>
                    <div role="gridcell" className="font-mono text-[13px] tabular-nums">
                      {r.confidence.toFixed(2)}
                    </div>
                    <div role="gridcell" className="text-[13px] text-dim tabular-nums">
                      {formatDate(r.firstSeen)}
                    </div>
                    <div role="gridcell" className="font-mono text-[13px] tabular-nums">
                      {r.sourceCount}
                    </div>
                    <div
                      role="gridcell"
                      className="flex flex-wrap items-center gap-2 text-[13px]"
                      data-testid="seen-before-cell"
                    >
                      {seenMap?.[r.bundleId] ? (
                        <>
                          <span className="text-dim tabular-nums">
                            {formatDate(seenMap[r.bundleId]!.firstSeen)}
                          </span>
                          <TierBadge tier={seenMap[r.bundleId]!.tier} />
                        </>
                      ) : (
                        <span className="font-mono text-[12px] text-mute">
                          {seenMap ? archiveCopy.entities.never : "…"}
                        </span>
                      )}
                    </div>
                    <div
                      role="gridcell"
                      className="truncate font-mono text-[12px] text-dim"
                      title={r.tags.join(", ")}
                    >
                      {r.tags.join(", ")}
                    </div>
                  </div>
                );
              })}
            </div>
            {loading && rows.length > 0 ? (
              <p className="p-3 text-center font-mono text-[12px] text-mute">Loading more…</p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
