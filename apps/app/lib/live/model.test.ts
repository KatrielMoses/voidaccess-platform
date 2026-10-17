import { describe, expect, it } from "vitest";
import { LiveModel, type LiveEvent } from "./model";
import { BEHIND_MS, MAX_PER_FRAME, Player } from "./player";

const T0 = Date.parse("2026-10-17T10:00:00.000Z");
let seq = 0;
const tr = (kind: string, data: Record<string, unknown>, ms = 0, stage = "collect"): LiveEvent => ({
  type: "trace",
  seq: ++seq,
  stage,
  kind,
  data,
  at: new Date(T0 + ms).toISOString(),
});
const pg = (type: string, extra: Record<string, unknown> = {}, ms = 0): LiveEvent =>
  ({ type, seq: ++seq, at: new Date(T0 + ms).toISOString(), ...extra }) as LiveEvent;

describe("LiveModel", () => {
  it("follows one URL from found -> kept -> fetched -> entities, with page co-occurrence edges", () => {
    const m = new LiveModel();
    expect(
      m.apply(tr("url.found", { url_id: "u1", host: "a…bcde[.]onion", engine: "ahmia", depth: 0 })),
    ).toEqual([{ e: "url", id: "u1" }]);
    m.apply(tr("url.kept", { url_id: "u1", score: 0.8 }));
    m.apply(tr("page.fetched", { url_id: "u1", outcome: "ok", http_status: 200, bytes: 4096, ms: 900 }));
    m.apply(tr("page.entities", { url_id: "u1", by_type: { CVE: 2 } }));
    m.apply(tr("entity.found", { entity_id: "e1", type: "CVE", display: "CVE-2023-4966", url_id: "u1" }));
    const fx = m.apply(
      tr("entity.found", { entity_id: "e2", type: "CVE", display: "CVE-2023-0669", url_id: "u1" }),
    );
    expect(fx).toContainEqual({ e: "edge", a: "e1", b: "e2" });
    const u = m.urls.get("u1")!;
    expect(u).toMatchObject({
      host: "a…bcde[.]onion",
      engine: "ahmia",
      state: "fetched",
      score: 0.8,
      entityIds: ["e1", "e2"],
    });
    expect(u.fetch).toMatchObject({ outcome: "ok", httpStatus: 200, bytes: 4096 });
    expect(m.kept).toBe(1);
    expect(m.fetchedOk).toBe(1);
  });

  it("drops and fetch failures fill the tray by reason", () => {
    const m = new LiveModel();
    for (let i = 1; i <= 5; i++) m.apply(tr("url.found", { url_id: `u${i}`, host: `h${i}.example[.]com` }));
    m.apply(tr("url.dropped", { url_id: "u1", reason: "duplicate" }));
    m.apply(tr("url.dropped", { url_id: "u2", reason: "irrelevant" }));
    m.apply(tr("url.kept", { url_id: "u3" }));
    m.apply(tr("url.kept", { url_id: "u4" }));
    m.apply(tr("page.fetched", { url_id: "u3", outcome: "http_404", http_status: 404 }));
    expect(m.apply(tr("page.fetched", { url_id: "u4", outcome: "tor_error" }))).toEqual([
      { e: "fail", id: "u4", bucket: "tor_error" },
    ]);
    expect(m.tray).toMatchObject({ duplicate: 1, irrelevant: 1, http_404: 1, tor_error: 1 });
    expect(m.discarded).toBe(4);
    expect(m.noiseCleared()).toBeGreaterThan(0.5);
  });

  it("a safety drop erases the host (and engine) the URL was found with", () => {
    const m = new LiveModel();
    m.apply(tr("url.found", { url_id: "u1", host: "nasty…abcd[.]onion", engine: "torch", depth: 1 }));
    m.apply(tr("url.found", { url_id: "u2", host: "other…wxyz[.]onion", engine: "torch" }));
    m.apply(tr("url.dropped", { url_id: "u1", reason: "safety" }));
    m.apply(tr("url.kept", { url_id: "u2" }));
    m.apply(tr("page.fetched", { url_id: "u2", outcome: "safety_dropped" }));
    for (const id of ["u1", "u2"]) {
      const u = m.urls.get(id)!;
      expect(u).toMatchObject({ host: null, engine: null, depth: null, safety: true });
    }
    expect(m.tray.safety).toBe(2);
    expect(JSON.stringify([...m.urls.values()])).not.toContain("[.]onion");
  });

  it("a page read ok and then removed by the safety gate moves to the safety tray and loses its host", () => {
    const m = new LiveModel();
    m.apply(
      tr("url.found", { url_id: "u1", host: "abcdefgh…wxyz[.]onion", engine: "Ahmia (Clearnet Proxy)" }),
    );
    m.apply(tr("url.found", { url_id: "u2", host: "ijklmnop…wxyz[.]onion" }));
    m.apply(tr("url.kept", { url_id: "u1" }));
    m.apply(tr("url.kept", { url_id: "u2" }));
    m.apply(tr("page.fetched", { url_id: "u1", outcome: "ok", bytes: 900 }, 0, "fetch"));
    m.apply(tr("page.fetched", { url_id: "u2", outcome: "error" }, 0, "fetch"));
    expect(m.tray.error).toBe(1);
    expect(m.apply(tr("page.fetched", { url_id: "u1", outcome: "safety_dropped" }, 0, "fetch"))).toEqual([
      { e: "fail", id: "u1", bucket: "safety" },
    ]);
    m.apply(tr("page.fetched", { url_id: "u2", outcome: "safety_dropped" }, 0, "fetch"));
    expect(m.fetchedOk).toBe(0);
    expect(m.tray).toMatchObject({ safety: 2, error: 0 });
    expect(m.urls.get("u1")).toMatchObject({ host: null, engine: null, state: "failed", safety: true });
    expect(m.urls.get("u1")!.fetch).toEqual({ outcome: "safety_dropped" });
    // anything after the safety drop is ignored
    expect(m.apply(tr("page.fetched", { url_id: "u1", outcome: "ok" }, 0, "fetch"))).toEqual([]);
    expect(m.discarded).toBe(2);
  });

  it("a safety drop for a link that was never announced still counts, once, with no mark", () => {
    const m = new LiveModel();
    m.apply(tr("url.found", { url_id: "u1", host: "example[.]com" }));
    expect(m.apply(tr("url.dropped", { url_id: "u81", reason: "safety" }, 0, "filter"))).toEqual([]);
    m.apply(tr("page.fetched", { url_id: "u81", outcome: "safety_dropped" }, 0, "fetch"));
    m.apply(tr("url.dropped", { url_id: "u82", reason: "boring" }, 0, "filter"));
    expect(m.tray.safety).toBe(1);
    expect(m.discarded).toBe(1);
    expect(m.found).toBe(1);
    expect(m.urls.has("u81")).toBe(false);
  });

  it("pages read follow the traces, not the engine's attempt count", () => {
    const m = new LiveModel({ counts: { pages_fetched: 3 } });
    for (const i of [1, 2, 3]) m.apply(tr("url.found", { url_id: `u${i}`, host: "example[.]com" }));
    m.apply(tr("page.fetched", { url_id: "u1", outcome: "ok" }, 0, "fetch"));
    m.apply(tr("page.fetched", { url_id: "u2", outcome: "timeout" }, 0, "fetch"));
    expect(m.pagesRead()).toBe(1);
    m.apply(tr("trace.truncated", { kind: "page.fetched", dropped: 40 }, 0, "fetch"));
    expect(m.pagesRead()).toBe(3);
    expect(new LiveModel({ counts: { pages_fetched: 5 } }).pagesRead()).toBe(5);
  });

  it("never double-counts a replayed or reconnected event, and ignores unknown kinds", () => {
    const m = new LiveModel();
    const e = tr("url.found", { url_id: "u1", host: "example[.]com" });
    m.apply(e);
    expect(m.apply(e)).toEqual([]);
    expect(m.apply(tr("page.screenshot", { url_id: "u1" }))).toEqual([]);
    expect(m.found).toBe(1);
  });

  it("tracks stages and writes one calm summary line per stage", () => {
    const m = new LiveModel();
    m.apply(pg("stage", { stage: "collect", status: "start" }));
    for (let i = 1; i <= 3; i++) m.apply(tr("url.found", { url_id: `u${i}`, host: `h${i}.example[.]com` }));
    m.apply(tr("search.result", { engine: "ahmia", query_index: 0, status: "ok", results: 3 }));
    expect(m.summaryLine()).toBe("Collect: 3 links found, 1 search engines");
    m.apply(pg("stage", { stage: "collect", status: "end" }));
    m.apply(pg("stage", { stage: "filter", status: "start" }));
    m.apply(tr("url.kept", { url_id: "u1" }, 0, "filter"));
    m.apply(tr("url.dropped", { url_id: "u2", reason: "duplicate" }, 0, "filter"));
    expect(m.summaryLine()).toBe("Filter: 3 links found, 1 kept, 1 discarded");
    m.apply(pg("completed"));
    expect(Object.values(m.stages).every((s) => s === "end")).toBe(true);
  });
});

