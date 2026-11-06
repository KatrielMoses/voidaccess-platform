// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActorView, EntityRowView, SourceView } from "@/lib/results/types";
import type { PreviewTotals } from "@/lib/preview/types";
import type { UnlockOffer } from "@/lib/preview/offer";
import { SUPPORT_EMAIL } from "@/lib/site";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/investigations/x/results/entities",
  useSearchParams: () => new URLSearchParams(""),
}));

import { PreviewProvider } from "@/components/results/preview/preview-context";
import { UnlockPanel } from "@/components/results/preview/unlock-panel";
import { UnlockReturn } from "@/components/results/preview/unlock-return";
import { PENDING_KEY } from "@/components/results/preview/client-events";
import { SourcesList } from "@/components/results/sources-list";
import { ActorsView } from "@/components/results/actors-view";
import { EntitiesView } from "@/components/results/entities-view";
import { ExportsView } from "@/components/results/exports-view";
import { exportStates } from "@/lib/results/formats";
import { TooltipProvider } from "@voidaccess/ui";

const INV = "6f1c1d3e-4b8a-4c51-9d3a-1a2b3c4d5e6f";
const TOTALS: PreviewTotals = {
  sources: 38,
  entities: 57,
  byType: { BITCOIN_ADDRESS: 12, CVE_NUMBER: 3, DOMAIN: 42 },
  actors: 6,
  onions: 4,
  iocs: 20,
  relationships: 90,
};
const FOUNDING_OFFER: UnlockOffer = { founding: true, priceUsd: 7 };
const PRO_OFFER: UnlockOffer = { founding: false, priceUsd: 9 };
const FILLER = "████████████████";

const wrap = (ui: React.ReactNode, offer: UnlockOffer = FOUNDING_OFFER) => (
  <PreviewProvider
    investigationId={INV}
    access={{ level: "preview", totals: TOTALS }}
    fallbackTotals={TOTALS}
    offer={offer}
  >
    {ui}
  </PreviewProvider>
);

const source = (i: number, extra: Partial<SourceView> = {}): SourceView => ({
  bundleId: `s${i}`,
  kind: "onion_page",
  name: `forum-${i}.example`,
  url: null,
  fetchedAt: "2026-11-01T00:00:00Z",
  excerpt: "",
  relevance: null,
  relevanceReason: null,
  pageKind: null,
  ...extra,
});
const lockedSource = (i: number) =>
  ({ ...source(i), bundleId: `locked-${i}`, name: FILLER, excerpt: FILLER, locked: true }) as SourceView;

let fetchMock: ReturnType<typeof vi.fn>;
let assign: ReturnType<typeof vi.fn>;
let locReplace: ReturnType<typeof vi.fn>;
beforeEach(() => {
  sessionStorage.clear();
  fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  assign = vi.fn();
  locReplace = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...window.location,
      href: `http://localhost/investigations/${INV}/results/entities`,
      pathname: `/investigations/${INV}/results/entities`,
      search: "",
      assign,
      replace: locReplace,
    },
  });
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, value: 1000 });
  Element.prototype.scrollTo = () => undefined; // jsdom has no scrolling
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const bodies = (path: string) =>
  fetchMock.mock.calls
    .filter((c) => String(c[0]) === path)
    .map((c) => JSON.parse(String((c[1] as RequestInit).body)) as Record<string, unknown>);

