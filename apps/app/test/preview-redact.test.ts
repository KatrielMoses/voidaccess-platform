/** Pure preview redactors (lib/access): no database needed. */
import { describe, expect, it } from "vitest";
import {
  LOCKED_ERROR,
  PREVIEW_PLACEHOLDER_ROWS,
  PREVIEW_ROWS,
  PREVIEW_SUMMARY_SENTENCES,
  hostOnly,
  lockedText,
  previewSummary,
  redactActors,
  redactEntityPage,
  redactGraph,
  redactInvestigation,
  redactSources,
  redactTraceData,
  type PreviewTotals,
} from "@/lib/access";
import { exportStates } from "@/lib/results/formats";
import type { ActorView, EntityRowView, GraphData, InvestigationView, SourceView } from "@/lib/results/types";

const totals = (entities: number): PreviewTotals => ({
  sources: 3,
  entities,
  byType: { DOMAIN: entities },
  actors: 3,
  onions: 0,
  iocs: entities,
  relationships: 2,
});

describe("contract constants", () => {
  it("match the shared contract", () => {
    expect(PREVIEW_ROWS).toBe(2);
    expect(PREVIEW_SUMMARY_SENTENCES).toBe(3);
    expect(LOCKED_ERROR).toBe("preview_locked");
  });
});

describe("lockedText", () => {
  it("is 8..28 blocks, deterministic per seed, and says nothing about the value", () => {
    const lens = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const t = lockedText(`entity:${i}`);
      expect(t).toMatch(/^█{8,28}$/);
      expect(lockedText(`entity:${i}`)).toBe(t);
      lens.add(t.length);
    }
    expect(lens.size).toBeGreaterThan(10);
  });
});

describe("previewSummary", () => {
  it("keeps the first 3 sentences, skips the title, drops the rest", () => {
    const md =
      "# Title secret\n\nOne is here. Two is here! Three is here? Four is hidden. Five too.\n\nSix hidden.";
    expect(previewSummary(md)).toBe("One is here. Two is here! Three is here?");
  });
  it("counts sentences across paragraphs", () => {
    expect(previewSummary("A one.\n\nB two. C three. D four.")).toBe("A one.\n\nB two. C three.");
  });
  it("stops at a list or table and never shows a partial one", () => {
    expect(previewSummary("Intro.\n\n- item secret\n- item two\n\nAfter. More.")).toBe("Intro.");
    expect(previewSummary("Intro.\n\n| a | b |\n|---|---|\n| x | y |")).toBe("Intro.");
    expect(previewSummary("- list first\n\nText.")).toBe("");
    expect(previewSummary("Intro.\n\n```\ncode secret\n```")).toBe("Intro.");
    expect(previewSummary("Intro.\n\n> quote secret")).toBe("Intro.");
  });
  it("respects the 400-character cap", () => {
    const s = (n: number) => `${"word ".repeat(n).trim()}.`;
    const md = `${s(30)} ${s(30)} ${s(30)}`; // ~150 chars each
    const out = previewSummary(md);
    expect(out.length).toBeLessThanOrEqual(400);
    expect(out).toBe(`${s(30)} ${s(30)}`);
    const long = previewSummary(`${"x".repeat(600)} tail secret.`);
    expect(long.length).toBeLessThanOrEqual(400);
    expect(long).not.toContain("secret");
  });
  it("does not split on abbreviations or leave open Markdown", () => {
    expect(previewSummary("Tools e.g. curl are used. Second. Third. Fourth.")).toBe(
      "Tools e.g. curl are used. Second. Third.",
    );
    expect(previewSummary("First **bold. still bold** end. Next.")).toBe("");
    expect(previewSummary("Ok. See [the. site](http://x.example) here. Next.")).toBe("Ok.");
  });
  it("handles empty input", () => {
    expect(previewSummary("")).toBe("");
    expect(previewSummary("# Only a title")).toBe("");
  });
});

