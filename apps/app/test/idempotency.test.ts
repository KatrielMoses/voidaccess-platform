import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { runEvents } from "@voidaccess/db";
import { setLauncher } from "@/lib/launcher";
import { resetIngest, useNoopIngest } from "@/lib/runs/ingest";
import { startInvestigation } from "@/lib/runs/service";
import { runWatchdog } from "@/lib/runs/watchdog";
import { StubLauncher, balanceOf, db, ledgerOf, makeUser, patchRun, postEvent, runRow } from "./helpers";

const stub = new StubLauncher();
setLauncher(stub);
// lifecycle-only: completions are posted by hand without a bundle, so skip the real ingest
beforeEach(() => useNoopIngest());
afterEach(() => resetIngest());

const sum = (rows: { amount: number }[]) => rows.reduce((a, r) => a + r.amount, 0);
async function newRun(credits = 500, depth: "quick" | "standard" = "standard") {
  const u = await makeUser({ credits });
  const r = await startInvestigation(u, { query: "idempotency test query", depth });
  return { u, id: r.id, price: depth === "quick" ? 20 : 40 };
}
const eventCount = async (id: string) =>
  (
    await db().withSystem("t", (tx) => tx.select().from(runEvents).where(eq(runEvents.runId, id)), {
      audit: false,
    })
  ).length;
const STAGES_DONE = ["refine", "collect", "filter", "fetch"] as const;

