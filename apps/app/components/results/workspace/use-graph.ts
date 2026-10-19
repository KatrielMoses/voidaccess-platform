"use client";
/**
 * The workspace's graph engine (P9-8): graphology + sigma 3 with the glyph node program, a deterministic layout in
 * a web worker (lib/results/layout.worker.ts) cached per investigation, and reducers that read one mutable view
 * state, so hover, search and selection repaint without React renders.
 *
 * Colour rule (design.md): the ONE violet thing is the selected node. Hover and search brighten in paper; everything
 * outside the focus dims. Edges are hairlines in the line tone; the focus neighbourhood's edges brighten in paper.
 */
import Graph from "graphology";
import Sigma from "sigma";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { NodeLabelDrawingFunction } from "sigma/rendering";
import { EDGE_COOCCURRENCE, edgeKindLabel, edgeTypeLabel } from "@/lib/results/entity-style";
import { formatDate } from "@/lib/results/format";
import { glyphFor } from "@/lib/results/glyphs";
import {
  FIELD,
  LABEL,
  MUTED_INTENSITY,
  SIGNAL_NODE,
  nodeColor,
  nodeIntensity,
  nodeSize,
  seedPositions,
  type Visible,
} from "@/lib/results/graph-model";
import { loadLayout, saveLayout } from "@/lib/results/layout-cache";
import { NodeGlyphProgram } from "@/lib/results/node-glyph-program";
import type { LayoutRequest, LayoutResponse } from "@/lib/results/layout-params";
import { middleTruncate } from "@/lib/results/search";
import type { GraphData } from "@/lib/results/types";
import { LABEL_W_PX, SMALL_GRAPH_LABEL_ALL, labelClearance, minFitRatio } from "@/lib/results/small-results";

export const LABEL_FONT = '"Geist Mono", ui-monospace, SFMono-Regular, monospace';

/** Premultiplied paper at alpha `a` (sigma's WebGL layers blend premultiplied colour). */
const paper = (a: number) =>
  `rgba(${Math.round(243 * a)},${Math.round(241 * a)},${Math.round(236 * a)},${a})`;
export const EDGES = {
  cooccurrence: paper(0.13),
  typed: paper(0.28),
  muted: paper(0.03),
  near: paper(0.62),
  nearTyped: paper(0.85),
} as const;

/** What the reducers draw. Mutated in place; call `repaint()` after changing it. */
export interface ViewState {
  hovered: string | null;
  selected: string | null;
  /** search matches (null = no search) */
  matches: ReadonlySet<string> | null;
  /** the active match (↑/↓) */
  active: string | null;
  visible: Visible | null;
}

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
/** Hover: no box, no shadow; the label in paper. */
const drawHover: NodeLabelDrawingFunction = (ctx, data, settings) =>
  drawLabel(
    ctx,
    { ...data, labelColor: (data as LabelData).labelColor ?? LABEL.near } as LabelData,
    settings,
  );

export interface GraphStats {
  nodes: number;
  edges: number;
  /** ms from data to first paint */
  firstPaintMs: number;
  /** worker layout time (null when the cached layout was used) */
  layoutMs: number | null;
  cached: boolean;
}
declare global {
  interface Window {
    /** dev/test probe: readyMs is -1 while the layout is still running */
    __vaGraph?: { sigma: Sigma; nodes: number; edges: number; readyMs: number; stats: GraphStats };
  }
}

/** Pixels covered by floating panels (sidebar left, detail right, bottom sheet on mobile). */
export interface Insets {
  left: number;
  right: number;
  bottom?: number;
}

