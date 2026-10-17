"use client";
import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "@voidaccess/ui";
import { GROUPS, groupShape, type GroupId } from "@/lib/results/categories";
import { glyphFor } from "@/lib/results/glyphs";
import { highlightRuns, type Match } from "@/lib/results/search";
import { windowAround, type Row } from "@/lib/results/workspace-model";
import { CopyButton } from "../copy-text";
import { ShapeGlyph } from "../type-glyph";
import { IconChevron, IconCollapse, IconPin, IconSearch } from "./icons";

export const ROW_H = 30;
const VIRTUAL_FROM = 200;
const BODY_MAX = 320;

export interface SidebarProps {
  groups: Map<GroupId, Row[]>;
  total: number;
  query: string;
  onQuery: (q: string) => void;
  matches: ReadonlyMap<string, Match> | null;
  activeId: string | null;
  onMoveActive: (delta: 1 | -1) => void;
  onEnter: () => void;
  openGroup: GroupId | null;
  /** the group that is animating closed (its rows stay mounted until the height reaches zero) */
  closing: GroupId | null;
  onOpenGroup: (g: GroupId | null) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onHoverRow: (id: string | null) => void;
  hiddenGroups: ReadonlySet<GroupId>;
  searchRef: RefObject<HTMLInputElement | null>;
  mode: "expanded" | "rail";
  animate: boolean;
  pinned: boolean;
  onToggle: () => void;
  onTogglePin: () => void;
  onRailHoverRest: () => void;
  onRailFocus: () => void;
  onPointerLeave: () => void;
  footer: React.ReactNode;
  /** below 960px: a bottom sheet instead of a floating panel */
  mobile: boolean;
  sheet: "peek" | "full";
  onSheet: (s: "peek" | "full") => void;
}

function Highlighted({ text, ranges }: { text: string; ranges: readonly [number, number][] }) {
  return (
    <>
      {highlightRuns(text, ranges).map((r, i) =>
        r.hit ? (
          <mark key={i} className="rounded-[2px] bg-paper/20 text-paper">
            {r.text}
          </mark>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  );
}

function ValueRow({
  row,
  match,
  selected,
  active,
  onSelect,
  onHover,
  style,
}: {
  row: Row;
  match: Match | undefined;
  selected: boolean;
  active: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  style?: React.CSSProperties;
}) {
  const w = windowAround(row.display, match?.ranges ?? [], 30);
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      data-row={row.id}
      data-testid="value-row"
      onClick={() => onSelect(row.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(row.id);
        }
      }}
      onMouseEnter={() => onHover(row.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(row.id)}
      onBlur={() => onHover(null)}
      style={style}
      className={cn(
        "group/row relative flex h-[30px] cursor-pointer items-center gap-2.5 pr-1.5 pl-3 outline-none",
        "transition-colors duration-200 hover:bg-paper/[0.04] focus-visible:bg-paper/[0.06]",
        active && "bg-paper/[0.06]",
      )}
    >
      {selected ? (
        <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-v-500" />
      ) : null}
      <ShapeGlyph shape={glyphFor(row.type).shape} className={selected ? "text-v-200" : "text-paper/70"} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate font-mono text-[12.5px]",
          selected ? "text-v-200" : "text-paper",
        )}
        title={row.display}
      >
        <Highlighted text={w.text} ranges={w.ranges} />
      </span>
      <span className="shrink-0 font-mono text-[11px] text-mute tabular-nums group-hover/row:hidden group-focus-within/row:hidden">
        {row.confidence.toFixed(2)}
      </span>
      <span
        className="hidden shrink-0 group-hover/row:block group-focus-within/row:block"
        onClick={(e) => e.stopPropagation()}
      >
        <CopyButton text={row.display} label={row.sensitive ? "Copy masked value" : "Copy value"} />
      </span>
    </div>
  );
}

