import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runEvents } from "@voidaccess/db";
import * as sseRoute from "@/app/api/investigations/[id]/events/route";
import { resetIngest, useNoopIngest } from "@/lib/runs/ingest";
import { getInvestigation, startInvestigation } from "@/lib/runs/service";
import { setLauncher } from "@/lib/launcher";
import {
  APP,
  StubLauncher,
  asUser,
  ctxFor,
  db,
  makeUser,
  postEvent,
  sameOrigin,
  waitTerminal,
} from "./helpers";
import * as cancelRoute from "@/app/api/investigations/[id]/cancel/route";
import { runWatchdog } from "@/lib/runs/watchdog";
import { patchRun } from "./helpers";

setLauncher(new StubLauncher());
beforeEach(() => useNoopIngest());
afterEach(() => resetIngest());

const rows = (id: string) =>
  db().withSystem(
    "test.events",
    (tx) => tx.select().from(runEvents).where(eq(runEvents.runId, id)).orderBy(runEvents.seq),
    { audit: false },
  );

describe("H1-4: stage events are stored as type `stage` + status", () => {
  it("stores start/end/skipped/failed as status on type stage, and other events with a null status", async () => {
    const u = await makeUser();
    asUser(u);
    const { id } = await startInvestigation(u, { query: "status shape", depth: "standard" });
    await postEvent(id, 1, { type: "stage", stage: "refine", status: "start" });
    await postEvent(id, 2, { type: "stage", stage: "refine", status: "end" });
    await postEvent(id, 3, { type: "stage", stage: "collect", status: "skipped" });
    await postEvent(id, 4, { type: "stage", stage: "fetch", status: "failed" });
    await postEvent(id, 5, { type: "stage", stage: "extract" }); // no status means start
    await postEvent(id, 6, { type: "refined", refined_queries: ["a"] });
    const stored = (await rows(id)).map((r) => [r.seq, r.type, r.stage, r.status]);
    expect(stored).toEqual([
      [1, "stage", "refine", "start"],
      [2, "stage", "refine", "end"],
      [3, "stage", "collect", "skipped"],
      [4, "stage", "fetch", "failed"],
      [5, "stage", "extract", "start"],
      [6, "refined", null, null],
    ]);
    // only `end` counts as completed; skipped/failed do not
    const snap = await getInvestigation(u.id, id);
    expect(snap!.stagesCompleted).toEqual(["refine"]);
    expect(snap!.currentStage).toBe("extract");
  });

  it("the SSE stream reports the same shape", async () => {
    const u = await makeUser();
    asUser(u);
    const { id } = await startInvestigation(u, { query: "sse shape", depth: "quick" });
    await postEvent(id, 1, { type: "stage", stage: "refine", status: "start" });
    await postEvent(id, 2, { type: "stage", stage: "refine", status: "end" });
    await postEvent(id, 3, { type: "stage", stage: "collect", status: "skipped" });
    await postEvent(id, 4, { type: "failed", reason: "error" });
    const res = await sseRoute.GET(
      new Request(`${APP}/api/investigations/${id}/events`, { headers: sameOrigin }),
      ctxFor(id),
    );
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let out = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out += dec.decode(value);
    }
    const frames = [...out.matchAll(/event: progress\ndata: (.*)\n/g)].map((m) => JSON.parse(m[1]!));
    expect(frames.map((f) => [f.type, f.stage, f.status])).toEqual([
      ["stage", "refine", "start"],
      ["stage", "refine", "end"],
      ["stage", "collect", "skipped"],
      ["failed", null, undefined],
    ]);
  });

  it("cancel settlement derives completed stages from the new shape (refine ended, collect only skipped)", async () => {
    const u = await makeUser({ credits: 500 });
    asUser(u);
    const { id } = await startInvestigation(u, { query: "cancel shape", depth: "standard" });
    await postEvent(id, 1, { type: "stage", stage: "refine", status: "start" });
    await postEvent(id, 2, { type: "stage", stage: "refine", status: "end" });
    await postEvent(id, 3, { type: "stage", stage: "collect", status: "skipped" });
    await cancelRoute.POST(
      new Request(`${APP}/api/investigations/${id}/cancel`, { method: "POST", headers: sameOrigin }),
      ctxFor(id),
    );
    await patchRun(id, { cancelRequestedAt: new Date(Date.now() - 120_000) });
    await runWatchdog();
    const run = await waitTerminal(id);
    expect(run.status).toBe("cancelled");
    const { cancelRefundAmount } = await import("@/lib/runs/settle");
    const refunded = 40 - (run.creditsCharged as number);
    expect(refunded).toBe(cancelRefundAmount(40, ["refine"]));
  });
});