const row = (i: number, type = "DOMAIN"): EntityRowView => ({
  bundleId: `b${i}`,
  type,
  displayValue: `secret-${i}`,
  sensitive: false,
  confidence: 0.9,
  firstSeen: "2026-01-01T00:00:00.000Z",
  sourceCount: 2,
  tags: ["t"],
  degree: 3,
  relevance: "direct",
  relevanceReason: "term_match:x",
});

describe("redactEntityPage", () => {
  it("returns the first 2 rows as-is and at most 20 typed placeholders, with the real total", () => {
    const rows = Array.from({ length: 22 }, (_, i) => row(i, i % 2 ? "IP_ADDRESS" : "DOMAIN"));
    const page = redactEntityPage(rows, totals(500));
    expect(page.total).toBe(500);
    expect(page.rows.slice(0, 2)).toEqual(rows.slice(0, 2));
    const locked = page.rows.slice(2);
    expect(locked).toHaveLength(PREVIEW_PLACEHOLDER_ROWS);
    for (const [i, r] of locked.entries()) {
      expect(r.locked).toBe(true);
      expect(r.bundleId).toBe(`locked-${i + 2}`);
      expect(r.type).toBe(rows[i + 2]!.type);
      expect(r.displayValue).toMatch(/^█+$/);
      expect([r.confidence, r.degree, r.sourceCount]).toEqual([0, 0, 0]);
      expect([r.firstSeen, r.relevance, r.relevanceReason]).toEqual([null, null, null]);
    }
    expect(JSON.stringify(locked)).not.toMatch(/secret|b\d/);
    expect(page.access).toEqual({ level: "preview", totals: totals(500) });
  });
  it("a later page is empty; a tiny run has no placeholders", () => {
    expect(redactEntityPage([row(0)], totals(1), 100).rows).toEqual([]);
    expect(redactEntityPage([row(0)], totals(1)).rows).toEqual([row(0)]);
  });
});

describe("redactSources / redactActors", () => {
  const src = (i: number): SourceView => ({
    bundleId: `s${i}`,
    kind: "onion_page",
    name: `title-${i}`,
    url: `http://host${i}.example.net/secret/path?q=1`,
    fetchedAt: "2026-01-01T00:00:00.000Z",
    excerpt: `secret excerpt ${i}`,
    relevance: "direct",
    relevanceReason: "term_match:secret",
    pageKind: "forum_thread",
  });
  it("visible sources keep host and title only; the rest are placeholders", () => {
    const out = redactSources([0, 1, 2, 3].map(src));
    expect(out[0]).toMatchObject({ bundleId: "s0", name: "title-0", url: "http://host0.example.net" });
    expect(out[0]!.excerpt).toMatch(/^█+$/);
    expect(out[0]!.relevanceReason).toBeNull();
    expect(out.slice(2).every((s) => s.locked && s.url === null && s.fetchedAt === "")).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/secret|title-2|host2|host3/);
  });
  it("hostOnly drops path and query and rejects junk", () => {
    expect(hostOnly("http://a.example:8080/x?y")).toBe("http://a.example:8080");
    expect(hostOnly(null)).toBeNull();
    expect(hostOnly("not a url")).toBeNull();
  });
  it("visible actors keep their profile but not the other rows they link to", () => {
    const actor = (i: number): ActorView => ({
      bundleId: `a${i}`,
      handle: `handle-${i}`,
      aliases: [`alias-${i}`],
      firstSeen: null,
      lastSeen: null,
      summary: `profile-${i}`,
      entityCount: 1,
      entities: [{ bundleId: "e9", type: "DOMAIN", displayValue: "secret-linked", sensitive: false }],
      sources: [{ bundleId: "s9", kind: "paste", name: "secret-source" }],
    });
    const out = redactActors([0, 1, 2].map(actor));
    expect(out[0]).toMatchObject({ handle: "handle-0", summary: "profile-0", entityCount: 1 });
    expect(out[0]!.entities[0]!.type).toBe("DOMAIN");
    expect(out[2]).toMatchObject({ locked: true, summary: null, entities: [], aliases: [] });
    expect(JSON.stringify(out)).not.toMatch(/secret|handle-2|e9|s9/);
  });
});

