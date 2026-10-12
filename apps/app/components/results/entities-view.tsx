"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Badge, Checkbox, Input } from "@voidaccess/ui";
import {
  filtersToParams,
  parseFilters,
  toggleSort,
  toggleType,
  type EntityFilters,
} from "@/lib/results/entity-filters";
import { archiveCopy } from "@/lib/archive/copy";
import { typeLabel } from "@/lib/results/entity-style";
import { TierBadge } from "./tier-badge";
import { formatDate } from "@/lib/results/format";
import type { EntityPage, EntityRowView, EntitySort } from "@/lib/results/types";
import { CopyButton } from "./copy-text";
import { EntityDetailView } from "./entity-detail";
import { SideDrawer } from "./side-drawer";
import { TypeBadge } from "./type-badge";

const PAGE = 100;
const ROW_H = 44;
const GRID =
  "grid grid-cols-[2.25rem_minmax(14rem,2.4fr)_9rem_6rem_7.5rem_5rem_11rem_minmax(8rem,1fr)] items-center gap-x-3 px-3";

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
}: {
  investigationId: string;
  typeCounts: Record<string, number>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const filters = useMemo(() => parseFilters(new URLSearchParams(sp.toString())), [sp]);
  const queryKey = filtersToParams(filters, false).toString();

  const [rows, setRows] = useState<EntityRowView[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [seenMap, setSeenMap] = useState<Record<
    string,
    { firstSeen: string; tier: "unconfirmed" | "corroborated" | "feed_validated" }
  > | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/investigations/${investigationId}/archive?lite=1`)
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          c: {
            seen: Record<
              string,
              { firstSeen: string; tier: "unconfirmed" | "corroborated" | "feed_validated" }
            >;
          } | null,
        ) => !cancelled && setSeenMap(c?.seen ?? {}),
      )
      .catch(() => !cancelled && setSeenMap({}));
    return () => {
      cancelled = true;
    };
  }, [investigationId]);
  const [active, setActive] = useState(0);
  const [search, setSearch] = useState(filters.q);
  const inFlight = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const rowEls = useRef(new Map<number, HTMLDivElement>());

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

  const fetchPage = useCallback(
    async (offset: number, signal?: AbortSignal): Promise<EntityPage | null> => {
      const p = filtersToParams(filters, false);
      p.set("offset", String(offset));
      p.set("limit", String(PAGE));
      const res = await fetch(`/api/investigations/${investigationId}/entities?${p}`, { signal });
      return res.ok ? ((await res.json()) as EntityPage) : null;
    },
    [filters, investigationId],
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

  const types = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  const selectedRows = rows.filter((r) => selected.has(r.bundleId));
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const arrow = (k: EntitySort | null) =>
    k && filters.sort === k ? (filters.dir === "asc" ? " ▲" : " ▼") : "";
  const anyFilter =
    filters.q ||
    filters.types.length ||
    filters.min !== null ||
    filters.max !== null ||
    filters.sensitive ||
    filters.archive !== "all";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs text-fg-secondary">
          Search values and tags
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="e.g. cve-2023, onion, lockbit"
          />
        </label>
        <fieldset className="flex items-end gap-2 text-xs text-fg-secondary">
          <legend className="mb-1">Confidence</legend>
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
        <label className="flex items-center gap-2 pb-2 text-sm">
          <Checkbox
            checked={filters.sensitive}
            onCheckedChange={(c) => setFilters({ ...filters, sensitive: c === true })}
            aria-label="Sensitive only"
          />
          Sensitive only
        </label>
        <label className="flex flex-col gap-1 text-xs text-fg-secondary">
          {archiveCopy.entities.filterLabel}
          <select
            value={filters.archive}
            onChange={(e) => setFilters({ ...filters, archive: e.target.value as "all" | "new" | "seen" })}
            data-testid="archive-filter"
            className="h-10 rounded-md border border-border-subtle bg-surface px-3 text-sm text-fg"
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
            className="pb-2 text-sm text-accent hover:underline"
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
              className={`rounded-full border px-3 py-1 text-xs focus-visible:outline-2 focus-visible:outline-accent ${on ? "border-accent-border bg-accent-dim text-accent" : "border-border-subtle text-fg-secondary hover:text-fg"}`}
            >
              {typeLabel(t)} <span className="font-mono">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-fg-secondary">
        <p aria-live="polite" data-testid="entity-count">
          {total === null
            ? "Loading…"
            : `Showing ${rows.length.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} entities`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <CopyButton
            text={rows.map((r) => r.displayValue).join("\n")}
            label={`Copy ${rows.length} loaded values (sensitive values masked)`}
            className="!h-8"
          />
          <span className="text-xs">column ({rows.length})</span>
          {selectedRows.length > 0 ? (
            <>
              <CopyButton
                text={selectedRows.map((r) => r.displayValue).join("\n")}
                label="Copy selected values (sensitive values masked)"
                className="!h-8"
              />
              <span className="text-xs">{selectedRows.length} selected</span>
            </>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border-subtle">
        <div role="grid" aria-label="Entities" aria-rowcount={total ?? undefined} className="min-w-[68rem]">
          <div
            role="row"
            className={`${GRID} h-10 border-b border-border-subtle bg-surface text-xs font-medium tracking-wide text-fg-secondary uppercase`}
          >
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
                    className="uppercase hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
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
            className="relative h-[min(65vh,40rem)] overflow-y-auto"
            data-testid="entity-scroller"
          >
            {failed ? (
              <p className="p-6 text-sm text-danger">Couldn&apos;t load entities. Try again.</p>
            ) : null}
            {!failed && total === 0 ? (
              <p className="p-6 text-sm text-fg-secondary">No entities match these filters.</p>
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
                    className={`${GRID} cursor-pointer border-b border-border-dim text-sm hover:bg-raised/60 focus-visible:bg-raised focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${isSel ? "bg-accent-dim" : ""}`}
                  >
                    <div role="gridcell" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSel}
                        onCheckedChange={() => toggleSelect(r.bundleId)}
                        aria-label={`Select ${r.displayValue}`}
                      />
                    </div>
                    <div role="gridcell" className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-mono text-xs" title={r.displayValue}>
                        {r.displayValue}
                      </span>
                      {r.sensitive ? <Badge variant="warning">masked</Badge> : null}
                      <CopyButton
                        text={r.displayValue}
                        label={r.sensitive ? "Copy masked value" : "Copy value"}
                        className="ml-auto"
                      />
                    </div>
                    <div role="gridcell">
                      <TypeBadge type={r.type} />
                    </div>
                    <div role="gridcell" className="font-mono">
                      {r.confidence.toFixed(2)}
                    </div>
                    <div role="gridcell" className="text-xs text-fg-secondary">
                      {formatDate(r.firstSeen)}
                    </div>
                    <div role="gridcell" className="font-mono">
                      {r.sourceCount}
                    </div>
                    <div
                      role="gridcell"
                      className="flex flex-wrap items-center gap-1.5 text-xs"
                      data-testid="seen-before-cell"
                    >
                      {seenMap?.[r.bundleId] ? (
                        <>
                          <span className="text-fg-secondary">
                            {formatDate(seenMap[r.bundleId]!.firstSeen)}
                          </span>
                          <TierBadge tier={seenMap[r.bundleId]!.tier} />
                        </>
                      ) : (
                        <span className="text-fg-muted">{seenMap ? archiveCopy.entities.never : "…"}</span>
                      )}
                    </div>
                    <div
                      role="gridcell"
                      className="truncate text-xs text-fg-secondary"
                      title={r.tags.join(", ")}
                    >
                      {r.tags.join(", ")}
                    </div>
                  </div>
                );
              })}
            </div>
            {loading && rows.length > 0 ? (
              <p className="p-3 text-center text-xs text-fg-secondary">Loading more…</p>
            ) : null}
          </div>
        </div>
      </div>
      <p className="text-xs text-fg-secondary">
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
