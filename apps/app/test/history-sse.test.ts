import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { invSummary, creditLedger } from "@voidaccess/db";
import * as collection from "@/app/api/investigations/route";
import * as item from "@/app/api/investigations/[id]/route";
import * as cancelRoute from "@/app/api/investigations/[id]/cancel/route";
import * as sseRoute from "@/app/api/investigations/[id]/events/route";
import { CloudRunLauncher, getLauncher, launcherKind, setLauncher } from "@/lib/launcher";
import { startInvestigation } from "@/lib/runs/service";
import { runWatchdog } from "@/lib/runs/watchdog";
import {
  APP,
  StubLauncher,
  asUser,
  balanceOf,
  ctxFor,
  db,
  makeUser,
  postEvent,
  runRow,
  sameOrigin,
} from "./helpers";

const stub = new StubLauncher();
setLauncher(stub);

const r = (path: string, method = "GET", body?: unknown) =>
  new Request(`${APP}${path}`, {
    method,
    headers: sameOrigin,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jsonOf = async (p: Promise<Response>): Promise<Record<string, any>> => (await p).json();

async function readFrames(res: Response, stopAfterMs = 8000): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = "";
  const end = Date.now() + stopAfterMs;
  for (;;) {
    const { done, value } = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value?: undefined }>((ok) =>
        setTimeout(() => ok({ done: true }), Math.max(1, end - Date.now())),
      ),
    ]);
    if (done) break;
    out += dec.decode(value);
  }
  return out;
}