describe("unlock panel", () => {
  it("uses the agreed copy, with only the counts and the price filled", () => {
    render(<UnlockPanel investigationId={INV} totals={TOTALS} offer={FOUNDING_OFFER} />);
    const panel = screen.getByTestId("unlock-panel");
    expect(screen.getByTestId("unlock-ready")).toHaveTextContent(
      "Your full report is ready. 38 sources, 42 domains, 12 Bitcoin wallets found.",
    );
    expect(panel).toHaveTextContent(
      "We wanted VoidAccess to be free. The free tier got abused with throwaway accounts, so full reports are now for Pro.",
    );
    expect(screen.getByTestId("unlock-price")).toHaveTextContent(
      "Pro is $7 a month, about the price of a coffee. Cancel anytime.",
    );
    expect(screen.getByTestId("unlock-button")).toHaveTextContent("Unlock this report: $7/mo");
    expect(screen.getByTestId("unlock-plans")).toHaveAttribute("href", expect.stringMatching(/\/pricing$/));
    expect(screen.getByTestId("unlock-fallback")).toHaveTextContent(
      `Card not going through? Email ${SUPPORT_EMAIL} and we'll send another way to pay.`,
    );
    expect(within(screen.getByTestId("unlock-fallback")).getByRole("link")).toHaveAttribute(
      "href",
      `mailto:${SUPPORT_EMAIL}`,
    );
    expect(panel).not.toHaveTextContent(/for life/i);
  });

  it("shows Pro's standard price when no founding seat is on offer", () => {
    render(<UnlockPanel investigationId={INV} totals={TOTALS} offer={PRO_OFFER} />);
    expect(screen.getByTestId("unlock-button")).toHaveTextContent("Unlock this report: $9/mo");
    expect(screen.getByTestId("unlock-price")).toHaveTextContent("Pro is $9 a month");
  });

  it("starts the Pro checkout back to this report, remembers it, and reports the click", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/billing/checkout"
        ? new Response(
            JSON.stringify({
              url: "https://creem.io/test/checkout/p/c",
              ref: "11111111-2222-4333-8444-555555555555",
            }),
          )
        : new Response(null, { status: 204 }),
    );
    render(<UnlockPanel investigationId={INV} totals={TOTALS} offer={FOUNDING_OFFER} origin="graph_node" />);
    await userEvent.setup().click(screen.getByTestId("unlock-button"));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://creem.io/test/checkout/p/c"));
    expect(bodies("/api/billing/checkout")[0]).toEqual({
      kind: "subscription",
      plan: "pro",
      interval: "month",
      founding: true,
      source: "preview_unlock",
      returnTo: `/investigations/${INV}/results/entities`,
    });
    expect(bodies("/api/preview/events")[0]).toMatchObject({
      name: "unlock_clicked",
      investigationId: INV,
      origin: "graph_node",
    });
    expect(JSON.parse(sessionStorage.getItem(PENDING_KEY)!)).toMatchObject({
      ref: "11111111-2222-4333-8444-555555555555",
      investigationId: INV,
    });
  });

  it("when the last founding seat goes before the click, it shows the price we'd now charge instead of charging it", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url === "/api/billing/checkout"
        ? new Response(JSON.stringify({ error: "founding_unavailable" }), { status: 409 })
        : new Response(null, { status: 204 }),
    );
    render(<UnlockPanel investigationId={INV} totals={TOTALS} offer={FOUNDING_OFFER} />);
    await userEvent.setup().click(screen.getByTestId("unlock-button"));
    await waitFor(() => expect(screen.getByTestId("unlock-button")).toHaveTextContent("$9/mo"));
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("preview rendering", () => {
  it("sources: the real rows by host and title, placeholders drawn as bars (filler never printed), full totals", () => {
    render(wrap(<SourcesList sources={[source(1), source(2), lockedSource(3), lockedSource(4)]} />));
    expect(screen.getByTestId("sources-preview")).toHaveTextContent("Sources 38");
    expect(screen.getByTestId("preview-shown-of")).toHaveTextContent("2 of 38 sources shown");
    expect(screen.getAllByTestId("source-item")).toHaveLength(2);
    expect(screen.getByText("forum-1.example")).toBeInTheDocument();
    expect(screen.getAllByTestId("source-item-locked")).toHaveLength(2);
    expect(document.body.textContent).not.toContain("█");
    expect(screen.getByTestId("locked-region-sources")).toContainElement(screen.getByTestId("unlock-panel"));
  });

  it("sources on a full report render exactly as before (Pro sees no change)", () => {
    render(<SourcesList sources={[source(1, { excerpt: "plain excerpt text" })]} />);
    expect(screen.queryByTestId("sources-preview")).toBeNull();
    expect(screen.queryByTestId("unlock-panel")).toBeNull();
    expect(screen.getByText("plain excerpt text")).toBeInTheDocument();
  });

  it("actors: two cards, placeholder cards, and Details opens the unlock panel instead of the profile", async () => {
    const actor = (i: number, locked = false) =>
      ({
        bundleId: locked ? `locked-${i}` : `a${i}`,
        handle: locked ? FILLER : `handle${i}`,
        aliases: [],
        firstSeen: null,
        lastSeen: null,
        summary: null,
        entityCount: 0,
        entities: [],
        sources: [],
        ...(locked ? { locked: true } : {}),
      }) as ActorView;
    render(wrap(<ActorsView actors={[actor(1), actor(2), actor(3, true)]} investigationId={INV} />));
    expect(screen.getAllByTestId("actor-card")).toHaveLength(2);
    expect(screen.getAllByTestId("actor-card-locked")).toHaveLength(1);
    expect(screen.getByTestId("preview-shown-of")).toHaveTextContent("2 of 6 actors shown");
    await userEvent
      .setup()
      .click(within(screen.getAllByTestId("actor-card")[0]!).getByRole("button", { name: /Details/ }));
    expect(await screen.findByTestId("unlock-dialog")).toBeInTheDocument();
  });

  it("entities: the real rows, placeholders under the panel, and a row opens the panel, never the detail", async () => {
    const row = (i: number, locked = false): EntityRowView & { locked?: boolean } => ({
      bundleId: locked ? `locked-${i}` : `e${i}`,
      type: "DOMAIN",
      displayValue: locked ? FILLER : `site${i}.example`,
      sensitive: false,
      confidence: locked ? 0 : 0.9,
      firstSeen: null,
      sourceCount: 0,
      tags: [],
      degree: 0,
      relevance: null,
      relevanceReason: null,
      ...(locked ? { locked: true } : {}),
    });
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("/entities?")
        ? new Response(
            JSON.stringify({
              rows: [row(1), row(2), row(3, true), row(4, true)],
              total: 57,
              access: { level: "preview", totals: TOTALS },
            }),
          )
        : new Response(null, { status: 204 }),
    );
    render(
      wrap(
        <EntitiesView
          investigationId={INV}
          typeCounts={{ DOMAIN: 42 }}
          tierCounts={{ direct: 1, related: 1, background: 55 }}
        />,
      ),
    );
    await waitFor(() => expect(screen.getAllByTestId("entity-row")).toHaveLength(2));
    expect(screen.getAllByTestId("entity-row-locked")).toHaveLength(2);
    expect(screen.getByTestId("entity-count")).toHaveTextContent("Showing 2 of 57 entities");
    expect(screen.queryByTestId("entities-tier-direct")).toBeNull();
    expect(document.body.textContent).not.toContain("█");
    await userEvent.setup().click(screen.getAllByTestId("entity-row")[0]!);
    expect(await screen.findByTestId("unlock-dialog")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some((c) => /\/entities\/e1/.test(String(c[0])))).toBe(false);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("/entities?"))).toHaveLength(1);
  });

  it("a 402 preview_locked from the entities API draws the preview panel, never an error", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("/entities?")
        ? new Response(JSON.stringify({ error: "preview_locked" }), { status: 402 })
        : new Response(null, { status: 204 }),
    );
    render(
      <PreviewProvider investigationId={INV} access={null} fallbackTotals={TOTALS} offer={PRO_OFFER}>
        <EntitiesView investigationId={INV} typeCounts={{ DOMAIN: 42 }} />
      </PreviewProvider>,
    );
    expect(await screen.findByTestId("unlock-panel")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn.t load entities/)).toBeNull();
  });

  it("exports: every format visible but locked, and a click opens the unlock panel", async () => {
    render(
      <TooltipProvider>
        {wrap(
          <ExportsView
            investigationId={INV}
            states={exportStates({ exportAll: false, artifacts: ["stix"], previewLocked: true })}
            preview
          />,
        )}
      </TooltipProvider>,
    );
    expect(screen.getByTestId("export-csv")).toHaveTextContent("Locked · unlock the full report");
    expect(screen.getByTestId("export-stix")).toHaveTextContent("Locked · unlock the full report");
    expect(screen.queryByRole("link", { name: /Download/ })).toBeNull();
    expect(screen.getByTestId("exports-note")).toHaveTextContent("Exports are part of the full report");
    await userEvent.setup().click(within(screen.getByTestId("export-csv")).getByRole("button"));
    expect(await screen.findByTestId("unlock-dialog")).toBeInTheDocument();
  });

  it("reports preview_shown once per report per session", async () => {
    const { unmount } = render(wrap(<div />));
    await waitFor(() => expect(bodies("/api/preview/events")).toHaveLength(1));
    expect(bodies("/api/preview/events")[0]).toMatchObject({ name: "preview_shown", sources: 38, actors: 6 });
    unmount();
    render(wrap(<div />));
    await new Promise((r) => setTimeout(r, 20));
    expect(bodies("/api/preview/events")).toHaveLength(1);
  });
});

