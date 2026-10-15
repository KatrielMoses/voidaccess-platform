"use client";

import FA2Layout from "graphology-layout-forceatlas2/worker";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Graph from "graphology";
import Sigma from "sigma";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input, Skeleton } from "@voidaccess/ui";
import type { NodeLabelDrawingFunction } from "sigma/rendering";
import { EDGE_COOCCURRENCE, edgeKindLabel, edgeTypeLabel, typeStyle } from "@/lib/results/entity-style";
import { buildSvg, downloadSvg, exportPng, type SvgEdge, type SvgNode } from "@/lib/results/graph-export";
import {
  DEFAULT_FILTERS,
  EDGE,
  FIELD,
  LABEL,
  MUTED_INTENSITY,
  PAPER_HEX,
  SIGNAL_NODE,
  V500_HEX,
  computeVisible,
  isBig,
  nodeColor,
  nodeIntensity,
  nodeSize,
  seedPositions,
  typeCounts,
  type GraphFilterState,
} from "@/lib/results/graph-model";
import { ARCHIVE_GLYPH, glyphFor, legendFor } from "@/lib/results/glyphs";
import { NodeGlyphProgram } from "@/lib/results/node-glyph-program";
import { loadLayout, saveLayout } from "@/lib/results/layout-cache";
import type { GraphData } from "@/lib/results/types";
import { archiveCopy } from "@/lib/archive/copy";
import { formatDate } from "@/lib/results/format";
import { GraphControls } from "./graph-controls";
import { useArchiveOverlay, type MinTier } from "./use-archive-overlay";
import { TierBadge } from "./tier-badge";
import { NodePanel } from "./node-panel";
import { CloseButton } from "./ui";
import { ShapeGlyph } from "./type-glyph";

const LABEL_FONT = '"Geist Mono", ui-monospace, SFMono-Regular, monospace';

type LabelData = Parameters<NodeLabelDrawingFunction>[1] & { labelColor?: string };

/** Mono label beside the glyph, with a field-coloured halo so crossing hairlines don't cut through it. */
const drawLabel: NodeLabelDrawingFunction = (ctx, data, settings) => {
  if (!data.label) return;
  const d = data as LabelData;
  ctx.font = `${settings.labelWeight} ${settings.labelSize}px ${settings.labelFont}`;
  const x = data.x + data.size * 1.25 + 4;
  const y = data.y + settings.labelSize / 3;
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = FIELD;
  ctx.strokeText(data.label, x, y);
  ctx.fillStyle = d.labelColor ?? LABEL.base;
  ctx.fillText(data.label, x, y);
};
/** Hover: no box and no shadow, only the label in lavender (the node itself turns v-500 in the reducer). */
const drawHover: NodeLabelDrawingFunction = (ctx, data, settings) =>
  drawLabel(ctx, { ...data, labelColor: LABEL.focus } as LabelData, settings);

interface DebugHandle {
  sigma: Sigma;
  nodes: number;
  edges: number;
  readyMs: number;
}
declare global {
  interface Window {
    __vaGraph?: DebugHandle;
  }
}