describe("history: list, search, filter, paginate, rename, delete", () => {
  it("works end to end for the owner", async () => {
    const u = await makeUser({ credits: 2000 });
    asUser(u);
    const ids: string[] = [];
    for (const q of ["Alpha ransomware group", "Beta malware family", "Gamma 100%_CVE"]) {
      const created = await jsonOf(
        collection.POST(r("/api/investigations", "POST", { query: q, depth: "quick" })),
      );
      ids.push(created.id);
      await postEvent(created.id, 1, { type: "failed", reason: "error", stages_completed: [] });
    }
    const all = await jsonOf(collection.GET(r("/api/investigations")));
    expect(all.total).toBe(3);
    expect(all.items.map((i: { title: string }) => i.title)).toEqual([
      "Gamma 100%_CVE",
      "Beta malware family",
      "Alpha ransomware group",
    ]);
    expect(all.items[0]).toMatchObject({ depth: "quick", status: "failed", creditsCharged: 0 });

    expect((await jsonOf(collection.GET(r("/api/investigations?q=malware")))).total).toBe(1);
    expect((await jsonOf(collection.GET(r("/api/investigations?q=%25_")))).total).toBe(1); // LIKE wildcards are escaped
    expect((await jsonOf(collection.GET(r("/api/investigations?q=%25")))).total).toBe(1);
    expect((await jsonOf(collection.GET(r("/api/investigations?status=failed")))).total).toBe(3);
    expect((await jsonOf(collection.GET(r("/api/investigations?status=completed")))).total).toBe(0);
    expect((await collection.GET(r("/api/investigations?status=nonsense"))).status).toBe(400);
    const page = await jsonOf(collection.GET(r("/api/investigations?limit=2&offset=2")));
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(3);

    // rename, then search by the new title; blank resets to the query
    const id = ids[0]!;
    expect(
      (
        await jsonOf(
          item.PATCH(r(`/api/investigations/${id}`, "PATCH", { title: "  Renamed  " }), ctxFor(id)),
        )
      ).title,
    ).toBe("Renamed");
    expect((await jsonOf(collection.GET(r("/api/investigations?q=renamed")))).items[0].title).toBe("Renamed");
    expect((await jsonOf(item.GET(r(`/api/investigations/${id}`), ctxFor(id)))).title).toBe("Renamed");
    expect(
      (await jsonOf(item.PATCH(r(`/api/investigations/${id}`, "PATCH", { title: "" }), ctxFor(id)))).title,
    ).toBeNull();
    expect((await jsonOf(item.GET(r(`/api/investigations/${id}`), ctxFor(id)))).title).toBe(
      "Alpha ransomware group",
    );
    expect((await item.PATCH(r(`/api/investigations/${id}`, "PATCH", { title: 5 }), ctxFor(id))).status).toBe(
      400,
    );
    expect(
      (await item.PATCH(r(`/api/investigations/${id}`, "PATCH", { title: "x".repeat(201) }), ctxFor(id)))
        .status,
    ).toBe(400);

    // delete: snapshot rows go by cascade, ledger rows stay
    await db().withSystem("t", (tx) =>
      tx.insert(invSummary).values({ userId: u.id, investigationId: id, markdown: "m", confidence: "high" }),
    );
    expect((await item.DELETE(r(`/api/investigations/${id}`, "DELETE"), ctxFor(id))).status).toBe(200);
    expect(await runRow(id)).toBeUndefined();
    const left = await db().withSystem(
      "t",
      (tx) => tx.select().from(invSummary).where(eq(invSummary.investigationId, id)),
      { audit: false },
    );
    expect(left).toHaveLength(0);
    const ledger = await db().withSystem(
      "t",
      (tx) => tx.select().from(creditLedger).where(eq(creditLedger.investigationId, id)),
      { audit: false },
    );
    expect(ledger.length).toBeGreaterThan(0);
    expect((await item.GET(r(`/api/investigations/${id}`), ctxFor(id))).status).toBe(404);
    expect((await item.DELETE(r(`/api/investigations/${id}`, "DELETE"), ctxFor(id))).status).toBe(404);
  });

  it("refuses to delete a running investigation until it is cancelled", async () => {
    const u = await makeUser();
    asUser(u);
    const created = await jsonOf(
      collection.POST(r("/api/investigations", "POST", { query: "still running", depth: "quick" })),
    );
    const id = created.id as string;
    await postEvent(id, 1, { type: "stage", stage: "refine", status: "start" });
    const del = await item.DELETE(r(`/api/investigations/${id}`, "DELETE"), ctxFor(id));
    expect(del.status).toBe(409);
    expect((await del.json()).error).toBe("not_terminal");
    expect(await runRow(id)).toBeDefined();
    // cancel is accepted, the engine acknowledges, then delete works
    expect((await cancelRoute.POST(r(`/api/investigations/${id}/cancel`, "POST"), ctxFor(id))).status).toBe(
      202,
    );
    expect(stub.cancels).toContain(`stub-${id}`);
    await postEvent(id, 2, { type: "cancelled", reason: "cancelled", stages_completed: [] });
    expect((await runRow(id))!.status).toBe("cancelled");
    expect(await balanceOf(u.id)).toBe(1000); // zero stages completed: full refund
    expect((await cancelRoute.POST(r(`/api/investigations/${id}/cancel`, "POST"), ctxFor(id))).status).toBe(
      409,
    ); // already finished
    expect((await item.DELETE(r(`/api/investigations/${id}`, "DELETE"), ctxFor(id))).status).toBe(200);
  });

  it("cancel of a launching run (engine silent) settles through the watchdog after the timeout with a full refund", async () => {
    const u = await makeUser();
    asUser(u);
    const { id } = await startInvestigation(u, { query: "cancel while launching", depth: "standard" });
    const res = await cancelRoute.POST(r(`/api/investigations/${id}/cancel`, "POST"), ctxFor(id));
    expect(await res.json()).toMatchObject({ status: "launching", cancelRequested: true });
    expect((await runRow(id))!.cancelRequestedAt).not.toBeNull();
    expect((await runWatchdog()).cancelled).not.toContain(id);
    expect((await runWatchdog(new Date(Date.now() + 61_000))).cancelled).toContain(id);
    expect(await balanceOf(u.id)).toBe(1000);
    const snap = await jsonOf(item.GET(r(`/api/investigations/${id}`), ctxFor(id)));
    expect(snap).toMatchObject({
      status: "cancelled",
      creditsReserved: 40,
      creditsRefunded: 40,
      creditsNet: 0,
    });
  });

  it("the snapshot reports stages, counts, refined queries and refunds", async () => {
    const u = await makeUser();
    asUser(u);
    const { id } = await startInvestigation(u, { query: "snapshot me", depth: "standard" });
    await postEvent(id, 1, { type: "stage", stage: "refine", status: "start" });
    await postEvent(id, 2, { type: "refined", stage: "refine", refined_queries: ["q1", "q2"] });
    await postEvent(id, 3, { type: "stage", stage: "refine", status: "end" });
    await postEvent(id, 4, { type: "stage", stage: "collect", status: "start" });
    await postEvent(id, 5, {
      type: "counts",
      stage: "collect",
      counts: { sources_queried: 7, results_found: 3, pages_fetched: 0, entities_found: 0, actors_found: 0 },
    });
    const snap = await jsonOf(item.GET(r(`/api/investigations/${id}`), ctxFor(id)));
    expect(snap).toMatchObject({
      status: "running",
      refinedQueries: ["q1", "q2"],
      stagesCompleted: ["refine"],
      currentStage: "collect",
      creditsReserved: 40,
      creditsRefunded: 0,
      eventCount: 5,
    });
    expect(snap.counts.sources_queried).toBe(7);
  });
});

