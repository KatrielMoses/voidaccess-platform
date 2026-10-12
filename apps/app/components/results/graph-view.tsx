"use client";

import FA2Layout from "graphology-layout-forceatlas2/worker";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Graph from "graphology";
import Sigma from "sigma";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input, Skeleton } from "@voidaccess/ui";
import { EDGE_COOCCURRENCE, edgeKindLabel, edgeTypeLabel, typeStyle } from "@/lib/results/entity-style";
import { buildSvg, downloadSvg, exportPng, type SvgEdge, type SvgNode } from "@/lib/results/graph-export";
import {
  DEFAULT_FILTERS,
  TOKEN_FALLBACK,
  communityColor,
  computeVisible,
  isBig,
  nodeSize,
  seedPositions,
  typeCounts,
  type GraphFilterState,
} from "@/lib/results/graph-model";
import { loadLayout, saveLayout } from "@/lib/results/layout-cache";
import type { GraphData } from "@/lib/results/types";
import { archiveCopy } from "@/lib/archive/copy";
import { formatDate } from "@/lib/results/format";
import { GraphControls } from "./graph-controls";
import {
  ARCHIVE_EDGE_COLOR,
  ARCHIVE_NODE_COLOR,
  useArchiveOverlay,
  type MinTier,
} from "./use-archive-overlay";
import { TierBadge } from "./tier-badge";
import { NodePanel } from "./node-panel";

const DIM = "rgba(110,118,129,0.12)";
const COOC = "rgba(255,255,255,0.07)";
const TYPED = "rgba(155,159,238,0.8)";