export function GraphView({ investigationId }: { investigationId: string }) {
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState(false);
  const [filters, setFilters] = useState<GraphFilterState>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<string | null>(null);
  const [laying, setLaying] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState("");
  const [archiveOn, setArchiveOn] = useState(false);
  const [archiveHops, setArchiveHops] = useState<1 | 2>(1);
  const [archiveMinTier, setArchiveMinTier] = useState<MinTier>("unconfirmed");
  const [graphVersion, setGraphVersion] = useState(0);
  const [edgeTip, setEdgeTip] = useState<{ x: number; y: number; text: string } | null>(null);

  const container = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  // reducers read these refs so hover and filter changes don't re-render React
  const hovered = useRef<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const visibleRef = useRef<ReturnType<typeof computeVisible> | null>(null);
  const t0 = useRef(typeof performance !== "undefined" ? performance.now() : 0);

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

  const visible = useMemo(() => (data ? computeVisible(data, filters) : null), [data, filters]);
  const types = useMemo(() => (data ? typeCounts(data) : []), [data]);
  const big = data ? isBig(data) : false;
  const archive = useArchiveOverlay({
    investigationId,
    graphRef,
    sigmaRef,
    graphVersion,
    on: archiveOn,
    hops: archiveHops,
    minTier: archiveMinTier,
  });

  useEffect(() => {
    visibleRef.current = visible;
    selectedRef.current = selected;
    sigmaRef.current?.refresh();
  }, [visible, selected]);

  // build graph + sigma once per data load
  useEffect(() => {
    if (!data || !container.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ids = data.nodes.map((n) => n[0]);
    const cached = loadLayout(investigationId, ids);
    const seeds = seedPositions(data);
    const maxDegree = data.nodes.reduce((m, n) => Math.max(m, n[4]), 1);

    const graph = new Graph({ multi: true, type: "undirected" });
    for (const [id, type, label, confidence, degree, community, sensitive] of data.nodes) {
      const p = cached?.get(id) ?? ([seeds.get(id)!.x, seeds.get(id)!.y] as [number, number]);
      graph.addNode(id, {
        x: p[0],
        y: p[1],
        size: nodeSize(degree),
        label,
        etype: type,
        confidence,
        degree,
        community,
        sensitive,
        shape: glyphFor(type).shape,
        intensity: nodeIntensity(degree, maxDegree),
        color: nodeColor(nodeIntensity(degree, maxDegree)),
      });
    }
    data.edges.forEach(([s, t, type, w], i) => {
      if (graph.hasNode(s) && graph.hasNode(t))
        graph.addEdgeWithKey(`e${i}`, s, t, { type: "line", rel: type, weight: w, idx: i });
    });
    graphRef.current = graph;

    const sigma = new Sigma(graph, container.current, {
      renderEdgeLabels: false,
      enableEdgeEvents: data.edges.length <= 8000,
      defaultNodeType: "glyph",
      nodeProgramClasses: { glyph: NodeGlyphProgram },
      defaultDrawNodeLabel: drawLabel,
      defaultDrawNodeHover: drawHover,
      labelFont: LABEL_FONT,
      labelSize: 11,
      labelWeight: "400",
      labelRenderedSizeThreshold: 9,
      labelDensity: 0.6,
      labelColor: { color: LABEL.base },
      defaultEdgeColor: EDGE.cooccurrence,
      minEdgeThickness: 1,
      minCameraRatio: 0.03,
      maxCameraRatio: 12,
      zIndex: true,
      hideEdgesOnMove: data.edges.length > 5000,
      hideLabelsOnMove: true,
      // hover and selection are the one violet thing: the focused node, its edges and its label
      nodeReducer: (node, attrs) => {
        const vis = visibleRef.current;
        if (!attrs.archive && vis && !vis.nodes.has(node)) return { ...attrs, hidden: true };
        const out = { ...attrs } as Record<string, unknown>;
        const focus = hovered.current ?? selectedRef.current;
        if (node === focus || node === selectedRef.current) {
          out.color = SIGNAL_NODE;
          out.labelColor = LABEL.focus;
          out.zIndex = 3;
          out.forceLabel = true;
        } else if (focus && !graph.areNeighbors(node, focus)) {
          out.color = nodeColor(MUTED_INTENSITY);
          out.label = null;
        } else if (focus) {
          out.color = nodeColor(Math.max(0.86, attrs.intensity as number));
          out.labelColor = LABEL.near;
          out.zIndex = 2;
          out.forceLabel = true;
        }
        if (node === selectedRef.current) out.highlighted = true;
        return out;
      },
      edgeReducer: (edge, attrs) => {
        const vis = visibleRef.current;
        const focus = hovered.current ?? selectedRef.current;
        const touches = focus ? graph.hasExtremity(edge, focus) : false;
        if (attrs.archiveEdge) {
          return {
            ...attrs,
            color: focus ? (touches ? EDGE.signalSoft : EDGE.muted) : EDGE.archive,
            size: 1.2,
          };
        }
        if (vis && !vis.edges.has(attrs.idx as number)) return { ...attrs, hidden: true };
        const typed = attrs.rel !== EDGE_COOCCURRENCE;
        const out: Record<string, unknown> = {
          ...attrs,
          color: typed ? EDGE.typed : EDGE.cooccurrence,
          size: typed ? 1 : 0.6,
        };
        if (focus && !touches) out.color = EDGE.muted;
        else if (focus) {
          out.color = typed ? EDGE.signal : EDGE.signalSoft;
          out.size = typed ? 1.4 : 1;
        }
        return out;
      },
    });
    // labels are drawn on a 2D canvas: repaint once Geist Mono is ready
    void document.fonts?.load(`11px ${LABEL_FONT}`).then(() => sigmaRef.current === sigma && sigma.refresh());
    sigmaRef.current = sigma;
    setGraphVersion((v) => v + 1);
    sigma.on("enterNode", ({ node }) => {
      hovered.current = node;
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("leaveNode", () => {
      hovered.current = null;
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("clickNode", ({ node }) => setSelected(node));
    sigma.on("clickStage", () => setSelected(null));
    sigma.on("enterEdge", ({ edge, event }) => {
      const rel = graph.getEdgeAttribute(edge, "rel") as string;
      const ae = graph.getEdgeAttribute(edge, "archiveEdge") as
        | { evidence: number; independentSources: number; firstSeen: string; lastSeen: string; tier: string }
        | undefined;
      if (ae) {
        setEdgeTip({
          x: event.x,
          y: event.y,
          text: `${edgeTypeLabel(rel)} (${edgeKindLabel(rel)}, a lead) · ${ae.evidence} ${ae.evidence === 1 ? "page" : "pages"} · ${ae.independentSources} independent ${ae.independentSources === 1 ? "site" : "sites"} · ${formatDate(ae.firstSeen)} to ${formatDate(ae.lastSeen)} · ${ae.tier.replace("_", " ")}`,
        });
        return;
      }
      setEdgeTip({ x: event.x, y: event.y, text: `${edgeTypeLabel(rel)}: ${edgeKindLabel(rel)}` });
    });
    sigma.on("leaveEdge", () => setEdgeTip(null));

    const markReady = () => {
      setLaying(false);
      if (process.env.NODE_ENV !== "production")
        window.__vaGraph = {
          sigma,
          nodes: graph.order,
          edges: graph.size,
          readyMs: Math.round(performance.now() - t0.current),
        };
      sigma.refresh();
    };

    let layout: FA2Layout | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (cached) {
      markReady();
    } else {
      const n = graph.order;
      const settings = {
        ...forceAtlas2.inferSettings(graph),
        barnesHutOptimize: n > 800,
        slowDown: n > 2000 ? 4 : 2,
        gravity: 0.6,
        scalingRatio: n > 1000 ? 14 : 8,
      };
      layout = new FA2Layout(graph, { settings });
      const duration = Math.min(1200 + n * 1.2, 7000);
      if (reduced) setLaying(true);
      else setLaying(false); // animated: show the graph settling
      layout.start();
      timer = setTimeout(() => {
        layout?.stop();
        saveLayout(investigationId, ids, (id) => [
          graph.getNodeAttribute(id, "x") as number,
          graph.getNodeAttribute(id, "y") as number,
        ]);
        markReady();
      }, duration);
      if (!reduced && process.env.NODE_ENV !== "production")
        window.__vaGraph = { sigma, nodes: graph.order, edges: graph.size, readyMs: -1 };
    }

    return () => {
      if (timer) clearTimeout(timer);
      layout?.kill();
      sigma.kill();
      sigmaRef.current = null;
      graphRef.current = null;
      if (typeof window !== "undefined") delete window.__vaGraph;
    };
  }, [data, investigationId]);

  const focusNode = useCallback((id: string) => {
    const sigma = sigmaRef.current;
    const g = graphRef.current;
    if (!sigma || !g || !g.hasNode(id)) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pos = sigma.getNodeDisplayData(id);
    if (pos) sigma.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.12 }, { duration: reduced ? 0 : 400 });
    setSelected(id);
  }, []);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !data) return [];
    return data.nodes
      .filter((n) => n[2].toLowerCase().includes(q))
      .sort((a, b) => b[4] - a[4])
      .slice(0, 8);
  }, [search, data]);

  const reset = () => {
    sigmaRef.current?.getCamera().animatedReset({ duration: 250 });
    setSelected(null);
    setFilters(DEFAULT_FILTERS);
  };

  const onPng = async () => {
    if (!sigmaRef.current) return;
    setExporting(true);
    try {
      await exportPng(sigmaRef.current, `voidaccess-${investigationId.slice(0, 8)}-graph.png`);
    } finally {
      setExporting(false);
    }
  };

  const onSvg = () => {
    const sigma = sigmaRef.current;
    const g = graphRef.current;
    const vis = visibleRef.current;
    if (!sigma || !g || !vis) return;
    const { width, height } = sigma.getDimensions();
    const nodes: SvgNode[] = [];
    const edges: SvgEdge[] = [];
    const inView = (p: { x: number; y: number }) =>
      p.x > -20 && p.y > -20 && p.x < width + 20 && p.y < height + 20;
    const pos = new Map<string, { x: number; y: number }>();
    g.forEachNode((id, a) => {
      if (!a.archive && !vis.nodes.has(id)) return;
      const p = sigma.graphToViewport({ x: a.x as number, y: a.y as number });
      if (inView(p)) pos.set(id, p);
    });
    const sel = selectedRef.current;
    g.forEachEdge((_e, a, s, t) => {
      if (!a.archiveEdge && !vis.edges.has(a.idx as number)) return;
      const p1 = pos.get(s);
      const p2 = pos.get(t);
      if (!p1 || !p2) return;
      const typed = a.rel !== EDGE_COOCCURRENCE;
      const signal = sel !== null && (s === sel || t === sel);
      edges.push({
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        color: signal ? V500_HEX : PAPER_HEX,
        width: signal ? 1.2 : typed || a.archiveEdge ? 1 : 0.6,
        opacity: signal ? 0.9 : a.archiveEdge ? 0.24 : typed ? 0.36 : 0.16,
      });
    });
    const top = [...pos.keys()]
      .sort(
        (a, b) => (g.getNodeAttribute(b, "degree") as number) - (g.getNodeAttribute(a, "degree") as number),
      )
      .slice(0, 25);
    const labelled = new Set(top);
    if (sel) labelled.add(sel);
    const usedTypes = new Set<string>();
    const ratio = sigma.getCamera().ratio;
    for (const [id, p] of pos) {
      const a = g.getNodeAttributes(id);
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
    if ([...pos.keys()].some((id) => g.getNodeAttribute(id, "archive")))
      legend.push({ label: archiveCopy.graph.legend, color: PAPER_HEX, shape: ARCHIVE_GLYPH.shape });
    downloadSvg(
      buildSvg(width, height, nodes, edges, legend),
      `voidaccess-${investigationId.slice(0, 8)}-graph.svg`,
    );
  };

  if (error) return <p className="text-[15px] text-paper">Couldn&apos;t load the graph. Try again.</p>;
  if (!data || !visible)
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton className="h-10" />
        <Skeleton className="h-[60vh]" />
      </div>
    );
  if (data.nodes.length === 0) return <p className="text-dim">This run has no entities to graph.</p>;

  const legend = legendFor(types.map(([t]) => t));
  return (
    <div className="flex flex-col gap-5">
      <GraphControls
        filters={filters}
        onChange={setFilters}
        types={types}
        big={big}
        truncated={visible.truncated}
        totalNodes={data.nodes.length}
        visibleNodes={visible.nodes.size}
        visibleEdges={visible.edges.size}
        onReset={reset}
        onExportPng={onPng}
        onExportSvg={onSvg}
        exporting={exporting}
        tableHref={`/investigations/${investigationId}/results/entities`}
        archive={{
          on: archiveOn,
          onToggle: setArchiveOn,
          hops: archiveHops,
          onHops: setArchiveHops,
          minTier: archiveMinTier,
          onMinTier: setArchiveMinTier,
          loading: archive.loading,
          nodes: archive.nodes,
          truncated: archive.truncated,
          failed: archive.failed,
        }}
      />
      <div className="relative">
        <label className="mb-3 flex max-w-sm flex-col gap-1.5 text-[13px] text-dim">
          Find a node
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search values, then pick one to focus"
            data-testid="graph-search"
          />
        </label>
        {matches.length > 0 ? (
          <ul
            role="listbox"
            aria-label="Matching nodes"
            className="absolute z-10 -mt-2 max-h-60 w-full max-w-sm overflow-auto rounded-sm border border-line-2 bg-bg-2 py-1"
          >
            {matches.map((n) => (
              <li key={n[0]} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors duration-300 hover:bg-bar"
                  onClick={() => (focusNode(n[0]), setSearch(""))}
                >
                  <span className="truncate font-mono text-[13px] text-paper">{n[2]}</span>
                  <span className="flex shrink-0 items-center gap-1.5 font-mono text-[12px] text-mute">
                    <ShapeGlyph shape={glyphFor(n[1]).shape} />
                    {typeStyle(n[1]).label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="grid overflow-hidden rounded-lg border border-line lg:grid-cols-[1fr_22rem]">
          <div className="flex min-w-0 flex-col">
            <div className="relative bg-bg">
              <div
                ref={container}
                role="img"
                aria-label={`Identity graph with ${data.nodes.length} nodes and ${data.edges.length} edges. Use the Entities tab for an accessible table of the same data.`}
                data-testid="graph-canvas"
                className="h-[min(65vh,42rem)] min-h-[22rem] w-full bg-bg"
              />
              {laying ? (
                <div
                  className="absolute inset-0 flex items-center justify-center bg-bg/80 font-mono text-[13px] text-dim"
                  role="status"
                >
                  Arranging graph…
                </div>
              ) : null}
              {edgeTip ? (
                <div
                  data-testid="edge-tip"
                  className="pointer-events-none absolute max-w-xs rounded-xs border border-line-2 bg-bg-2 px-2.5 py-1.5 font-mono text-[12px] leading-snug text-dim"
                  style={{ left: edgeTip.x + 12, top: edgeTip.y + 12 }}
                >
                  {edgeTip.text}
                </div>
              ) : null}
            </div>
            <ul
              aria-label="Legend"
              className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-4 py-3 font-mono text-[12px] text-mute"
            >
              {legend.map((l) => (
                <li key={l.family} className="flex items-center gap-1.5">
                  <ShapeGlyph shape={l.shape} className="text-paper/80" />
                  {l.family}
                </li>
              ))}
              {archiveOn ? (
                <li className="flex items-center gap-1.5">
                  <ShapeGlyph shape={ARCHIVE_GLYPH.shape} className="text-paper/80" />
                  {ARCHIVE_GLYPH.family}
                </li>
              ) : null}
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="h-px w-4 bg-paper/30" />
                typed (lead)
              </li>
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="h-px w-4 bg-paper/15" />
                co-occurrence
              </li>
            </ul>
          </div>
          <div className="min-w-0 border-t border-line lg:border-t-0 lg:border-l">
            {selected?.startsWith("arc:") && graphRef.current?.hasNode(selected) ? (
              <ArchiveNodeCard
                attrs={
                  graphRef.current.getNodeAttributes(selected) as {
                    label: string;
                    etype: string;
                    tier: "unconfirmed" | "corroborated" | "feed_validated";
                  }
                }
                onClose={() => setSelected(null)}
              />
            ) : selected ? (
              <NodePanel
                invId={investigationId}
                data={data}
                nodeId={selected}
                onSelect={focusNode}
                onClose={() => setSelected(null)}
              />
            ) : (
              <div className="flex h-full flex-col gap-3 p-5 text-[15px] text-dim">
                <p className="font-mono text-[12px] text-mute">No node selected</p>
                <p>
                  Click a node to see its details, sources and connections. Hover to highlight its
                  neighbourhood. Edges are leads, not facts.
                </p>
                <p className="text-[13px] text-mute">
                  Brighter, larger nodes have more connections. Shapes show the kind of entity.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ArchiveNodeCard({
  attrs,
  onClose,
}: {
  attrs: { label: string; etype: string; tier: "unconfirmed" | "corroborated" | "feed_validated" };
  onClose: () => void;
}) {
  return (
    <aside
      aria-label="Archive node"
      data-testid="archive-node-card"
      className="flex flex-col gap-4 p-5 text-[14px]"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-[17px] font-medium tracking-[-0.01em]">{archiveCopy.title}</h3>
        <CloseButton onClick={onClose} label="Close" />
      </div>
      <code className="font-mono text-[14px] break-all text-paper">{attrs.label}</code>
      <p className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 font-mono text-[12px] text-dim">
          <ShapeGlyph shape={ARCHIVE_GLYPH.shape} />
          {typeStyle(attrs.etype).label}
        </span>
        <TierBadge tier={attrs.tier} />
      </p>
      <p className="text-[13px] text-dim">{archiveCopy.graph.nodeNote}</p>
    </aside>
  );
}