describe("redactGraph", () => {
  it("keeps the shape with opaque shuffled ids and no labels", () => {
    const g: GraphData = {
      nodes: [
        ["b1", "DOMAIN", "secret-a", 0.9, 1, 0, 0, ["t"]],
        ["b2", "IP_ADDRESS", "secret-b", 0.8, 1, 0, 1, []],
        ["b3", "DOMAIN", "secret-c", 0.7, 0, null, 0, []],
      ],
      edges: [["b1", "b2", "CO_APPEARED_ON", 0.4]],
      communities: [{ id: 0, label: "secret-community", size: 2 }],
    };
    let seed = 1;
    const out = redactGraph(g, totals(3), () => (seed = (seed * 16807) % 2147483647) / 2147483647);
    expect(out.nodes.map((n) => n[0])).toEqual(["n0", "n1", "n2"]);
    expect(out.nodes.every((n) => n[2] === null && n[3] === 0 && n[6] === 0)).toBe(true);
    expect(out.nodes.map((n) => n[1]).sort()).toEqual(["DOMAIN", "DOMAIN", "IP_ADDRESS"]);
    expect(out.edges).toHaveLength(1);
    expect(out.edges[0]![2]).toBe("CO_APPEARED_ON");
    expect(out.communities).toEqual([{ id: 0, label: null, size: 2 }]);
    expect(JSON.stringify(out)).not.toMatch(/secret|b1|b2|b3/);
  });
});

describe("redactInvestigation", () => {
  it("cuts the summary and locks findings, risk notes, refined queries and the query intent", () => {
    const inv: InvestigationView = {
      id: "i",
      query: "my query",
      depth: "standard",
      status: "completed",
      creditsCharged: 40,
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      summaryKind: "llm",
      refinedQueries: ["secret refined"],
      summary: {
        markdown: "One. Two. Three. Four secret.",
        keyFindings: ["secret finding"],
        riskNotes: ["secret risk"],
        confidence: "high",
        sourceCount: 3,
        entityCounts: { DOMAIN: 5 },
        stats: null,
      },
      relevance: null,
    };
    const out = redactInvestigation(inv, totals(5));
    expect(out.summary.markdown).toBe("One. Two. Three.");
    expect(out.summaryLocked).toBe(true);
    expect(out.summary.keyFindings).toHaveLength(1);
    expect(out.query).toBe("my query");
    expect(out.summary.entityCounts).toEqual({ DOMAIN: 5 });
    expect(JSON.stringify(out)).not.toContain("secret");
  });
});

describe("redactTraceData", () => {
  it("removes hosts, entity values and refined-query text; keeps ids and counts", () => {
    expect(
      redactTraceData("url.found", { url_id: "u1", host: "secret[.]onion", engine: "x" }, 5),
    ).toMatchObject({
      url_id: "u1",
      engine: "x",
    });
    expect(
      JSON.stringify(redactTraceData("url.found", { url_id: "u1", host: "secret[.]onion" }, 5)),
    ).not.toContain("secret");
    expect(
      redactTraceData("entity.found", { entity_id: "e1", type: "DOMAIN", display: "secret" }, 6),
    ).toMatchObject({ entity_id: "e1", type: "DOMAIN" });
    expect(JSON.stringify(redactTraceData("query.refined", { index: 0, text: "secret" }, 1))).not.toContain(
      "secret",
    );
    expect(redactTraceData("graph.progress", { nodes: 3, edges: 2 }, 1)).toEqual({ nodes: 3, edges: 2 });
    expect(redactTraceData("new.kind", { text: "secret", n: 2 }, 1)).toEqual({ n: 2 });
    expect(redactTraceData(null, null, 1)).toEqual({});
  });
});

describe("exportStates", () => {
  it("locks every format for a preview and is unchanged otherwise", () => {
    const states = exportStates({ exportAll: true, artifacts: ["stix"], previewLocked: true });
    expect(states.every((s) => s.locked && s.previewLocked)).toBe(true);
    const full = exportStates({ exportAll: true, artifacts: ["stix"] });
    expect(full.every((s) => !s.locked && !("previewLocked" in s))).toBe(true);
  });
});
