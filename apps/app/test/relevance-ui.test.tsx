// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityPage, EntityRowView, RelevanceView, SourceView, Tier } from "@/lib/results/types";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/investigations/x/results/entities",
  useSearchParams: () => new URLSearchParams(""),
}));

import { EntitiesView } from "@/components/results/entities-view";
import { SourcesList } from "@/components/results/sources-list";
import { NoDirectNotice, RelevancePanel, directIsEmpty } from "@/components/results/relevance";

const row = (id: string, tier: Tier | null): EntityRowView => ({
  bundleId: id,
  type: "MALWARE_FAMILY",
  displayValue: `value-${id}`,
  sensitive: false,
  confidence: 0.8,
  firstSeen: null,
  sourceCount: 1,
  tags: [],
  degree: 0,
  relevance: tier,
  relevanceReason: tier ? "near_direct_match" : null,
});
const ROWS: Record<string, EntityRowView[]> = {
  direct: [row("d1", "direct"), row("d2", "direct")],
  related: [row("r1", "related")],
  background: [row("b1", "background"), row("b2", "background"), row("b3", "background")],
  all: [row("l1", null), row("l2", null)],
};
const relevance = (over: Partial<RelevanceView> = {}): RelevanceView => ({
  queryIntent: "named_threat",
  pages: { direct: 1, related: 1, background: 4 },
  entities: { direct: 2, related: 1, background: 3 },
  relationships: { direct: 0, related: 1, background: 2 },
  removed: { gazetteerContext: 2, orgBoilerplate: 0 },
  feedItemsCapped: 169,
  filterFallback: false,
  refinedQueryRestored: false,
  ...over,
});

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 1000 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const tier = new URL(url, "http://x").searchParams.get("tier") ?? "all";
      const rows = ROWS[tier] ?? [];
      const page: EntityPage = { rows, total: rows.length };
      return new Response(JSON.stringify(page), { status: 200 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const fetchedTiers = () =>
  (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes("/entities?"))
    .map((u) => new URL(u, "http://x").searchParams.get("tier"));

describe("EntitiesView with tiers", () => {
  it("shows Direct, Related and Background in that order, with counts; Background is collapsed", async () => {
    render(
      <EntitiesView
        investigationId="x"
        typeCounts={{ MALWARE_FAMILY: 6 }}
        tierCounts={{ direct: 2, related: 1, background: 3 }}
        query="redline stealer"
      />,
    );
    const sections = ["direct", "related", "background"].map((t) => screen.getByTestId(`entities-tier-${t}`));
    expect(
      sections[0]!.compareDocumentPosition(sections[1]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      sections[1]!.compareDocumentPosition(sections[2]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByTestId("tier-count-direct")).toHaveTextContent("2");
    expect(screen.getByTestId("tier-count-background")).toHaveTextContent("3");
    expect(within(sections[2]!).getByText("collected, not about your query")).toBeInTheDocument();
    await waitFor(() => expect(within(sections[0]!).getAllByTestId("entity-row")).toHaveLength(2));
    expect(within(sections[1]!).getAllByTestId("entity-row")).toHaveLength(1);
    // Background: visible as a heading, rows not loaded until opened
    expect(within(sections[2]!).queryAllByTestId("entity-row")).toHaveLength(0);
    expect(fetchedTiers()).not.toContain("background");
    await userEvent.setup().click(screen.getByTestId("toggle-background"));
    await waitFor(() => expect(within(sections[2]!).getAllByTestId("entity-row")).toHaveLength(3));
    expect(screen.getByTestId("toggle-background")).toHaveAttribute("aria-expanded", "true");
  });

  it("an empty Direct tier says so honestly instead of showing a table", async () => {
    render(
      <EntitiesView
        investigationId="x"
        typeCounts={{ MALWARE_FAMILY: 3 }}
        tierCounts={{ direct: 0, related: 0, background: 3 }}
        query="lumma stealer"
      />,
    );
    const direct = screen.getByTestId("entities-tier-direct");
    expect(within(direct).getByText("Nothing collected names “lumma stealer” directly.")).toBeInTheDocument();
    expect(within(direct).queryByTestId("entity-scroller")).toBeNull();
  });

  it("without tiers it renders one table exactly as before (no sections, no tier param)", async () => {
    render(<EntitiesView investigationId="x" typeCounts={{ MALWARE_FAMILY: 2 }} />);
    await waitFor(() => expect(screen.getAllByTestId("entity-row")).toHaveLength(2));
    expect(screen.queryByTestId("entities-tier-direct")).toBeNull();
    expect(screen.getByTestId("entity-count")).toHaveTextContent("Showing 2 of 2");
    expect(fetchedTiers().every((t) => t === null)).toBe(true);
  });
});

const src = (id: string, tier: Tier | null, kind = "onion_page"): SourceView => ({
  bundleId: id,
  kind,
  name: `host-${id}`,
  url: null,
  fetchedAt: "2026-10-29T07:00:00Z",
  excerpt: `excerpt ${id}`,
  relevance: tier,
  relevanceReason: tier === "direct" ? "term_match:redline" : tier ? "none" : null,
  pageKind: tier ? "forum_thread" : null,
});

describe("SourcesList with tiers", () => {
  it("groups by tier, labels page kind and reason, and collapses Background", async () => {
    const sources = [
      src("a", "direct"),
      src("b", "related", "feed"),
      src("c", "background"),
      src("d", "background"),
    ];
    render(<SourcesList sources={sources} tiered query="redline stealer" />);
    const direct = screen.getByTestId("sources-tier-direct");
    expect(within(direct).getAllByTestId("source-item")).toHaveLength(1);
    expect(within(direct).getByTestId("source-meta")).toHaveTextContent(
      "Onion page · Forum thread · term_match:redline",
    );
    const bg = screen.getByTestId("sources-tier-background");
    expect(within(bg).queryAllByTestId("source-item")).toHaveLength(0);
    await userEvent.setup().click(screen.getByTestId("toggle-background-sources"));
    expect(within(bg).getAllByTestId("source-item")).toHaveLength(2);
  });

  it("legacy sources render grouped by kind as before", () => {
    render(<SourcesList sources={[src("a", null), src("b", null, "feed")]} />);
    expect(screen.queryByTestId("sources-tier-direct")).toBeNull();
    expect(screen.getAllByTestId("source-item")).toHaveLength(2);
    expect(screen.queryByTestId("source-meta")).toBeNull();
  });
});

describe("notices", () => {
  it("the empty-Direct notice names the query and the filter fallback", () => {
    const r = relevance({
      pages: { direct: 0, related: 0, background: 10 },
      entities: { direct: 0, related: 0, background: 15 },
      filterFallback: true,
    });
    expect(directIsEmpty(r)).toBe(true);
    expect(directIsEmpty(relevance())).toBe(false);
    expect(directIsEmpty(null)).toBe(false);
    render(<NoDirectNotice query="lumma stealer malware" relevance={r} />);
    const note = screen.getByTestId("no-direct-notice");
    expect(note).toHaveTextContent("Nothing collected mentions “lumma stealer malware” directly.");
    expect(note).toHaveTextContent("10 pages");
    expect(note).toHaveTextContent("returned nothing usable");
  });

  it("the summary panel shows per-tier counts and the engine's removals", () => {
    render(<RelevancePanel id="x" relevance={relevance()} />);
    expect(screen.getByTestId("relevance-entities-direct")).toHaveTextContent("2");
    expect(screen.getByTestId("relevance-entities-background")).toHaveTextContent("3");
    expect(screen.getByText(/169 recent feed articles/)).toBeInTheDocument();
    expect(screen.getByText(/2 threat-name matches were dropped/)).toBeInTheDocument();
  });
});
