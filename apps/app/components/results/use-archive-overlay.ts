"use client";

import type Graph from "graphology";
import type Sigma from "sigma";
import { useEffect, useState, type RefObject } from "react";
import type { ArchiveGraph } from "@voidaccess/archive";
import { ARCHIVE_GLYPH } from "@/lib/results/glyphs";
import { nodeColor } from "@/lib/results/graph-model";

/** Archive nodes are dashed rings in quieter paper: context from earlier findings, not this run. */
const ARCHIVE_INTENSITY = 0.55;
export type MinTier = "unconfirmed" | "corroborated" | "feed_validated";

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h / 4294967296;
}

/**
 * Adds (and removes) archive context in the live graph: archive-only nodes and the edges linking them to the
 * viewer's entities. Archive nodes carry `archive: true`; their edges carry `archiveEdge` for the hover tooltip.
 * Positions are placed beside the entities they connect to, so the viewer's own layout never moves.
 */
export function useArchiveOverlay(opts: {
  investigationId: string;
  graphRef: RefObject<Graph | null>;
  sigmaRef: RefObject<Sigma | null>;
  /** bumps when the base graph is (re)built, so the overlay re-applies */
  graphVersion: number;
  on: boolean;
  hops: 1 | 2;
  minTier: MinTier;
}) {
  const { investigationId, graphRef, sigmaRef, graphVersion, on, hops, minTier } = opts;
  const [state, setState] = useState({ loading: false, nodes: 0, edges: 0, truncated: false, failed: false });

  useEffect(() => {
    const graph = graphRef.current;
    const sigma = sigmaRef.current;
    if (!graph || !sigma) return;
    const clear = () => {
      for (const n of graph.filterNodes((_id, a) => a.archive === true)) graph.dropNode(n); // drops its edges too
    };
    clear();
    if (!on) {
      setState({ loading: false, nodes: 0, edges: 0, truncated: false, failed: false });
      sigma.refresh();
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, failed: false }));
    fetch(`/api/investigations/${investigationId}/archive/graph?hops=${hops}&minTier=${minTier}`)
      .then((r) => (r.ok ? (r.json() as Promise<ArchiveGraph>) : Promise.reject(new Error(String(r.status)))))
      .then((g) => {
        if (cancelled || graphRef.current !== graph) return;
        clear();
        // a rough scale for jitter: the graph's current extent
        let minX = Infinity,
          maxX = -Infinity,
          minY = Infinity,
          maxY = -Infinity;
        graph.forEachNode((_id, a) => {
          minX = Math.min(minX, a.x as number);
          maxX = Math.max(maxX, a.x as number);
          minY = Math.min(minY, a.y as number);
          maxY = Math.max(maxY, a.y as number);
        });
        const span = Math.max(maxX - minX, maxY - minY, 10);
        const anchors = new Map<string, { x: number; y: number }[]>();
        for (const e of g.edges) {
          for (const [a, b] of [
            [e.source, e.target],
            [e.target, e.source],
          ] as const) {
            if (b.startsWith("arc:") && !a.startsWith("arc:") && graph.hasNode(a)) {
              const p = {
                x: graph.getNodeAttribute(a, "x") as number,
                y: graph.getNodeAttribute(a, "y") as number,
              };
              anchors.set(b, [...(anchors.get(b) ?? []), p]);
            }
          }
        }
        for (const n of g.nodes) {
          const pts = anchors.get(n.id);
          const cx = pts?.length ? pts.reduce((s, p) => s + p.x, 0) / pts.length : (minX + maxX) / 2;
          const cy = pts?.length ? pts.reduce((s, p) => s + p.y, 0) / pts.length : (minY + maxY) / 2;
          const ang = hash01(n.id) * Math.PI * 2;
          const rad = span * (0.05 + 0.07 * hash01(`${n.id}r`)) * (n.hop === 2 ? 1.6 : 1);
          graph.addNode(n.id, {
            x: cx + Math.cos(ang) * rad,
            y: cy + Math.sin(ang) * rad,
            size: n.hop === 1 ? 6 : 4.5,
            label: n.label,
            etype: n.type,
            color: nodeColor(ARCHIVE_INTENSITY),
            intensity: ARCHIVE_INTENSITY,
            shape: ARCHIVE_GLYPH.shape,
            archive: true,
            tier: n.tier,
            hop: n.hop,
            degree: 1,
          });
        }
        let added = 0;
        g.edges.forEach((e, i) => {
          if (graph.hasNode(e.source) && graph.hasNode(e.target) && e.source !== e.target) {
            graph.addEdgeWithKey(`arc-e${i}`, e.source, e.target, {
              type: "line",
              rel: e.type,
              archiveEdge: e,
            });
            added++;
          }
        });
        setState({
          loading: false,
          nodes: g.nodes.length,
          edges: added,
          truncated: g.truncated,
          failed: false,
        });
        sigma.refresh();
      })
      .catch(
        () => !cancelled && setState({ loading: false, nodes: 0, edges: 0, truncated: false, failed: true }),
      );
    return () => {
      cancelled = true;
    };
  }, [investigationId, graphRef, sigmaRef, graphVersion, on, hops, minTier]);

  return state;
}
