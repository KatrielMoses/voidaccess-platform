// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createRef } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FiltersControl } from "@/components/results/workspace/filters";
import { Sidebar, type SidebarProps } from "@/components/results/workspace/sidebar";
import { GROUPS, type GroupId } from "@/lib/results/categories";
import { buildIndex, searchIndex } from "@/lib/results/search";
import type { GraphData } from "@/lib/results/types";
import { NO_FILTERS, rowsByGroup } from "@/lib/results/workspace-model";

afterEach(cleanup);

const data: GraphData = {
  nodes: [
    ["n1", "ONION_URL", "lockbit3ab…zwrad[.]onion", 0.9, 4, 1, 0, []],
    ["n2", "ONION_URL", "other…abcd[.]onion", 0.5, 1, 1, 0, []],
    ["n3", "RANSOMWARE_GROUP", "LockBit", 0.95, 9, 1, 0, []],
    ["n4", "EMAIL_ADDRESS", "j***@acme[.]com", 0.7, 1, null, 1, []],
    ["n5", "CVE_NUMBER", "CVE-2023-4966", 0.8, 2, 2, 0, ["kev"]],
  ],
  edges: [],
  communities: [],
};

function sidebar(over: Partial<SidebarProps> = {}) {
  const groups = rowsByGroup(data);
  const props: SidebarProps = {
    groups,
    total: 5,
    query: "",
    onQuery: vi.fn(),
    matches: null,
    activeId: null,
    onMoveActive: vi.fn(),
    onEnter: vi.fn(),
    openGroup: null,
    closing: null,
    onOpenGroup: vi.fn(),
    selectedId: null,
    onSelect: vi.fn(),
    onHoverRow: vi.fn(),
    hiddenGroups: new Set(),
    searchRef: createRef(),
    mode: "expanded",
    animate: false,
    pinned: false,
    onToggle: vi.fn(),
    onTogglePin: vi.fn(),
    onRailHoverRest: vi.fn(),
    onRailFocus: vi.fn(),
    onPointerLeave: vi.fn(),
    footer: null,
    mobile: false,
    sheet: "peek",
    onSheet: vi.fn(),
    ...over,
  };
  return { props, ...render(<Sidebar {...props} />) };
}

describe("values sidebar", () => {
  it("lists every value in exactly one non-empty group; counts sum to the total", () => {
    const groups = rowsByGroup(data);
    const all = [...groups.values()].flat().map((r) => r.id);
    expect(all.sort()).toEqual(["n1", "n2", "n3", "n4", "n5"]);
    sidebar();
    const shown = GROUPS.filter((g) => (groups.get(g.id)?.length ?? 0) > 0);
    const sum = shown.reduce((a, g) => a + Number(screen.getByTestId(`group-count-${g.id}`).textContent), 0);
    expect(sum).toBe(5);
    expect(screen.queryByTestId("group-crypto")).toBeNull(); // empty groups are not shown
  });

  it("sorts a group by connections, then confidence", () => {
    const rows = rowsByGroup(data).get("onion")!;
    expect(rows.map((r) => r.id)).toEqual(["n1", "n2"]);
  });

  it("single-open accordion: opening a group asks to open that one only (the open one closes)", async () => {
    const user = userEvent.setup();
    const onOpenGroup = vi.fn();
    const { rerender, props } = sidebar({ openGroup: "onion", onOpenGroup });
    expect(screen.getByTestId("group-onion")).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByTestId("group-actors"));
    expect(onOpenGroup).toHaveBeenLastCalledWith("actors");
    rerender(<Sidebar {...props} openGroup={"actors" as GroupId} onOpenGroup={onOpenGroup} />);
    expect(screen.getByTestId("group-onion")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("group-actors")).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelectorAll('[aria-expanded="true"]')).toHaveLength(1);
  });

  it("search: match counts per group, highlighted text, masked values only, empty state", () => {
    const idx = buildIndex([...rowsByGroup(data).values()].flat());
    const m = searchIndex(idx, "zwrad.onion");
    sidebar({ matches: m, query: "zwrad.onion", openGroup: "onion" });
    expect(screen.getByTestId("group-count-onion")).toHaveTextContent("1");
    expect(screen.getByTestId("group-count-actors")).toHaveTextContent("0");
    const rows = screen.getAllByTestId("value-row");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByText("zwrad[.]onion", { selector: "mark" })).toBeInTheDocument();
    cleanup();
    sidebar({ matches: searchIndex(idx, "john"), query: "john" });
    expect(screen.getByRole("status")).toHaveTextContent("No values match");
  });

  it("rows never render values as links", () => {
    sidebar({ openGroup: "onion" });
    expect(document.querySelector("a")).toBeNull();
  });
});

describe("filters control", () => {
  it("changes filters, shows the active count and a clear note", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <FiltersControl
        filters={NO_FILTERS}
        onChange={onChange}
        groups={[
          { id: "onion", count: 2 },
          { id: "actors", count: 1 },
        ]}
        archiveState={{ loading: false, nodes: 0, failed: false }}
        counts={{ visible: 5, total: 5, edges: 0, big: false }}
      />,
    );
    await user.click(screen.getByTestId("filters-button"));
    await user.click(screen.getByTestId("filter-group-onion"));
    expect([...onChange.mock.calls.at(-1)![0].hiddenGroups]).toEqual(["onion"]);
    await user.click(screen.getByTestId("filter-typed"));
    expect(onChange.mock.calls.at(-1)![0].typedOnly).toBe(true);
    rerender(
      <FiltersControl
        filters={{ ...NO_FILTERS, typedOnly: true, hiddenGroups: new Set<GroupId>(["onion"]) }}
        onChange={onChange}
        groups={[{ id: "onion", count: 2 }]}
        archiveState={{ loading: false, nodes: 0, failed: false }}
        counts={{ visible: 3, total: 5, edges: 0, big: false }}
      />,
    );
    expect(screen.getByTestId("filters-count")).toHaveTextContent("2");
    expect(screen.getByTestId("filtered-note")).toHaveTextContent(
      "typed relationships only · hidden: Onion links",
    );
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenLastCalledWith(NO_FILTERS);
  });
});
