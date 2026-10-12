// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntityPage } from "@/lib/results/types";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/investigations/x/results/entities",
  useSearchParams: () => new URLSearchParams(search),
}));

import { TooltipProvider } from "@voidaccess/ui";
import { EntitiesView } from "@/components/results/entities-view";
import { GraphControls } from "@/components/results/graph-controls";
import { DEFAULT_FILTERS } from "@/lib/results/graph-model";

const page: EntityPage = {
  total: 2,
  rows: [
    {
      bundleId: "1",
      type: "EMAIL_ADDRESS",
      displayValue: "a***@x.example",
      sensitive: true,
      confidence: 0.9,
      firstSeen: "2026-10-11T00:00:00Z",
      sourceCount: 2,
      tags: ["t1"],
      degree: 1,
    },
    {
      bundleId: "2",
      type: "CVE_NUMBER",
      displayValue: "CVE-2024-0001",
      sensitive: false,
      confidence: 1,
      firstSeen: null,
      sourceCount: 1,
      tags: [],
      degree: 0,
    },
  ],
};

beforeEach(() => {
  search = "";
  replace.mockReset();
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 1000 });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(page), { status: 200 })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EntitiesView", () => {
  it("renders rows from the API, masks sensitive values and labels their copy button", async () => {
    render(<EntitiesView investigationId="x" typeCounts={{ EMAIL_ADDRESS: 1, CVE_NUMBER: 1 }} />);
    await waitFor(() => expect(screen.getAllByTestId("entity-row")).toHaveLength(2));
    expect(screen.getByText("a***@x.example")).toBeInTheDocument();
    expect(screen.getByTestId("entity-count")).toHaveTextContent("Showing 2 of 2");
    const masked = screen.getAllByTestId("entity-row")[0]!;
    expect(within(masked).getByRole("button", { name: "Copy masked value" })).toBeInTheDocument();
    expect(
      within(screen.getAllByTestId("entity-row")[1]!).getByRole("button", { name: "Copy value" }),
    ).toBeInTheDocument();
  });

  it("type chips and sorting write to the URL (shareable filters)", async () => {
    const user = userEvent.setup();
    render(<EntitiesView investigationId="x" typeCounts={{ EMAIL_ADDRESS: 1, CVE_NUMBER: 1 }} />);
    await waitFor(() => expect(screen.getAllByTestId("entity-row")).toHaveLength(2));
    await user.click(screen.getByRole("button", { name: /CVE 1/ }));
    expect(replace).toHaveBeenLastCalledWith(expect.stringContaining("types=CVE_NUMBER"), expect.anything());
    await user.click(screen.getByRole("button", { name: /^Value/ }));
    expect(replace).toHaveBeenLastCalledWith(expect.stringContaining("sort=value"), expect.anything());
  });

  it("requests filters from the server (search is served by Postgres)", async () => {
    search = "q=cve&types=CVE_NUMBER&sensitive=1&min=0.5";
    render(<EntitiesView investigationId="x" typeCounts={{ CVE_NUMBER: 1 }} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const url = String(
      (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
        .map((c) => String(c[0]))
        .find((u) => u.includes("/entities?")),
    );
    expect(url).toContain("/api/investigations/x/entities?");
    expect(url).toContain("q=cve");
    expect(url).toContain("types=CVE_NUMBER");
    expect(url).toContain("sensitive=1");
    expect(url).toContain("min=0.5");
  });

  it("selects rows with the keyboard", async () => {
    const user = userEvent.setup();
    render(<EntitiesView investigationId="x" typeCounts={{ CVE_NUMBER: 1 }} />);
    await waitFor(() => expect(screen.getAllByTestId("entity-row")).toHaveLength(2));
    screen.getAllByTestId("entity-row")[0]!.focus();
    await user.keyboard(" ");
    expect(screen.getAllByTestId("entity-row")[0]).toHaveAttribute("aria-selected", "true");
  });
});

describe("GraphControls", () => {
  const base = {
    filters: DEFAULT_FILTERS,
    types: [
      ["CVE_NUMBER", 3],
      ["ONION_URL", 5],
    ] as [string, number][],
    communityColors: false,
    onCommunityColors: vi.fn(),
    big: true,
    truncated: 42,
    totalNodes: 5000,
    visibleNodes: 1500,
    visibleEdges: 900,
    onReset: vi.fn(),
    onExportPng: vi.fn(),
    onExportSvg: vi.fn(),
    exporting: false,
    tableHref: "/t",
    cssColor: () => "#fff",
  };
  it("toggles type chips, confidence, typed-only and show-all through onChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <GraphControls {...base} onChange={onChange} />
      </TooltipProvider>,
    );
    await user.click(screen.getByTestId("type-chip-ONION_URL"));
    expect([...onChange.mock.calls.at(-1)![0].hiddenTypes]).toEqual(["ONION_URL"]);
    await user.click(screen.getByTestId("typed-only"));
    expect(onChange.mock.calls.at(-1)![0].typedOnly).toBe(true);
    await user.click(screen.getByTestId("show-all"));
    expect(onChange.mock.calls.at(-1)![0].showAll).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("showing the top 1,500 of 5,000");
    expect(screen.getByRole("link", { name: "View as table" })).toHaveAttribute("href", "/t");
  });
});