function GroupBody({
  rows,
  matches,
  selectedId,
  activeId,
  onSelect,
  onHover,
  open,
}: {
  rows: Row[];
  matches: ReadonlyMap<string, Match> | null;
  selectedId: string | null;
  activeId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  open: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // while searching, a group lists its matches plus the selection (stepping to a connection keeps its row visible)
  const shown = matches ? rows.filter((r) => matches.has(r.id) || r.id === selectedId) : rows;
  const virtual = shown.length >= VIRTUAL_FROM;
  const v = useVirtualizer({
    count: virtual ? shown.length : 0,
    getScrollElement: () => ref.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });
  // keep the selected (or active) row in view
  const target = activeId ?? selectedId;
  useEffect(() => {
    if (!open || !target) return;
    const i = shown.findIndex((r) => r.id === target);
    if (i < 0) return;
    if (virtual) v.scrollToIndex(i, { align: "auto" });
    else {
      // scroll this list only (scrollIntoView would also scroll the page, which must never move)
      const box = ref.current;
      const row = box?.querySelector<HTMLElement>(`[data-row="${CSS.escape(target)}"]`);
      if (box && row) {
        if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop;
        else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight)
          box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight;
      }
    }
  }, [open, target, shown, virtual, v]);

  return (
    <div
      ref={ref}
      role="listbox"
      aria-label="Values"
      className="relative overflow-y-auto overscroll-contain"
      style={{ maxHeight: BODY_MAX, height: virtual ? BODY_MAX : undefined }}
    >
      {virtual ? (
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((it) => {
            const r = shown[it.index]!;
            return (
              <ValueRow
                key={r.id}
                row={r}
                match={matches?.get(r.id)}
                selected={r.id === selectedId}
                active={r.id === activeId}
                onSelect={onSelect}
                onHover={onHover}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${it.start}px)`,
                }}
              />
            );
          })}
        </div>
      ) : (
        shown.map((r) => (
          <ValueRow
            key={r.id}
            row={r}
            match={matches?.get(r.id)}
            selected={r.id === selectedId}
            active={r.id === activeId}
            onSelect={onSelect}
            onHover={onHover}
          />
        ))
      )}
    </div>
  );
}

export function Sidebar(p: SidebarProps) {
  const railTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // bring the open group's header to the top of the list (the list scrolls, never the page)
  useEffect(() => {
    const box = listRef.current;
    const sec = box?.querySelector<HTMLElement>(`[data-group="${p.openGroup}"]`);
    if (!box || !sec) return;
    const top = sec.offsetTop;
    if (top < box.scrollTop || top + 40 > box.scrollTop + box.clientHeight) box.scrollTop = top;
  }, [p.openGroup]);
  const searching = p.matches !== null;
  const nonEmpty = GROUPS.filter((g) => (p.groups.get(g.id)?.length ?? 0) > 0);
  const countOf = (g: GroupId) => {
    const rows = p.groups.get(g) ?? [];
    return searching ? rows.filter((r) => p.matches!.has(r.id)).length : rows.length;
  };
  const matchTotal = searching ? p.matches!.size : null;

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      p.onMoveActive(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      p.onEnter();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (p.query) p.onQuery("");
      else (e.target as HTMLInputElement).blur();
    }
  };

  const rail = p.mode === "rail" && !p.mobile;
  const transition = p.animate ? "width 200ms cubic-bezier(.16,1,.3,1)" : "none";

  if (rail)
    return (
      <nav
        aria-label="Values"
        data-testid="sidebar-rail"
        className="pointer-events-auto absolute top-4 bottom-4 left-4 z-20 flex w-14 flex-col items-center gap-1 overflow-hidden rounded-md border border-line bg-bg-2 py-2.5 shadow-[0_8px_24px_rgba(0,0,0,0.28)] max-[960px]:hidden"
        style={{ transition }}
        onPointerEnter={() => {
          railTimer.current = setTimeout(p.onRailHoverRest, 150);
        }}
        onPointerLeave={() => railTimer.current && clearTimeout(railTimer.current)}
        onFocus={p.onRailFocus}
      >
        <button
          type="button"
          onClick={p.onToggle}
          aria-label="Expand values panel"
          className="flex size-9 items-center justify-center rounded-sm text-dim hover:text-paper"
        >
          <IconCollapse open={false} />
        </button>
        <button
          type="button"
          onClick={() => {
            p.onRailFocus();
            requestAnimationFrame(() => p.searchRef.current?.focus({ preventScroll: true }));
          }}
          aria-label="Search values"
          className="flex size-9 items-center justify-center rounded-sm text-dim hover:text-paper"
        >
          <IconSearch />
        </button>
        <span aria-hidden className="my-1 h-px w-7 border-t border-dashed border-line-2" />
        <ul className="flex min-h-0 flex-1 flex-col items-center gap-0.5 overflow-y-auto">
          {nonEmpty.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                aria-label={`${g.label}: ${countOf(g.id)}`}
                onClick={() => {
                  p.onOpenGroup(g.id);
                  p.onRailFocus();
                }}
                className={cn(
                  "flex w-11 flex-col items-center gap-0.5 rounded-sm py-1.5 text-dim hover:text-paper",
                  p.hiddenGroups.has(g.id) && "opacity-40",
                )}
              >
                <ShapeGlyph shape={groupShape(g.id)} />
                <span className="font-mono text-[10.5px] tabular-nums">{countOf(g.id)}</span>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={p.onTogglePin}
          aria-pressed={p.pinned}
          aria-label="Keep the values panel open"
          className="flex size-9 items-center justify-center rounded-sm text-dim hover:text-paper"
        >
          <IconPin on={p.pinned} />
        </button>
      </nav>
    );

  return (
    <aside
      aria-label="Values"
      data-testid="sidebar"
      data-sheet={p.mobile ? p.sheet : undefined}
      className={cn(
        "pointer-events-auto absolute z-20 flex flex-col overflow-hidden border border-line bg-bg-2",
        p.mobile
          ? "inset-x-0 bottom-0 rounded-t-md border-b-0 shadow-[0_-8px_24px_rgba(0,0,0,0.28)]"
          : "top-4 bottom-4 left-4 w-[320px] rounded-md shadow-[0_8px_24px_rgba(0,0,0,0.28)]",
      )}
      style={
        p.mobile
          ? {
              height: p.sheet === "full" ? "72%" : 158,
              transition: p.animate ? "height 220ms cubic-bezier(.16,1,.3,1)" : "none",
            }
          : { transition }
      }
      onPointerLeave={p.onPointerLeave}
    >
      {p.mobile ? (
        <button
          type="button"
          aria-label={p.sheet === "full" ? "Lower the values sheet" : "Raise the values sheet"}
          aria-expanded={p.sheet === "full"}
          onClick={() => p.onSheet(p.sheet === "full" ? "peek" : "full")}
          onPointerDown={(e) => {
            const y0 = e.clientY;
            const up = (ev: PointerEvent) => {
              window.removeEventListener("pointerup", up);
              const dy = ev.clientY - y0;
              if (dy < -24) p.onSheet("full");
              else if (dy > 24) p.onSheet("peek");
            };
            window.addEventListener("pointerup", up);
          }}
          className="flex h-5 shrink-0 touch-none items-center justify-center"
          data-testid="sheet-handle"
        >
          <span aria-hidden className="h-1 w-10 rounded-full bg-line-3" />
        </button>
      ) : null}
      <header
        className={cn(
          "flex shrink-0 items-center justify-between gap-2 border-b border-dashed border-line-2 px-3.5",
          p.mobile ? "h-9" : "h-12",
        )}
      >
        <h2 className="flex items-baseline gap-2 text-[15px] font-medium tracking-[-0.01em]">
          Values
          <span
            className="font-mono text-[12px] font-normal text-mute tabular-nums"
            data-testid="values-total"
          >
            {matchTotal !== null ? `${matchTotal} of ${p.total}` : p.total}
          </span>
        </h2>
        {!p.mobile ? (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={p.onTogglePin}
              aria-pressed={p.pinned}
              aria-label="Keep the values panel open"
              title={p.pinned ? "Pinned open" : "Pin open"}
              className={cn(
                "flex size-8 items-center justify-center rounded-sm hover:text-paper",
                p.pinned ? "text-paper" : "text-mute",
              )}
              data-testid="sidebar-pin"
            >
              <IconPin on={p.pinned} />
            </button>
            <button
              type="button"
              onClick={p.onToggle}
              aria-label="Collapse values panel"
              className="flex size-8 items-center justify-center rounded-sm text-mute hover:text-paper"
              data-testid="sidebar-toggle"
            >
              <IconCollapse open />
            </button>
          </div>
        ) : null}
      </header>

      <div className="shrink-0 px-3 pt-3 pb-2">
        <label className="relative flex items-center">
          <span className="sr-only">Search values</span>
          <span aria-hidden className="pointer-events-none absolute left-2.5 text-mute">
            <IconSearch />
          </span>
          <input
            ref={p.searchRef}
            type="search"
            value={p.query}
            onChange={(e) => p.onQuery(e.target.value)}
            onKeyDown={onSearchKey}
            onFocus={() => p.mobile && p.onSheet("full")}
            placeholder="Search values"
            autoComplete="off"
            spellCheck={false}
            aria-keyshortcuts="/ Control+K Meta+K"
            aria-describedby="search-hint"
            className="h-9 w-full rounded-sm border border-line bg-bg pr-9 pl-8 font-mono text-[13px] text-paper placeholder:font-sans placeholder:text-mute focus:border-line-3 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
            data-testid="value-search"
          />
          <kbd
            aria-hidden
            className="pointer-events-none absolute right-2 rounded-xs border border-line px-1.5 font-mono text-[11px] leading-[18px] text-mute"
          >
            /
          </kbd>
        </label>
        <p id="search-hint" className="sr-only">
          Up and down move through matches, Enter selects, Escape clears.
        </p>
      </div>

      {p.mobile && p.sheet === "peek" ? (
        <ul className="flex shrink-0 gap-1.5 overflow-x-auto px-3 pb-3" aria-label="Groups">
          {nonEmpty.map((g) => (
            <li key={g.id} className="shrink-0">
              <button
                type="button"
                onClick={() => {
                  p.onOpenGroup(g.id);
                  p.onSheet("full");
                }}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-sm border border-line px-2.5 font-mono text-[12px] text-dim",
                  searching && countOf(g.id) === 0 && "opacity-40",
                )}
              >
                <ShapeGlyph shape={groupShape(g.id)} />
                <span className="font-sans text-[13px] text-paper">{g.label}</span>
                <span className="tabular-nums">{countOf(g.id)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div
          ref={listRef}
          className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2"
          data-testid="groups"
        >
          {searching && matchTotal === 0 ? (
            <p className="px-4 py-6 text-[15px] text-dim" role="status">
              No values match
            </p>
          ) : null}
          {nonEmpty.map((g) => {
            const open = p.openGroup === g.id;
            const n = countOf(g.id);
            const dim = (searching && n === 0) || p.hiddenGroups.has(g.id);
            const rows = p.groups.get(g.id)!;
            return (
              <section
                key={g.id}
                data-group={g.id}
                data-open={open}
                className="border-b border-line last:border-b-0"
              >
                <h3>
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`grp-${g.id}`}
                    onClick={() => p.onOpenGroup(open ? null : g.id)}
                    className={cn(
                      "flex h-10 w-full items-center gap-2.5 px-3.5 text-left transition-[opacity,color] duration-200 hover:text-paper",
                      dim ? "opacity-40" : "",
                    )}
                    data-testid={`group-${g.id}`}
                  >
                    <ShapeGlyph shape={groupShape(g.id)} className="text-paper/70" />
                    <span className="flex-1 text-[14px] text-paper">{g.label}</span>
                    <span
                      className="font-mono text-[12px] text-mute tabular-nums"
                      data-testid={`group-count-${g.id}`}
                    >
                      {n}
                    </span>
                    <span className="text-mute">
                      <IconChevron open={open} />
                    </span>
                  </button>
                </h3>
                {/* single-open accordion: rows 0fr -> 1fr animates the height (200 ms, expo.out) */}
                <div
                  id={`grp-${g.id}`}
                  className="grid"
                  style={{
                    gridTemplateRows: open ? "1fr" : "0fr",
                    transition: p.animate ? "grid-template-rows 200ms cubic-bezier(.16,1,.3,1)" : "none",
                  }}
                  inert={!open}
                >
                  <div className="min-h-0 overflow-hidden">
                    {open || p.closing === g.id ? (
                      <GroupBody
                        rows={rows}
                        matches={p.matches}
                        selectedId={p.selectedId}
                        activeId={p.activeId}
                        onSelect={p.onSelect}
                        onHover={p.onHoverRow}
                        open={open}
                      />
                    ) : null}
                  </div>
                </div>
              </section>
            );
          })}
          <p className="sr-only">{searching ? `${matchTotal} values match.` : null}</p>
        </div>
      )}
      {p.mobile && p.sheet === "peek" ? null : (
        <div className="shrink-0 border-t border-line">{p.footer}</div>
      )}
    </aside>
  );
}
