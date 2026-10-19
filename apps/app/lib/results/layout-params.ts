/** Layout parameters and messages shared by the layout worker and the workspace (P9-8). */
import type { ForceAtlas2Settings } from "graphology-layout-forceatlas2";

export interface LayoutRequest {
  /** [id, seedX, seedY, size] in a stable order */
  nodes: [string, number, number, number][];
  /** [source, target, weight] */
  edges: [string, string, number][];
}
export interface LayoutResponse {
  /** x, y per node, in request order */
  pos: Float64Array;
  ms: number;
  iterations: number;
}

/** Bumped whenever the parameters change, so cached positions from older settings are recomputed. */
export const LAYOUT_VERSION = 6;

export function layoutSettings(order: number): { settings: ForceAtlas2Settings; iterations: number } {
  return {
    settings: {
      linLogMode: true,
      outboundAttractionDistribution: true,
      adjustSizes: false,
      barnesHutOptimize: order > 600,
      barnesHutTheta: 0.6,
      edgeWeightInfluence: 0.6,
      scalingRatio: order > 1000 ? 18 : order > 300 ? 10 : 5,
      gravity: 0.25,
      strongGravityMode: false,
      slowDown: 1 + Math.log10(Math.max(10, order)),
    },
    // enough to converge; bounded so a large run still lays out in about a second
    iterations: order > 2000 ? 220 : order > 1000 ? 300 : order > 300 ? 450 : 600,
  };
}
