// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LiveLog } from "@/components/live/live-log";
import { TrailPanel } from "@/components/live/trail-panel";
import { LiveModel, type LiveEvent } from "@/lib/live/model";

afterEach(cleanup);

let seq = 0;
const tr = (kind: string, data: Record<string, unknown>, stage = "filter"): LiveEvent => ({
  type: "trace",
  seq: ++seq,
  stage,
  kind,
  data,
  at: new Date().toISOString(),
});

function model() {
  const m = new LiveModel();
  m.apply(tr("url.found", { url_id: "u1", host: "nasty…abcd[.]onion", engine: "torch" }, "collect"));
  m.apply(tr("url.found", { url_id: "u2", host: "fine…wxyz[.]onion", engine: "ahmia" }, "collect"));
  m.apply(tr("url.dropped", { url_id: "u1", reason: "safety" }));
  m.apply(tr("url.dropped", { url_id: "u2", reason: "duplicate" }));
  return m;
}

describe("P8: safety-dropped items render with no host", () => {
  it("the trail of a safety drop shows no host, no engine, and says why", () => {
    const m = model();
    render(<TrailPanel model={m} selection={{ kind: "url", id: "u1" }} onSelect={() => undefined} />);
    const panel = screen.getByTestId("trail-panel");
    expect(panel).not.toHaveTextContent("nasty");
    expect(panel).not.toHaveTextContent("torch");
    expect(panel).not.toHaveTextContent("[.]");
    expect(screen.getByTestId("trail-safety")).toHaveTextContent("No details are kept");
  });

  it("the tray list and the calm log show it without a host, while other drops keep theirs", () => {
    const m = model();
    const { unmount } = render(
      <TrailPanel model={m} selection={{ kind: "bucket", id: "safety" }} onSelect={() => undefined} />,
    );
    expect(screen.getByTestId("tray-items")).toHaveTextContent("removed by the safety filter");
    expect(screen.getByTestId("tray-items")).not.toHaveTextContent("nasty");
    unmount();
    render(<LiveLog model={m} done={false} onSelect={() => undefined} />);
    const log = screen.getByTestId("live-log");
    expect(log).not.toHaveTextContent("nasty");
    expect(log).toHaveTextContent("fine…wxyz[.]onion");
  });

  it("hosts and values are text, never markup or links", () => {
    const m = new LiveModel();
    m.apply(tr("url.found", { url_id: "u1", host: "<b>x</b>[.]com" }, "collect"));
    m.apply(
      tr(
        "entity.found",
        { entity_id: "e1", type: "URL", display: "<a href=x>y</a>", url_id: "u1" },
        "extract",
      ),
    );
    const { container } = render(
      <TrailPanel model={m} selection={{ kind: "url", id: "u1" }} onSelect={() => undefined} />,
    );
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container).toHaveTextContent("<b>x</b>[.]com");
  });
});