export interface GraphEngine {
  sigmaRef: RefObject<Sigma | null>;
  graphRef: RefObject<Graph | null>;
  view: ViewState;
  repaint: () => void;
  /** ease the camera to a node so it sits in the middle of the area not covered by panels */
  focus: (id: string, insets: Insets) => void;
  fit: (insets: Insets) => void;
  zoom: (factor: number) => void;
  /** bumps when the graph is (re)built (the archive overlay re-applies) */
  version: number;
  laying: boolean;
  stats: GraphStats | null;
}

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useGraph(opts: {
  container: RefObject<HTMLDivElement | null>;
  data: GraphData | null;
  investigationId: string;
  onClickNode: (id: string) => void;
  onClickStage: () => void;
  onHoverNode: (id: string | null) => void;
  /** an edge under the pointer: its kind, and the archive evidence for archive leads (null when it leaves) */
  onHoverEdge?: (tip: { x: number; y: number; text: string } | null) => void;
}): GraphEngine {
  const { container, data, investigationId } = opts;
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const view = useRef<ViewState>({
    hovered: null,
    selected: null,
    matches: null,
    active: null,
    visible: null,
  });
  const cb = useRef(opts);
  cb.current = opts;
  const [version, setVersion] = useState(0);
  const [laying, setLaying] = useState(false);
  const [stats, setStats] = useState<GraphStats | null>(null);

  useEffect(() => {
    const el = container.current;
    if (!data || !el) return;
    const t0 = performance.now();
    const ids = data.nodes.map((n) => n[0]);
    const cached = loadLayout(investigationId, ids);
    const seeds = cached ? null : seedPositions(data);
    const maxDegree = data.nodes.reduce((m, n) => Math.max(m, n[4]), 1);
    // big graphs get smaller glyphs so clusters read as clusters, not as one solid mass
    const sizeScale = data.nodes.length > 1000 ? 0.55 : data.nodes.length > 300 ? 0.75 : 1;
    // a small result names every value: there's room, and bare dots read as a broken graph
    const labelAll = data.nodes.length <= SMALL_GRAPH_LABEL_ALL;

    const graph = new Graph({ multi: true, type: "undirected" });
    for (const [id, type, label, confidence, degree, community, sensitive] of data.nodes) {
      const p = cached?.get(id) ?? [seeds!.get(id)!.x, seeds!.get(id)!.y];
      const intensity = nodeIntensity(degree, maxDegree);
      graph.addNode(id, {
        x: p[0],
        y: p[1],
        size: nodeSize(degree) * sizeScale,
        // canvas labels are cut in the middle (onion addresses, hashes); the panels show the full value
        label: middleTruncate(label, 30),
        etype: type,
        confidence,
        degree,
        community,
        sensitive,
        shape: glyphFor(type).shape,
        intensity,
        color: nodeColor(intensity),
      });
    }
    data.edges.forEach(([s, t, type, w], i) => {
      if (graph.hasNode(s) && graph.hasNode(t))
        graph.addEdgeWithKey(`e${i}`, s, t, { type: "line", rel: type, weight: w, idx: i });
    });
    graphRef.current = graph;
    const v = view.current;

    // the focus set: the hovered (or selected) node and its neighbours
    let focusKey: string | null = null;
    let focusSet = new Set<string>();
    const focusOf = () => {
      const f = v.hovered ?? v.selected;
      if (f !== focusKey) {
        focusKey = f;
        focusSet = f && graph.hasNode(f) ? new Set([f, ...graph.neighbors(f)]) : new Set();
      }
      return f;
    };

    const sigma = new Sigma(graph, el, {
      renderEdgeLabels: false,
      enableEdgeEvents: data.edges.length <= 8000,
      defaultNodeType: "glyph",
      nodeProgramClasses: { glyph: NodeGlyphProgram },
      defaultDrawNodeLabel: drawLabel,
      defaultDrawNodeHover: drawHover,
      labelFont: LABEL_FONT,
      labelSize: 11,
      labelWeight: "400",
      // the label grid shows at most one label per cell, biggest (best connected) first: labels never overlap
      labelGridCellSize: 120,
      labelDensity: 0.9,
      labelRenderedSizeThreshold: 7,
      labelColor: { color: LABEL.base },
      defaultEdgeColor: EDGES.cooccurrence,
      minEdgeThickness: 1,
      minCameraRatio: 0.02,
      maxCameraRatio: 8,
      zIndex: true,
      hideEdgesOnMove: data.edges.length > 12000,
      hideLabelsOnMove: false,
      stagePadding: 40,
      nodeReducer: (node, attrs) => {
        const vis = v.visible;
        if (!attrs.archive && vis && !vis.nodes.has(node)) return { ...attrs, hidden: true };
        const out = { ...attrs } as Record<string, unknown>;
        const f = focusOf();
        if (node === v.selected) {
          out.color = SIGNAL_NODE; // the one violet thing
          out.labelColor = LABEL.focus;
          out.zIndex = 4;
          out.forceLabel = true;
          out.highlighted = true;
          return out;
        }
        if (f) {
          if (node === f) {
            out.color = nodeColor(1);
            out.labelColor = LABEL.near;
            out.zIndex = 3;
            out.forceLabel = true;
          } else if (focusSet.has(node)) {
            out.color = nodeColor(Math.max(0.86, attrs.intensity as number));
            out.labelColor = LABEL.near;
            out.zIndex = 2;
            out.forceLabel = focusSet.size <= 40;
          } else {
            out.color = nodeColor(MUTED_INTENSITY);
            out.label = null;
          }
          return out;
        }
        if (v.matches) {
          if (v.matches.has(node)) {
            out.color = nodeColor(node === v.active ? 1 : 0.9);
            out.labelColor = node === v.active ? "rgba(243,241,236,1)" : LABEL.near;
            out.zIndex = node === v.active ? 3 : 2;
            out.forceLabel = node === v.active || v.matches.size <= 30;
          } else {
            out.color = nodeColor(MUTED_INTENSITY);
            out.label = null;
          }
        }
        if (labelAll) out.forceLabel = true;
        return out;
      },
      edgeReducer: (edge, attrs) => {
        const vis = v.visible;
        const f = focusOf();
        if (attrs.archiveEdge) {
          const touches = f ? graph.hasExtremity(edge, f) : false;
          return { ...attrs, color: f ? (touches ? EDGES.near : EDGES.muted) : paper(0.2), size: 1 };
        }
        if (vis && !vis.edges.has(attrs.idx as number)) return { ...attrs, hidden: true };
        const typed = attrs.rel !== EDGE_COOCCURRENCE;
        const out: Record<string, unknown> = {
          ...attrs,
          color: typed ? EDGES.typed : EDGES.cooccurrence,
          size: typed ? 0.9 : 0.6,
        };
        if (f) {
          if (graph.hasExtremity(edge, f)) {
            out.color = typed ? EDGES.nearTyped : EDGES.near;
            out.size = 1;
          } else out.color = EDGES.muted;
        } else if (v.matches) {
          const [s, t] = graph.extremities(edge);
          out.color = v.matches.has(s) || v.matches.has(t) ? EDGES.near : EDGES.muted;
        }
        return out;
      },
    });
    sigmaRef.current = sigma;
    // labels are drawn on a 2D canvas: repaint once Geist Mono is ready
    void document.fonts?.load(`11px ${LABEL_FONT}`).then(() => sigmaRef.current === sigma && sigma.refresh());

    sigma.on("enterNode", ({ node }) => {
      v.hovered = node;
      el.style.cursor = "pointer";
      cb.current.onHoverNode(node);
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("leaveNode", () => {
      v.hovered = null;
      el.style.cursor = "";
      cb.current.onHoverNode(null);
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("clickNode", ({ node }) => cb.current.onClickNode(node));
    sigma.on("enterEdge", ({ edge, event }) => {
      const rel = graph.getEdgeAttribute(edge, "rel") as string;
      const ae = graph.getEdgeAttribute(edge, "archiveEdge") as
        | { evidence: number; independentSources: number; firstSeen: string; lastSeen: string; tier: string }
        | undefined;
      const text = ae
        ? `${edgeTypeLabel(rel)} (${edgeKindLabel(rel)}, a lead) · ${ae.evidence} ${ae.evidence === 1 ? "page" : "pages"} · ${ae.independentSources} independent ${ae.independentSources === 1 ? "site" : "sites"} · ${formatDate(ae.firstSeen)} to ${formatDate(ae.lastSeen)} · ${ae.tier.replace("_", " ")}`
        : `${edgeTypeLabel(rel)}: ${edgeKindLabel(rel)}`;
      cb.current.onHoverEdge?.({ x: event.x, y: event.y, text });
    });
    sigma.on("leaveEdge", () => cb.current.onHoverEdge?.(null));
    sigma.on("clickStage", () => cb.current.onClickStage());

    const firstPaintMs = Math.round(performance.now() - t0);
    const publish = (s: GraphStats, ready: boolean) => {
      setStats(s);
      window.__vaGraph = {
        sigma,
        nodes: s.nodes,
        edges: s.edges,
        readyMs: ready ? Math.round(performance.now() - t0) : -1,
        stats: s,
      };
    };
    publish(
      { nodes: graph.order, edges: graph.size, firstPaintMs, layoutMs: null, cached: !!cached },
      !!cached || graph.order <= 1,
    );
    setVersion((x) => x + 1);

    let worker: Worker | null = null;
    let raf = 0;
    if (!cached && graph.order > 1) {
      setLaying(true);
      worker = new Worker(new URL("../../../lib/results/layout.worker.ts", import.meta.url), {
        type: "module",
      });
      const req: LayoutRequest = {
        nodes: ids.map((id) => {
          const a = graph.getNodeAttributes(id);
          return [id, a.x as number, a.y as number, a.size as number];
        }),
        edges: data.edges.map(([s, t, , w]) => [s, t, w]),
      };
      worker.onmessage = (e: MessageEvent<LayoutResponse>) => {
        const { pos, ms } = e.data;
        worker?.terminate();
        worker = null;
        const from = ids.map(
          (id) => [graph.getNodeAttribute(id, "x"), graph.getNodeAttribute(id, "y")] as const,
        );
        const apply = (k: number) => {
          ids.forEach((id, i) => {
            graph.mergeNodeAttributes(id, {
              x: from[i]![0] + (pos[i * 2]! - from[i]![0]) * k,
              y: from[i]![1] + (pos[i * 2 + 1]! - from[i]![1]) * k,
            });
          });
        };
        const done = () => {
          saveLayout(investigationId, ids, (id) => [
            graph.getNodeAttribute(id, "x") as number,
            graph.getNodeAttribute(id, "y") as number,
          ]);
          sigma.getCamera().setState({ x: 0.5, y: 0.5, angle: 0 });
          setLaying(false);
          publish({ nodes: graph.order, edges: graph.size, firstPaintMs, layoutMs: ms, cached: false }, true);
        };
        if (reducedMotion()) {
          apply(1);
          done();
          return;
        }
        // the seeded picture eases into the computed one (expo.out, 700 ms)
        const start = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / 700);
          apply(1 - Math.pow(2, -10 * t));
          if (t < 1) raf = requestAnimationFrame(step);
          else {
            apply(1);
            done();
          }
        };
        raf = requestAnimationFrame(step);
      };
      worker.postMessage(req);
    }

    return () => {
      cancelAnimationFrame(raf);
      worker?.terminate();
      sigma.kill();
      sigmaRef.current = null;
      graphRef.current = null;
      delete window.__vaGraph;
    };
  }, [data, investigationId, container]);

  const repaint = useCallback(() => sigmaRef.current?.refresh({ skipIndexation: true }), []);

  /** Camera x/y that puts framed point `p` at the centre of the uncovered area, at `ratio`. */
  const centred = useCallback((p: { x: number; y: number }, ratio: number, insets: Insets) => {
    const sigma = sigmaRef.current!;
    const { width, height } = sigma.getDimensions();
    // the free area's centre sits (dx, dy) px from the viewport centre; show p there
    const dx = (insets.left - insets.right) / 2;
    const dy = -(insets.bottom ?? 0) / 2;
    const probe = sigma.viewportToFramedGraph(
      { x: width / 2 - dx, y: height / 2 - dy },
      { cameraState: { x: p.x, y: p.y, ratio, angle: 0 } },
    );
    return { x: probe.x, y: probe.y };
  }, []);

  const focus = useCallback(
    (id: string, insets: Insets) => {
      const sigma = sigmaRef.current;
      const graph = graphRef.current;
      if (!sigma || !graph?.hasNode(id)) return;
      const d = sigma.getNodeDisplayData(id);
      if (!d) return;
      const cam = sigma.getCamera();
      const ratio = Math.min(cam.ratio, 0.45);
      const target = { ...centred({ x: d.x, y: d.y }, ratio, insets), ratio, angle: 0 };
      if (reducedMotion()) cam.setState(target);
      else void cam.animate(target, { duration: 380, easing: "cubicOut" });
    },
    [centred],
  );

  const fit = useCallback(
    (insets: Insets) => {
      const sigma = sigmaRef.current;
      const graph = graphRef.current;
      if (!sigma || !graph || graph.order === 0) return;
      const { width, height } = sigma.getDimensions();
      // the graph's on-screen extent at ratio 1, then the ratio that fits it into the area the panels leave free
      const at1 = { cameraState: { x: 0.5, y: 0.5, ratio: 1, angle: 0 } };
      let minX = Infinity,
        maxX = -Infinity,
        minY = Infinity,
        maxY = -Infinity;
      const pts: { x: number; y: number }[] = [];
      graph.forEachNode((id, a) => {
        if (a.hidden) return;
        const d = sigma.getNodeDisplayData(id);
        if (!d) return;
        const p = sigma.framedGraphToViewport({ x: d.x, y: d.y }, at1);
        pts.push(p);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      });
      const pad = 56;
      const free = Math.max(160, width - insets.left - insets.right - pad * 2);
      const freeH = Math.max(120, height - (insets.bottom ?? 0) - pad * 2);
      // small results label every value to the right of its glyph: keep room for the right-most labels
      const freeW = pts.length <= SMALL_GRAPH_LABEL_ALL ? Math.max(120, free - LABEL_W_PX) : free;
      const fitRatio = Math.max(0.15, (maxX - minX) / freeW, (maxY - minY) / freeH);
      // A small result stays a compact cluster in the middle instead of being stretched to the canvas corners, but
      // never so compact that two labels overlap (every value is labelled there).
      const ratio =
        pts.length <= SMALL_GRAPH_LABEL_ALL
          ? Math.max(fitRatio, Math.min(minFitRatio(pts.length), labelClearance(pts)))
          : fitRatio;
      const centre = sigma.viewportToFramedGraph({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, at1);
      const target = { ...centred(centre, ratio, insets), ratio, angle: 0 };
      if (reducedMotion()) sigma.getCamera().setState(target);
      else void sigma.getCamera().animate(target, { duration: 300, easing: "cubicOut" });
    },
    [centred],
  );

  const zoom = useCallback((factor: number) => {
    const cam = sigmaRef.current?.getCamera();
    if (!cam) return;
    const target = { ratio: cam.ratio / factor };
    if (reducedMotion()) cam.setState(target);
    else void cam.animate(target, { duration: 200 });
  }, []);

  return {
    sigmaRef,
    graphRef,
    view: view.current,
    repaint,
    focus,
    fit,
    zoom,
    version,
    laying,
    stats,
  };
}
