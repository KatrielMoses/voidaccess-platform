import { describe, expect, it } from "vitest";
import {
  BIG_GRAPH_THRESHOLD,
  BIG_GRAPH_TOP,
  DEFAULT_FILTERS,
  computeVisible,
  neighborsByType,
  seedPositions,
  typeCounts,
} from "@/lib/results/graph-model";
import { buildSvg } from "@/lib/results/graph-export";
import type { GraphData, GraphNodeTuple } from "@/lib/results/types";

const node = (
  id: string,
  type: string,
  conf: number,
  degree: number,
  community: number | null = null,
): GraphNodeTuple => [id, type, id, conf, degree, community, 0];
const data: GraphData = {
  nodes: [
    node("a", "RANSOMWARE_GROUP", 0.9, 3, 1),
    node("b", "CVE_NUMBER", 0.4, 1, 1),
    node("c", "ONION_URL", 0.8, 2, 2),
    node("d", "ONION_URL", 0.95, 0),
  ],
  edges: [
    ["a", "b", "EXPLOITS", 0.9],
    ["a", "c", "CO_APPEARED_ON", 0.5],
    ["c", "b", "CO_APPEARED_ON", 0.5],
  ],
  communities: [],
};

describe("graph filters", () => {
  it("shows everything by default", () => {
    const v = computeVisible(data, DEFAULT_FILTERS);
    expect(v.nodes.size).toBe(4);
    expect(v.edges.size).toBe(3);
  });
  it("hides a type and its edges", () => {
    const v = computeVisible(data, { ...DEFAULT_FILTERS, hiddenTypes: new Set(["ONION_URL"]) });
    expect([...v.nodes].sort()).toEqual(["a", "b"]);
    expect(v.edges.size).toBe(1);
  });
  it("filters by minimum confidence", () => {
    const v = computeVisible(data, { ...DEFAULT_FILTERS, minConfidence: 0.5 });
    expect(v.nodes.has("b")).toBe(false);
    expect(v.edges.size).toBe(1); // only a-c survives
  });
  it("typed-only hides co-occurrence edges and the nodes they leave isolated", () => {
    const v = computeVisible(data, { ...DEFAULT_FILTERS, typedOnly: true });
    expect([...v.nodes].sort()).toEqual(["a", "b"]);
    expect([...v.edges]).toEqual([0]);
  });
  it("counts types and groups neighbours by type", () => {
    expect(typeCounts(data)[0]).toEqual(["ONION_URL", 2]);
    const n = neighborsByType(data, "a");
    expect(n.get("CVE_NUMBER")?.[0]?.edgeType).toBe("EXPLOITS");
    expect(n.get("ONION_URL")?.length).toBe(1);
  });
  it("big graphs open with the top nodes by degree until show-all", () => {
    const nodes = Array.from({ length: BIG_GRAPH_THRESHOLD + 10 }, (_, i) =>
      node(`n${i}`, "DOMAIN", 0.5, i % 100),
    );
    const big: GraphData = { nodes, edges: [], communities: [] };
    const cut = computeVisible(big, DEFAULT_FILTERS);
    expect(cut.nodes.size).toBe(BIG_GRAPH_TOP);
    expect(cut.truncated).toBe(nodes.length - BIG_GRAPH_TOP);
    expect(computeVisible(big, { ...DEFAULT_FILTERS, showAll: true }).nodes.size).toBe(nodes.length);
  });
  it("seeded positions are deterministic", () => {
    expect(seedPositions(data)).toEqual(seedPositions(data));
  });
});

describe("svg export", () => {
  it("escapes text and carries the footer", () => {
    const svg = buildSvg(
      100,
      100,
      [{ x: 1, y: 2, r: 3, color: "#fff", label: '<script>"x"&' }],
      [],
      [{ label: "A&B", color: "#000" }],
    );
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("Investigated with VoidAccess");
  });
});
