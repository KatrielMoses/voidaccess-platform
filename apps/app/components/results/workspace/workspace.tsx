"use client";
/**
 * The results workspace (P9): a full-height graph with a floating values sidebar (left), a floating toolbar (top
 * right) and a floating detail panel for the selection (right). Below 960px the sidebar and the detail panel are
 * bottom sheets.
 *
 * State that should survive reload and back/forward lives in the URL: ?q= (search, replaceState) and ?node=
 * (selection, pushState, so browser back steps back through the trail). Hover, search and selection reach the graph
 * through one mutable view state (use-graph.ts), so typing and hovering never re-render the canvas.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { cn } from "@voidaccess/ui";
import { archiveCopy } from "@/lib/archive/copy";
import { GROUPS, groupOf, type GroupId } from "@/lib/results/categories";
import { EDGE_COOCCURRENCE } from "@/lib/results/entity-style";
import { buildSvg, downloadSvg, exportPng, type SvgEdge, type SvgNode } from "@/lib/results/graph-export";
import { PAPER_HEX, V500_HEX, isBig } from "@/lib/results/graph-model";
import { ARCHIVE_GLYPH, glyphFor, legendFor } from "@/lib/results/glyphs";
import { buildIndex, searchIndex } from "@/lib/results/search";
import { initialSidebar, loadPinned, savePinned, sidebarReducer } from "@/lib/results/sidebar-state";
import type { GraphData } from "@/lib/results/types";
import {
  NO_FILTERS,
  orderedMatches,
  rowsByGroup,
  visibleFor,
  type Filters,
} from "@/lib/results/workspace-model";
import { useArchiveOverlay } from "../use-archive-overlay";
import { DetailPanel, type ArchiveNeighbour } from "./detail-panel";
import { FiltersControl } from "./filters";
import { IconFit, IconImage, IconMinus, IconPlus, IconReset, IconTable, IconVector } from "./icons";
import { Sidebar } from "./sidebar";
import { useGraph } from "./use-graph";
import { THIN_RESULT, thinResultNote } from "@/lib/results/small-results";

const INSET = 16;
const SIDEBAR_W = 320;
const RAIL_W = 56;
const DETAIL_W = 360;

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const readUrl = () => {
  const p = new URLSearchParams(window.location.search);
  return { q: p.get("q") ?? "", node: p.get("node") };
};
function writeUrl(next: { q?: string; node?: string | null }, push: boolean) {
  const url = new URL(window.location.href);
  if (next.q !== undefined) {
    if (next.q) url.searchParams.set("q", next.q);
    else url.searchParams.delete("q");
  }
  if (next.node !== undefined) {
    if (next.node) url.searchParams.set("node", next.node);
    else url.searchParams.delete("node");
  }
  if (url.href === window.location.href) return;
  const state = { ...(window.history.state ?? {}), vaNode: next.node ?? null };
  if (push) window.history.pushState(state, "", url);
  else window.history.replaceState(window.history.state, "", url);
}

function ToolButton({
  label,
  onClick,
  children,
  testId,
  disabled,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="flex size-8 items-center justify-center rounded-sm text-dim transition-colors duration-200 hover:bg-paper/[0.06] hover:text-paper disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function Workspace({ investigationId }: { investigationId: string }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState(false);
  const mobile = useMedia("(max-width: 959px)");
  const reduced = useMedia("(prefers-reduced-motion: reduce)");

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  // URL state
  const [q, setQ] = useState(() => readUrl().q);
  const [dq, setDq] = useState(q);
  const [selected, setSelected] = useState<string | null>(() => readUrl().node);
  const [trail, setTrail] = useState<string[]>(() => (readUrl().node ? [readUrl().node!] : []));
  const [active, setActive] = useState(0);
  const [openGroup, setOpenGroupRaw] = useState<GroupId | null>(null);
  const [closing, setClosing] = useState<GroupId | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sheet, setSheet] = useState<"peek" | "full">("peek");
  const [exporting, setExporting] = useState(false);
  const [edgeTip, setEdgeTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [sb, dispatch] = useReducer(sidebarReducer, undefined, () => initialSidebar(loadPinned(), reduced));

  useEffect(() => dispatch({ t: "reducedMotion", on: reduced }), [reduced]);
  useEffect(() => savePinned(sb.pinned), [sb.pinned]);

  // data
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/investigations/${investigationId}/graph`)
      .then((r) => (r.ok ? (r.json() as Promise<GraphData>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setError(true));
    return () => {
      cancelled = true;
    };
  }, [investigationId]);

  // the workspace fills the viewport below the results header; the page itself does not scroll
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    window.scrollTo(0, 0);
    const measure = () =>
      setHeight(Math.max(320, window.innerHeight - el.getBoundingClientRect().top - window.scrollY));
    measure();
    window.addEventListener("resize", measure);
    // focus and scrolling inside the panels must never move the page under the workspace
    const pin = () => window.scrollY !== 0 && window.scrollTo(0, 0);
    window.addEventListener("scroll", pin);
    return () => {
      html.style.overflow = prev;
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", pin);
    };
  }, []);

  const groups = useMemo(() => (data ? rowsByGroup(data) : new Map<GroupId, never[]>()), [data]);
  const rows = useMemo(() => [...groups.values()].flat(), [groups]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const index = useMemo(() => buildIndex(rows), [rows]);
  const visible = useMemo(() => (data ? visibleFor(data, filters) : null), [data, filters]);

  // search: debounced ~80 ms, kept in the URL
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 80);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => writeUrl({ q: dq.trim() }, false), [dq]);
  const matches = useMemo(() => (dq.trim() ? searchIndex(index, dq) : null), [index, dq]);
  const ordered = useMemo(() => (matches ? orderedMatches(groups, matches) : []), [groups, matches]);
  const activeRow = ordered[Math.min(active, ordered.length - 1)] ?? null;
  /** The ordered matches for what is in the field right now (not yet debounced). */
  const liveOrdered = () =>
    q.trim() === dq.trim() ? ordered : q.trim() ? orderedMatches(groups, searchIndex(index, q)) : [];
  const flushQuery = () => {
    if (q !== dq) setDq(q);
  };

  const setOpenGroup = useCallback((g: GroupId | null) => {
    setOpenGroupRaw((cur) => {
      if (cur && cur !== g) {
        setClosing(cur);
        setTimeout(() => setClosing((c) => (c === cur ? null : c)), 230);
      }
      return g;
    });
  }, []);

  // a new search opens the first group with matches
  useEffect(() => {
    setActive(0);
    if (ordered.length) setOpenGroup(ordered[0]!.group);
  }, [dq]); // only when the query itself changes

  // selection
  const select = useCallback(
    (id: string, how: "graph" | "sidebar" | "search" | "step") => {
      if (!byId.has(id)) return;
      setSelected(id);
      setTrail((t) => (how === "step" ? [...t, id] : [id]));
      setOpenGroup(groupOf(byId.get(id)!.type));
      if (how === "search") dispatch({ t: "searchSelect" });
      if (mobile) setSheet("peek");
      writeUrl({ node: id }, true);
    },
    [byId, mobile, setOpenGroup],
  );
  const clear = useCallback(() => {
    setSelected(null);
    setTrail([]);
    writeUrl({ node: null }, true);
  }, []);
  const toTrail = useCallback(
    (i: number) => {
      const id = trail[i];
      if (!id) return;
      setTrail(trail.slice(0, i + 1));
      setSelected(id);
      setOpenGroup(groupOf(byId.get(id)?.type ?? ""));
      writeUrl({ node: id }, true);
    },
    [trail, byId, setOpenGroup],
  );

  // browser back/forward: the URL is the truth
  useEffect(() => {
    const onPop = () => {
      const u = readUrl();
      setQ(u.q);
      setDq(u.q);
      setSelected(u.node);
      setTrail((t) => {
        if (!u.node) return [];
        const i = t.lastIndexOf(u.node);
        return i >= 0 ? t.slice(0, i + 1) : [u.node];
      });
      if (u.node && byId.has(u.node)) setOpenGroup(groupOf(byId.get(u.node)!.type));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [byId, setOpenGroup]);

  // the graph
  const g = useGraph({
    container: canvasRef,
    data,
    investigationId,
    onClickNode: (id) => select(id, "graph"),
    onClickStage: () => clear(),
    onHoverNode: () => undefined,
    onHoverEdge: setEdgeTip,
  });

  const archive = useArchiveOverlay({
    investigationId,
    graphRef: g.graphRef,
    sigmaRef: g.sigmaRef,
    graphVersion: g.version,
    on: filters.archive,
    hops: 1,
    minTier: "unconfirmed",
  });

  // feed the reducers
  useEffect(() => {
    const v = g.view;
    v.selected = selected && byId.has(selected) ? selected : null;
    v.matches = matches ? new Set(matches.keys()) : null;
    v.active = activeRow?.id ?? null;
    v.visible = visible;
    g.repaint();
  }, [g, selected, matches, activeRow, visible, byId]);

  const insets = useMemo(() => {
    if (mobile)
      return {
        left: 0,
        right: 0,
        bottom: selected ? (height ?? 600) * 0.62 : sheet === "full" ? (height ?? 600) * 0.72 : 158,
      };
    const left = INSET + (sb.mode === "expanded" ? SIDEBAR_W : RAIL_W);
    const right = selected ? INSET + DETAIL_W : 0;
    return { left, right };
  }, [mobile, sb.mode, selected, sheet, height]);

  // the camera follows the selection (from the graph, the sidebar, search or the trail alike)
  const insetsRef = useRef(insets);
  insetsRef.current = insets;
  useEffect(() => {
    if (selected && !g.laying && g.version > 0) g.focus(selected, insetsRef.current);
  }, [selected, g.laying, g.version]); // not on inset changes

  // fit once the layout is ready, leaving room for the sidebar
  const fitted = useRef(false);
  useEffect(() => {
    if (g.laying || g.version === 0 || fitted.current) return;
    fitted.current = true;
    if (!selected) g.fit(insetsRef.current);
  }, [g.laying, g.version]); // once

  // working in the graph collapses the sidebar (unless pinned)
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    let down: { x: number; y: number } | null = null;
    const interact = () => dispatch({ t: "graphInteract" });
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onMove = (e: PointerEvent) => {
      if (down && Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 5) {
        down = null;
        interact();
      }
    };
    const onUp = () => (down = null);
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    el.addEventListener("wheel", interact, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("wheel", interact);
    };
  }, [data]);

  // keyboard: "/" or Cmd/Ctrl+K focuses search, Esc clears the selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if ((e.key === "/" && !typing) || (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        dispatch({ t: "slash" });
        if (mobile) setSheet("full");
        requestAnimationFrame(() => searchRef.current?.focus({ preventScroll: true }));
      } else if (e.key === "Escape" && !typing && selected) {
        clear();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobile, selected, clear]);

  const onHoverRow = useCallback(
    (id: string | null) => {
      g.view.hovered = id;
      g.repaint();
    },
    [g],
  );

  const archiveNeighbours: ArchiveNeighbour[] | null = useMemo(() => {
    const graph = g.graphRef.current;
    if (!filters.archive || !selected || !graph?.hasNode(selected) || archive.loading) return null;
    return graph
      .neighbors(selected)
      .filter((n) => graph.getNodeAttribute(n, "archive"))
      .map((n) => {
        const a = graph.getNodeAttributes(n);
        return {
          id: n,
          label: a.label as string,
          type: a.etype as string,
          tier: a.tier as ArchiveNeighbour["tier"],
        };
      });
  }, [filters.archive, selected, archive.loading, archive.nodes, g.graphRef]);

  const onPng = async () => {
    if (!g.sigmaRef.current) return;
    setExporting(true);
    try {
      await exportPng(g.sigmaRef.current, `voidaccess-${investigationId.slice(0, 8)}-graph.png`);
    } finally {
      setExporting(false);
    }
  };
  const onSvg = () => {
    const sigma = g.sigmaRef.current;
    const graph = g.graphRef.current;
    if (!sigma || !graph || !visible) return;
    downloadSvg(
      svgOfView(sigma, graph, visible, selected),
      `voidaccess-${investigationId.slice(0, 8)}-graph.svg`,
    );
  };

  const groupCounts = GROUPS.map((x) => ({ id: x.id, count: groups.get(x.id)?.length ?? 0 })).filter(
    (x) => x.count > 0,
  );
  const labelOf = useCallback((id: string) => byId.get(id)?.display ?? id, [byId]);
  const selectedOk = selected && byId.has(selected) ? selected : null;

  return (
    <div
      ref={wrapRef}
      className="relative -mt-5 overflow-hidden bg-bg"
      style={{ height: height ?? "calc(100dvh - 16rem)", width: "100vw", marginLeft: "calc(50% - 50vw)" }}
      data-testid="workspace"
    >
      <div
        ref={canvasRef}
        role="img"
        aria-label={
          data
            ? `Graph of ${data.nodes.length} values and ${data.edges.length} links. The values panel lists every value by category; View as table opens the same data as a table.`
            : "Graph"
        }
        data-testid="graph-canvas"
        className="absolute inset-0 touch-none"
      />
      {!data && !error ? (
        <p
          className="absolute inset-0 flex items-center justify-center font-mono text-[13px] text-dim"
          role="status"
        >
          Loading graph…
        </p>
      ) : null}
      {error ? (
        <p className="absolute inset-0 flex items-center justify-center text-[15px] text-paper" role="alert">
          Couldn&apos;t load the graph. Try again.
        </p>
      ) : null}
      {data && data.nodes.length === 0 ? (
        <p className="absolute inset-0 flex items-center justify-center text-[15px] text-dim">
          This run has no values to graph.
        </p>
      ) : null}

      {data && data.nodes.length > 0 && data.nodes.length <= THIN_RESULT ? (
        <p
          className="pointer-events-none absolute bottom-6 left-1/2 max-w-[44ch] -translate-x-1/2 text-center text-[14px] leading-snug text-dim max-[960px]:hidden"
          data-testid="thin-result"
        >
          {thinResultNote(data.nodes.length, data.edges.length)}
        </p>
      ) : null}

      {data && data.nodes.length > 0 ? (
        <>
          <Sidebar
            groups={groups}
            total={rows.length}
            query={q}
            onQuery={setQ}
            matches={matches}
            activeId={activeRow?.id ?? null}
            onMoveActive={(d) => {
              flushQuery();
              setActive(
                (a) => (a + d + Math.max(1, liveOrdered().length)) % Math.max(1, liveOrdered().length),
              );
            }}
            onEnter={() => {
              // Enter may come before the debounce: search what is typed now
              const list = liveOrdered();
              flushQuery();
              const row = list[Math.min(active, list.length - 1)];
              if (row) select(row.id, "search");
            }}
            openGroup={openGroup}
            closing={closing}
            onOpenGroup={setOpenGroup}
            selectedId={selectedOk}
            onSelect={(id) => select(id, matches ? "search" : "sidebar")}
            onHoverRow={onHoverRow}
            hiddenGroups={filters.hiddenGroups}
            searchRef={searchRef}
            mode={sb.mode}
            animate={sb.animate}
            pinned={sb.pinned}
            onToggle={() => dispatch({ t: "toggle" })}
            onTogglePin={() => dispatch({ t: "togglePin" })}
            onRailHoverRest={() => dispatch({ t: "railHoverRest" })}
            onRailFocus={() => dispatch({ t: "railFocus" })}
            onPointerLeave={() => dispatch({ t: "pointerLeave" })}
            mobile={mobile}
            sheet={sheet}
            onSheet={setSheet}
            footer={
              <FiltersControl
                filters={filters}
                onChange={setFilters}
                groups={groupCounts}
                archiveState={{ loading: archive.loading, nodes: archive.nodes, failed: archive.failed }}
                counts={{
                  visible: visible?.nodes.size ?? 0,
                  total: data.nodes.length,
                  edges: visible?.edges.size ?? 0,
                  big: isBig(data),
                }}
              />
            }
          />

          <div
            role="toolbar"
            aria-label="Graph view"
            className={cn(
              "pointer-events-auto absolute top-4 z-20 flex items-center gap-0.5 rounded-md border border-line bg-bg-2 p-1 shadow-[0_8px_24px_rgba(0,0,0,0.28)]",
              mobile ? "right-3 top-3" : "",
            )}
            style={mobile ? undefined : { right: selectedOk ? INSET + DETAIL_W + 12 : INSET }}
          >
            <ToolButton label="Zoom in" onClick={() => g.zoom(1.5)} testId="zoom-in">
              <IconPlus />
            </ToolButton>
            <ToolButton label="Zoom out" onClick={() => g.zoom(1 / 1.5)} testId="zoom-out">
              <IconMinus />
            </ToolButton>
            <ToolButton label="Fit to view" onClick={() => g.fit(insets)} testId="fit">
              <IconFit />
            </ToolButton>
            <ToolButton
              label="Reset view"
              onClick={() => {
                clear();
                setQ("");
                setFilters(NO_FILTERS);
                g.fit({ ...insets, right: 0 });
              }}
              testId="reset-view"
            >
              <IconReset />
            </ToolButton>
            {!mobile ? (
              <>
                <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />
                <ToolButton label="Export PNG" onClick={onPng} disabled={exporting} testId="export-png">
                  <IconImage />
                </ToolButton>
                <ToolButton label="Export SVG" onClick={onSvg} disabled={exporting} testId="export-svg">
                  <IconVector />
                </ToolButton>
              </>
            ) : null}
            <span aria-hidden className="mx-0.5 h-5 w-px bg-line" />
            <Link
              href={`/investigations/${investigationId}/results/entities`}
              aria-label="View as table"
              title="View as table"
              className="flex h-8 items-center gap-1.5 rounded-sm px-2 text-[13px] text-dim hover:bg-paper/[0.06] hover:text-paper"
              data-testid="view-table"
            >
              <IconTable />
              {!mobile ? "Table" : null}
            </Link>
          </div>

          {edgeTip ? (
            <div
              data-testid="edge-tip"
              className="pointer-events-none absolute z-10 max-w-xs rounded-xs border border-line-2 bg-bg-2 px-2.5 py-1.5 font-mono text-[12px] leading-snug text-dim"
              style={{ left: edgeTip.x + 12, top: edgeTip.y + 12 }}
            >
              {edgeTip.text}
            </div>
          ) : null}
          {g.laying ? (
            <p
              className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-sm border border-line bg-bg-2 px-3 py-1.5 font-mono text-[12px] text-dim"
              role="status"
            >
              Arranging graph…
            </p>
          ) : null}
          {filters.archive && archive.nodes > 0 && !mobile ? (
            <p
              className="pointer-events-none absolute bottom-4 z-10 font-mono text-[11.5px] text-mute"
              style={{ left: insets.left + 16 }}
            >
              Dashed rings: {archiveCopy.graph.legend.toLowerCase()}
            </p>
          ) : null}

          {selectedOk ? (
            <DetailPanel
              invId={investigationId}
              data={data}
              nodeId={selectedOk}
              trail={trail}
              labelOf={labelOf}
              onStep={(id) => select(id, "step")}
              onTrail={toTrail}
              onClose={clear}
              archive={archiveNeighbours}
              mobile={mobile}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** The SVG export of what is on screen: hairline edges, glyph nodes, labels for the best connected and the selection. */
function svgOfView(
  sigma: NonNullable<ReturnType<typeof useGraph>["sigmaRef"]["current"]>,
  graph: NonNullable<ReturnType<typeof useGraph>["graphRef"]["current"]>,
  vis: NonNullable<ReturnType<typeof visibleFor>>,
  sel: string | null,
): string {
  const { width, height } = sigma.getDimensions();
  const nodes: SvgNode[] = [];
  const edges: SvgEdge[] = [];
  const inView = (p: { x: number; y: number }) =>
    p.x > -20 && p.y > -20 && p.x < width + 20 && p.y < height + 20;
  const pos = new Map<string, { x: number; y: number }>();
  graph.forEachNode((id, a) => {
    if (!a.archive && !vis.nodes.has(id)) return;
    const p = sigma.graphToViewport({ x: a.x as number, y: a.y as number });
    if (inView(p)) pos.set(id, p);
  });
  graph.forEachEdge((_e, a, s, t) => {
    if (!a.archiveEdge && !vis.edges.has(a.idx as number)) return;
    const p1 = pos.get(s);
    const p2 = pos.get(t);
    if (!p1 || !p2) return;
    const typed = a.rel !== EDGE_COOCCURRENCE;
    const near = sel !== null && (s === sel || t === sel);
    edges.push({
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      color: PAPER_HEX,
      width: near ? 1 : typed || a.archiveEdge ? 0.9 : 0.6,
      opacity: near ? 0.7 : a.archiveEdge ? 0.2 : typed ? 0.28 : 0.13,
    });
  });
  const labelled = new Set(
    [...pos.keys()]
      .sort(
        (a, b) =>
          (graph.getNodeAttribute(b, "degree") as number) - (graph.getNodeAttribute(a, "degree") as number),
      )
      .slice(0, Math.max(10, Math.ceil(pos.size * 0.05))),
  );
  if (sel) labelled.add(sel);
  const usedTypes = new Set<string>();
  const ratio = sigma.getCamera().ratio;
  for (const [id, p] of pos) {
    const a = graph.getNodeAttributes(id);
    if (!a.archive) usedTypes.add(a.etype as string);
    nodes.push({
      x: p.x,
      y: p.y,
      r: Math.max(2, ((a.size as number) / Math.sqrt(ratio)) * 0.9),
      color: id === sel ? V500_HEX : PAPER_HEX,
      opacity: id === sel ? 1 : a.archive ? 0.55 : (a.intensity as number),
      shape: a.archive ? ARCHIVE_GLYPH.shape : glyphFor(a.etype as string).shape,
      label: labelled.has(id) ? (a.label as string) : null,
    });
  }
  const legend = legendFor([...usedTypes]).map((l) => ({
    label: l.family,
    color: PAPER_HEX,
    shape: l.shape,
  }));
  if ([...pos.keys()].some((id) => graph.getNodeAttribute(id, "archive")))
    legend.push({ label: archiveCopy.graph.legend, color: PAPER_HEX, shape: ARCHIVE_GLYPH.shape });
  return buildSvg(width, height, nodes, edges, legend);
}