describe("after checkout", () => {
  it("?unlock=<ref>: shows Unlocking… and reloads the report once the plan has applied", async () => {
    window.location.href = `http://localhost/investigations/${INV}/results/summary?unlock=11111111-2222-4333-8444-555555555555`;
    fetchMock.mockImplementation(async (url: string) =>
      String(url).startsWith("/api/billing/checkout/status")
        ? new Response(JSON.stringify({ paidPlan: true, completed: true, provider: "completed" }))
        : new Response(null, { status: 204 }),
    );
    render(wrap(<UnlockReturn investigationId={INV} />));
    await waitFor(() => expect(locReplace).toHaveBeenCalledWith(`/investigations/${INV}/results/entities`));
    expect(screen.getByTestId("unlock-status")).toBeInTheDocument();
  });

  it("back from Creem without paying: the fallback line, prominently, and checkout_failed with a reason", async () => {
    sessionStorage.setItem(
      PENDING_KEY,
      JSON.stringify({
        ref: "11111111-2222-4333-8444-555555555555",
        investigationId: INV,
        at: Date.now() - 5000,
      }),
    );
    fetchMock.mockImplementation(async (url: string) =>
      String(url).startsWith("/api/billing/checkout/status")
        ? new Response(JSON.stringify({ paidPlan: false, completed: false, provider: "pending" }))
        : new Response(null, { status: 204 }),
    );
    render(wrap(<UnlockReturn investigationId={INV} />));
    const notice = await screen.findByTestId("unlock-failed");
    expect(within(notice).getByTestId("unlock-fallback")).toHaveTextContent(`Email ${SUPPORT_EMAIL}`);
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes("probe=1"))).toBe(true);
    await waitFor(() =>
      expect(bodies("/api/preview/events").find((b) => b.name === "checkout_failed")).toMatchObject({
        reason: "returned_without_payment",
        providerStatus: "pending",
      }),
    );
    expect(sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });
});
