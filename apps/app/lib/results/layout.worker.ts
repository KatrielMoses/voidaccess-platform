/// <reference lib="webworker" />
/**
 * Graph layout off the main thread (P9-8). A fixed number of ForceAtlas2 iterations from deterministic seed
 * positions: the same investigation always gives the same picture, and the layout then stops (no endless settling).
 * LinLog mode with outbound attraction distribution gives clusters room, so 1,500 nodes don't form one hairball.
 */
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { layoutSettings, type LayoutRequest, type LayoutResponse } from "./layout-params";
import { SMALL_GRAPH_LABEL_ALL } from "./small-results";

self.onmessage = (e: MessageEvent<LayoutRequest>) => {
  const t0 = performance.now();
  const { nodes, edges } = e.data;
  const g = new Graph({ type: "undirected", multi: true });
  for (let i = 0; i < nodes.length; i++) {
    const [id, x, y, size] = nodes[i]!;
    g.addNode(id, { x, y, size });
  }
  for (const [s, t, w] of edges) if (g.hasNode(s) && g.hasNode(t)) g.addEdge(s, t, { weight: w });
  const { settings, iterations } = layoutSettings(g.order);
  forceAtlas2.assign(g, { iterations, settings, getEdgeWeight: "weight" });
  placeIsolated(g);
  const pos = new Float64Array(nodes.length * 2);
  for (let i = 0; i < nodes.length; i++) {
    const a = g.getNodeAttributes(nodes[i]![0]);
    pos[i * 2] = a.x as number;
    pos[i * 2 + 1] = a.y as number;
  }
  const res: LayoutResponse = { pos, ms: Math.round(performance.now() - t0), iterations };
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(res, [pos.buffer]);
};

/**
 * Values with no links carry no structure for the forces to find; gravity alone piles them into one overlapping
 * blob. They go on a tidy grid beside the connected graph instead, in their input (degree) order.
 */
function placeIsolated(g: Graph): void {
  const lone = g.filterNodes((n) => g.degree(n) === 0);
  if (lone.length === 0 || lone.length === g.order) {
    // a small result with no links at all reads best as a list: one column (two past six values), labels to the right
    if (lone.length === g.order)
      grid(
        lone,
        0,
        0,
        10,
        g.order <= 6 ? 1 : g.order <= SMALL_GRAPH_LABEL_ALL ? 2 : Math.ceil(Math.sqrt(lone.length * 1.6)),
      );
    return;
  }
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  let linked = 0;
  g.forEachNode((n, a) => {
    if (g.degree(n) === 0) return;
    linked++;
    minX = Math.min(minX, a.x);
    maxX = Math.max(maxX, a.x);
    minY = Math.min(minY, a.y);
    maxY = Math.max(maxY, a.y);
  });
  // spacing: a little under the mean distance between linked nodes; the block is as tall as the graph
  // (small results get wider spacing: every value is labelled there, and labels need the room)
  const spread = g.order <= SMALL_GRAPH_LABEL_ALL ? 1.6 : 0.55;
  const step = Math.max(1, Math.sqrt(((maxX - minX) * (maxY - minY)) / Math.max(1, linked)) * spread);
  const rows = Math.max(1, Math.min(lone.length, Math.floor((maxY - minY) / step) + 1));
  const top = (minY + maxY) / 2 - ((Math.ceil(lone.length / Math.ceil(lone.length / rows)) - 1) * step) / 2;
  // small results: the unlinked values beside the graph form a column (two past eight), so their labels never collide
  const cols = g.order <= SMALL_GRAPH_LABEL_ALL ? (lone.length <= 8 ? 1 : 2) : Math.ceil(lone.length / rows);
  const colTop =
    g.order <= SMALL_GRAPH_LABEL_ALL
      ? (minY + maxY) / 2 - ((Math.ceil(lone.length / cols) - 1) * step) / 2
      : top;
  grid(lone, maxX + step * 4, colTop, step, cols);

  function grid(ids: string[], x0: number, y0: number, s: number, cols: number) {
    ids.forEach((id, i) =>
      g.mergeNodeAttributes(id, { x: x0 + (i % cols) * s, y: y0 + Math.floor(i / cols) * s }),
    );
  }
}