describe("SSE", () => {
  it("streams stored events with ids, a status frame, resumes from Last-Event-ID and closes after the terminal status", async () => {
    const u = await makeUser();
    asUser(u);
    const { id } = await startInvestigation(u, { query: "stream me", depth: "quick" });
    await postEvent(id, 1, { type: "stage", stage: "refine", status: "start" });
    await postEvent(id, 2, { type: "refined", stage: "refine", refined_queries: ["x"] });
    await postEvent(id, 3, { type: "stage", stage: "refine", status: "end" });
    await postEvent(id, 4, { type: "failed", reason: "error", stages_completed: ["refine"] });

    const res = await sseRoute.GET(r(`/api/investigations/${id}/events`), ctxFor(id));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await readFrames(res);
    for (const seq of [1, 2, 3, 4]) expect(text).toContain(`id: ${seq}\nevent: progress`);
    expect(text).toContain('"status":"end"');
    const statusFrames = text.split("\n\n").filter((f) => f.startsWith("event: status"));
    expect(statusFrames).toHaveLength(1);
    expect(JSON.parse(statusFrames[0]!.split("data: ")[1]!)).toMatchObject({
      status: "failed",
      refinedQueries: ["x"],
      failureReason: "error",
      creditsRefunded: 20,
    });

    const resumed = await sseRoute.GET(
      new Request(`${APP}/api/investigations/${id}/events`, { headers: { "last-event-id": "2" } }),
      ctxFor(id),
    );
    const text2 = await readFrames(resumed);
    expect(text2).not.toContain("id: 1\n");
    expect(text2).not.toContain("id: 2\n");
    expect(text2).toContain("id: 3\n");
    expect(text2).toContain("id: 4\n");
  });

  it("delivers live events while open and aborts with the request signal", async () => {
    const u = await makeUser();
    asUser(u);
    const { id } = await startInvestigation(u, { query: "live stream", depth: "quick" });
    const res = await sseRoute.GET(new Request(`${APP}/api/investigations/${id}/events`), ctxFor(id));
    setTimeout(() => void postEvent(id, 1, { type: "stage", stage: "refine", status: "start" }), 300);
    setTimeout(() => void postEvent(id, 2, { type: "completed", stages_completed: [] }), 600);
    const text = await readFrames(res);
    expect(text).toContain("id: 1\n");
    expect(text).toContain('"status":"completed"');
  });

  it("closes when the client aborts, even though the run is still active", async () => {
    const u = await makeUser();
    asUser(u);
    const { id } = await startInvestigation(u, { query: "open and abort", depth: "quick" });
    const ac = new AbortController();
    const res = await sseRoute.GET(
      new Request(`${APP}/api/investigations/${id}/events`, { signal: ac.signal }),
      ctxFor(id),
    );
    setTimeout(() => ac.abort(), 400);
    const t0 = Date.now();
    const text = await readFrames(res, 5000);
    expect(Date.now() - t0).toBeLessThan(3000); // ended by the abort, not by the reader's 5 s guard
    expect(text).toContain('"status":"launching"');
  });
});

describe("launcher selection", () => {
  it("ENGINE_LAUNCHER=mock selects the mock, and the cloud launcher is a stub that throws", async () => {
    setLauncher(null);
    expect(launcherKind()).toBe("mock");
    expect(getLauncher().constructor.name).toBe("MockLauncher");
    await expect(
      new CloudRunLauncher().launch({ runId: "r", specUrl: "u", deadlineAt: "d" }),
    ).rejects.toThrow(/not implemented \(R0\)/);
    setLauncher(stub);
  });
});