function cssColor(type: string): string {
  const v = typeStyle(type).cssVar;
  const live =
    typeof document !== "undefined"
      ? getComputedStyle(document.documentElement).getPropertyValue(v).trim()
      : "";
  return live || TOKEN_FALLBACK[v] || "#6e7681";
}

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
  const [communityColors, setCommunityColors] = useState(false);
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
  const communityRef = useRef(false);
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
    communityRef.current = communityColors;
    selectedRef.current = selected;
    sigmaRef.current?.refresh();
  }, [visible, communityColors, selected]);

  // build graph + sigma once per data load
  useEffect(() => {
    if (!data || !container.current) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ids = data.nodes.map((n) => n[0]);
    const cached = loadLayout(investigationId, ids);
    const seeds = seedPositions(data);
    const colors = new Map(types.map(([t]) => [t, cssColor(t)]));

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
        color: colors.get(type) ?? "#6e7681",
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
      labelRenderedSizeThreshold: 9,
      labelDensity: 0.6,
      labelColor: { color: "#c9d1d9" },
      defaultEdgeColor: COOC,
      minCameraRatio: 0.03,
      maxCameraRatio: 12,
      zIndex: true,
      hideEdgesOnMove: data.edges.length > 5000,
      hideLabelsOnMove: true,
      nodeReducer: (node, attrs) => {
        const vis = visibleRef.current;
        if (!attrs.archive && vis && !vis.nodes.has(node)) return { ...attrs, hidden: true };
        const out = { ...attrs } as Record<string, unknown>;
        if (communityRef.current) out.color = communityColor(attrs.community as number | null);
        const focus = hovered.current ?? selectedRef.current;
        if (focus && node !== focus && !graph.areNeighbors(node, focus)) {
          out.color = DIM;
          out.label = null;
        } else if (focus) {
          out.zIndex = 2;
          out.forceLabel = true;
        }
        if (node === selectedRef.current) out.highlighted = true;
        return out;
      },
      edgeReducer: (edge, attrs) => {
        const vis = visibleRef.current;
        if (attrs.archiveEdge) {
          const f = hovered.current ?? selectedRef.current;
          return {
            ...attrs,
            color: f && !graph.hasExtremity(edge, f) ? "rgba(217,164,65,0.06)" : ARCHIVE_EDGE_COLOR,
            size: 1.2,
          };
        }
        if (vis && !vis.edges.has(attrs.idx as number)) return { ...attrs, hidden: true };
        const typed = attrs.rel !== EDGE_COOCCURRENCE;
        const focus = hovered.current ?? selectedRef.current;
        const out: Record<string, unknown> = {
          ...attrs,
          color: typed ? TYPED : COOC,
          size: typed ? 1.6 : 0.5,
        };
        if (focus && !graph.hasExtremity(edge, focus)) out.color = "rgba(110,118,129,0.04)";
        else if (focus) {
          out.color = typed ? "#9b9fee" : "rgba(255,255,255,0.35)";
          out.size = typed ? 2.2 : 1;
        }
        return out;
      },
    });
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
    g.forEachEdge((_e, a, s, t) => {
      if (!a.archiveEdge && !vis.edges.has(a.idx as number)) return;
      const p1 = pos.get(s);
      const p2 = pos.get(t);
      if (!p1 || !p2) return;
      const typed = a.rel !== EDGE_COOCCURRENCE;
      edges.push({
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        color: a.archiveEdge ? ARCHIVE_NODE_COLOR : typed ? "#9b9fee" : "#ffffff",
        width: a.archiveEdge ? 1.2 : typed ? 1.4 : 0.4,
      });
    });
    const top = [...pos.keys()]
      .sort(
        (a, b) => (g.getNodeAttribute(b, "degree") as number) - (g.getNodeAttribute(a, "degree") as number),
      )
      .slice(0, 25);
    const labelled = new Set(top);
    const usedTypes = new Set<string>();
    for (const [id, p] of pos) {
      const a = g.getNodeAttributes(id);
      if (!a.archive) usedTypes.add(a.etype as string);
      const ratio = sigma.getCamera().ratio;
      nodes.push({
        x: p.x,
        y: p.y,
        r: Math.max(2, ((a.size as number) / Math.sqrt(ratio)) * 0.9),
        color: a.archive
          ? ARCHIVE_NODE_COLOR
          : communityRef.current
            ? communityColor(a.community as number | null)
            : (a.color as string),
        label: labelled.has(id) ? (a.label as string) : null,
      });
    }
    const legend = [...usedTypes].slice(0, 8).map((t) => ({ label: typeStyle(t).label, color: cssColor(t) }));
    if ([...pos.keys()].some((id) => g.getNodeAttribute(id, "archive")))
      legend.push({ label: archiveCopy.graph.legend, color: ARCHIVE_NODE_COLOR });
    downloadSvg(
      buildSvg(width, height, nodes, edges, legend),
      `voidaccess-${investigationId.slice(0, 8)}-graph.svg`,
    );
  };

  if (error) return <p className="text-sm text-danger">Couldn&apos;t load the graph. Try again.</p>;
  if (!data || !visible)
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton className="h-10" />
        <Skeleton className="h-[60vh]" />
      </div>
    );
  if (data.nodes.length === 0) return <p className="text-fg-secondary">This run has no entities to graph.</p>;

  return (
    <div className="flex flex-col gap-4">
      <GraphControls
        filters={filters}
        onChange={setFilters}
        types={types}
        communityColors={communityColors}
        onCommunityColors={setCommunityColors}
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
        cssColor={cssColor}
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
          color: ARCHIVE_NODE_COLOR,
        }}
      />
      <div className="relative">
        <label className="mb-2 flex max-w-sm flex-col gap-1 text-xs text-fg-secondary">
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
            className="absolute z-10 -mt-1 max-h-60 w-full max-w-sm overflow-auto rounded-md border border-border-subtle bg-overlay p-1 shadow-xl"
          >
            {matches.map((n) => (
              <li key={n[0]} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent-dim focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() => (focusNode(n[0]), setSearch(""))}
                >
                  <span className="truncate font-mono">{n[2]}</span>
                  <span className="shrink-0 text-fg-secondary">{typeStyle(n[1]).label}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
          <div className="relative overflow-hidden rounded-lg border border-border-subtle bg-void">
            <div
              ref={container}
              role="img"
              aria-label={`Identity graph with ${data.nodes.length} nodes and ${data.edges.length} edges. Use the Entities tab for an accessible table of the same data.`}
              data-testid="graph-canvas"
              className="h-[min(65vh,42rem)] min-h-[22rem] w-full"
            />
            {laying ? (
              <div
                className="absolute inset-0 flex items-center justify-center bg-void/80 text-sm text-fg-secondary"
                role="status"
              >
                Arranging graph…
              </div>
            ) : null}
            {edgeTip ? (
              <div
                data-testid="edge-tip"
                className="pointer-events-none absolute rounded border border-border-subtle bg-overlay px-2 py-1 text-xs"
                style={{ left: edgeTip.x + 12, top: edgeTip.y + 12 }}
              >
                {edgeTip.text}
              </div>
            ) : null}
          </div>
          <div>
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
              <p className="rounded-lg border border-dashed border-border-strong p-4 text-sm text-fg-secondary">
                Click a node to see its details, sources and connections. Hover to highlight its
                neighbourhood. Edges are leads, not facts.
              </p>
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
      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4 text-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display text-base font-semibold">{archiveCopy.title}</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="text-fg-secondary hover:text-fg focus-visible:outline-2 focus-visible:outline-accent"
        >
          ✕
        </button>
      </div>
      <code className="break-all rounded bg-void px-2 py-1.5 font-mono text-xs">{attrs.label}</code>
      <p className="flex items-center gap-2">
        <span className="text-fg-secondary">{typeStyle(attrs.etype).label}</span>
        <TierBadge tier={attrs.tier} />
      </p>
      <p className="text-xs text-fg-secondary">{archiveCopy.graph.nodeNote}</p>
    </aside>
  );
}