describe("idempotency", () => {
  it("duplicate callbacks are 200 no-ops; a duplicated terminal event refunds once", async () => {
    const { u, id } = await newRun();
    expect((await postEvent(id, 1, { type: "stage", stage: "refine", status: "start" })).body.result).toBe(
      "recorded",
    );
    const dup = await postEvent(id, 1, { type: "stage", stage: "refine", status: "start" });
    expect(dup.status).toBe(200);
    expect(dup.body.result).toBe("duplicate");
    expect(await eventCount(id)).toBe(1);
    expect((await runRow(id))!.status).toBe("running");

    await postEvent(id, 2, { type: "failed", reason: "error", stages_completed: [] });
    const again = await postEvent(id, 2, { type: "failed", reason: "error", stages_completed: [] });
    expect(again.status).toBe(200);
    expect(await postEvent(id, 3, { type: "failed", reason: "error", stages_completed: [] })).toMatchObject({
      status: 200,
    });
    const rows = await ledgerOf(id);
    expect(rows.filter((r) => r.reason === "refund")).toHaveLength(1);
    expect(sum(rows)).toBe(0);
    expect(await balanceOf(u.id)).toBe(500);
    expect((await runRow(id))!.status).toBe("failed");
  });

  it("out-of-order seq is accepted and the state never moves backwards", async () => {
    const { id } = await newRun();
    await postEvent(id, 3, {
      type: "counts",
      stage: "collect",
      counts: { sources_queried: 3, results_found: 0, pages_fetched: 0, entities_found: 0, actors_found: 0 },
    });
    expect((await runRow(id))!.status).toBe("running");
    await postEvent(id, 1, { type: "stage", stage: "refine", status: "start" });
    await postEvent(id, 2, { type: "refined", refined_queries: ["a", "b"] });
    expect(await eventCount(id)).toBe(3);
    expect((await runRow(id))!.status).toBe("running");
    expect((await runRow(id))!.refinedQueries).toEqual(["a", "b"]);
    await postEvent(id, 10, { type: "completed", stages_completed: [...STAGES_DONE] });
    expect((await runRow(id))!.status).toBe("completed");
    // a stage event with a LOWER seq after completion: ignored
    const late = await postEvent(id, 4, { type: "stage", stage: "fetch", status: "start" });
    expect(late.body.result).toBe("ignored");
    expect((await runRow(id))!.status).toBe("completed");
    expect(await eventCount(id)).toBe(4);
  });

  it("a late event after a terminal one is ignored: 200, no write, no ledger change", async () => {
    const { u, id, price } = await newRun();
    await postEvent(id, 1, { type: "stage", stage: "refine", status: "start" });
    await postEvent(id, 2, { type: "cancelled", reason: "cancelled", stages_completed: [...STAGES_DONE] });
    const before = await ledgerOf(id);
    const balance = await balanceOf(u.id);
    for (const [seq, ev] of [
      [3, { type: "stage", stage: "extract", status: "start" }],
      [4, { type: "failed", reason: "error", stages_completed: [] }],
      [5, { type: "completed", stages_completed: [...STAGES_DONE] }],
      [6, { type: "cancelled", stages_completed: [] }],
    ] as const) {
      const r = await postEvent(id, seq, ev as never);
      expect(r.status).toBe(200);
      expect(r.body.result).toBe("ignored");
    }
    expect(await ledgerOf(id)).toHaveLength(before.length);
    expect(await balanceOf(u.id)).toBe(balance);
    expect((await runRow(id))!.status).toBe("cancelled");
    expect(await eventCount(id)).toBe(2);
    expect(sum(before.filter((r) => r.reason === "refund"))).toBe(Math.ceil((price * 54) / 100));
  });

  it("watchdog after a real terminal event does nothing; a terminal event after the watchdog is ignored", async () => {
    const a = await newRun();
    await postEvent(a.id, 1, { type: "failed", reason: "blocked_query", stages_completed: [] });
    const w1 = await runWatchdog(new Date(Date.now() + 3_600_000));
    expect([...w1.failed, ...w1.cancelled]).not.toContain(a.id);
    expect(sum((await ledgerOf(a.id)).filter((r) => r.reason === "refund"))).toBe(a.price);

    const b = await newRun();
    await postEvent(b.id, 1, { type: "stage", stage: "refine", status: "start" });
    const w2 = await runWatchdog(new Date(Date.now() + 11 * 60_000));
    expect(w2.failed).toContain(b.id);
    const late = await postEvent(b.id, 2, { type: "completed", stages_completed: [...STAGES_DONE] });
    expect(late.body.result).toBe("ignored");
    expect((await runRow(b.id))!.status).toBe("failed");
    expect((await runRow(b.id))!.failureReason).toBe("watchdog");
    const rows = await ledgerOf(b.id);
    expect(rows.filter((r) => r.reason === "refund")).toHaveLength(1);
    expect(sum(rows)).toBe(0);
    expect(stub.cancels).toContain(`stub-${b.id}`); // the stuck execution is told to stop
    await runWatchdog(new Date(Date.now() + 12 * 60_000)); // and a second pass is a no-op
    expect(sum(await ledgerOf(b.id))).toBe(0);
  });

  it("a real completion racing the watchdog settles exactly once (whoever locks first wins)", async () => {
    const outcomes = { completed: 0, failed: 0 };
    for (let i = 0; i < 8; i++) {
      const { u, id, price } = await newRun(200, "quick");
      await postEvent(id, 1, { type: "stage", stage: "refine", status: "start" });
      // make it silent past the watchdog window, then race
      await patchRun(id, { lastEventAt: new Date(Date.now() - 11 * 60_000) });
      const [cb] = await Promise.all([
        postEvent(id, 2, { type: "completed", stages_completed: [...STAGES_DONE] }),
        runWatchdog(),
        runWatchdog(),
      ]);
      expect(cb.status).toBe(200);
      const run = (await runRow(id))!;
      const rows = await ledgerOf(id);
      const refunds = rows.filter((r) => r.reason === "refund");
      if (run.status === "completed") {
        outcomes.completed++;
        expect(refunds).toHaveLength(0);
        expect(await balanceOf(u.id)).toBe(200 - price);
      } else {
        expect(run.status).toBe("failed");
        outcomes.failed++;
        expect(refunds).toHaveLength(1);
        expect(sum(refunds)).toBe(price);
        expect(await balanceOf(u.id)).toBe(200);
      }
    }
    console.log("[race] completed:", outcomes.completed, "failed (watchdog won):", outcomes.failed);
  });

  it("the watchdog fails silent, launching-stuck and reserved-stuck runs, and leaves fresh ones alone", async () => {
    const fresh = await newRun();
    await postEvent(fresh.id, 1, { type: "stage", stage: "refine", status: "start" });
    const stuckLaunch = await newRun(); // launching, never heard from
    const now = await runWatchdog(); // real clock: nothing is stale
    expect([...now.failed, ...now.cancelled]).not.toContain(fresh.id);
    expect([...now.failed, ...now.cancelled]).not.toContain(stuckLaunch.id);

    const later = await runWatchdog(new Date(Date.now() + 9 * 60_000)); // past LAUNCHING_STUCK (8 min), not past silence (10 min)
    expect(later.failed).toContain(stuckLaunch.id);
    expect(later.failed).not.toContain(fresh.id);
    expect(await balanceOf(stuckLaunch.u.id)).toBe(500);

    const reserved = await newRun();
    await patchRun(reserved.id, { status: "reserved" }); // the process died between reserve and launch
    const l2 = await runWatchdog(new Date(Date.now() + 3 * 60_000));
    expect(l2.failed).toContain(reserved.id);
    expect(await balanceOf(reserved.u.id)).toBe(500);
  });

  it("a cancel nobody acknowledged is settled by the watchdog after the timeout (partial refund by stored stage events)", async () => {
    const { u, id, price } = await newRun();
    await postEvent(id, 1, { type: "stage", stage: "refine", status: "start" });
    await postEvent(id, 2, { type: "stage", stage: "refine", status: "end" });
    await postEvent(id, 3, { type: "stage", stage: "collect", status: "start" });
    await patchRun(id, { cancelRequestedAt: new Date() });
    expect((await runWatchdog()).cancelled).not.toContain(id); // not yet
    const r = await runWatchdog(new Date(Date.now() + 90_000));
    expect(r.cancelled).toContain(id);
    const refund = sum((await ledgerOf(id)).filter((x) => x.reason === "refund"));
    expect(refund).toBe(Math.ceil((price * 98) / 100)); // only refine (2) completed
    expect(await balanceOf(u.id)).toBe(500 - price + refund);
    expect((await runRow(id))!.status).toBe("cancelled");
  });
});