describe("Player", () => {
  it("spreads a burst over the time it happened, at most MAX_PER_FRAME animated events per frame", () => {
    const m = new LiveModel();
    const p = new Player(m);
    const evs = Array.from({ length: 100 }, (_, i) =>
      tr("url.found", { url_id: `u${i}`, host: `h${i}.example[.]com` }, i * 10),
    );
    p.push(evs);
    expect(p.tick(16).length).toBeLessThanOrEqual(MAX_PER_FRAME);
    expect(m.found).toBeLessThan(100);
    for (let i = 0; i < 80; i++) p.tick(16);
    expect(m.found).toBe(100);
  });

  it("applies backlog instantly (no effects) for late joiners, then plays live", () => {
    const m = new LiveModel();
    const p = new Player(m);
    p.push(
      Array.from({ length: 50 }, (_, i) =>
        tr("url.found", { url_id: `u${i}`, host: `h${i}.example[.]com` }, i),
      ),
      true,
    );
    expect(m.found).toBe(50);
    expect(p.jumps).toBe(1);
    p.push([tr("url.found", { url_id: "u99", host: "late.example[.]com" }, 100)]);
    const fx: unknown[] = [];
    for (let i = 0; i < 20; i++) fx.push(...p.tick(16));
    expect(fx).toEqual([{ e: "url", id: "u99" }]);
  });

  it("live: a playhead far behind jumps forward; replay never skips", () => {
    const evs = () =>
      Array.from({ length: 20 }, (_, i) =>
        tr("url.found", { url_id: `u${i}`, host: `h${i}.example[.]com` }, i * 1000),
      );
    const live = new Player(new LiveModel());
    live.push(evs());
    live.tick(16);
    expect(live.jumps).toBeGreaterThan(0);
    expect(live.model.found).toBeGreaterThan(20 - BEHIND_MS / 1000);

    const replay = new Player(new LiveModel());
    replay.catchUp = false;
    replay.speed = 16;
    replay.push(evs());
    replay.tick(16);
    expect(replay.jumps).toBe(0);
    expect(replay.model.found).toBeLessThan(5);
  });
});
