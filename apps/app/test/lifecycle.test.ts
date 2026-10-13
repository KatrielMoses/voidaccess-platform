import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEPTHS, type Depth } from "@voidaccess/config";
import { events } from "@voidaccess/db";
import { eq } from "drizzle-orm";
import * as listRoute from "@/app/api/investigations/route";
import * as cancelRoute from "@/app/api/investigations/[id]/cancel/route";
import { MockLauncher, setLauncher } from "@/lib/launcher";
import type { MockEngineMode } from "@/lib/launcher/mock";
import { readMockBundle } from "@/lib/launcher/artifacts";
import { registerIngest, resetIngest } from "@/lib/runs/ingest";
import { cancelRefundAmount } from "@/lib/runs/settle";
import { startInvestigation } from "@/lib/runs/service";
import {
  asUser,
  balanceOf,
  ctxFor,
  db,
  ledgerOf,
  makeUser,
  routeFetch,
  runRow,
  sameOrigin,
  waitFor,
  waitTerminal,
  APP,
} from "./helpers";

let mock: MockLauncher;
const useMock = (mode: MockEngineMode, durationMs = 600) => {
  mock = new MockLauncher({ mode, durationMs, fetchImpl: routeFetch });
  setLauncher(mock);
};
beforeEach(() => resetIngest());
afterEach(async () => {
  await mock?.whenIdle();
  setLauncher(null);
  resetIngest();
});

const sum = (rows: { amount: number }[]) => rows.reduce((a, r) => a + r.amount, 0);

describe("lifecycle per mock mode (real routes, real Postgres)", () => {
  // stages the mock completes before it stops (stopAtStageIndex 4): refine, collect, filter, fetch = weights 2+20+2+22
  const COMPLETED_BEFORE_STOP = ["refine", "collect", "filter", "fetch"];
  const table: {
    mode: MockEngineMode;
    depth: Depth;
    status: string;
    reason: string | null;
    refund: (charged: number) => number;
  }[] = [
    { mode: "success", depth: "quick", status: "completed", reason: null, refund: () => 0 },
    { mode: "failure", depth: "standard", status: "failed", reason: "error", refund: (c) => c },
    { mode: "blocked", depth: "quick", status: "failed", reason: "blocked_query", refund: (c) => c },
    { mode: "deadline", depth: "standard", status: "failed", reason: "deadline", refund: (c) => c },
    {
      mode: "cancel",
      depth: "standard",
      status: "cancelled",
      reason: "cancelled",
      refund: (c) => cancelRefundAmount(c, COMPLETED_BEFORE_STOP),
    },
  ];

  it.each(table)("$mode -> $status with the right ledger", async (row) => {
    useMock(row.mode);
    const u = await makeUser({ credits: 500 });
    const price = DEPTHS[row.depth].credits;
    const started = await startInvestigation(u, { query: "LockBit ransomware affiliates", depth: row.depth });
    expect(started.creditsCharged).toBe(price);
    expect(await balanceOf(u.id)).toBe(500 - price); // reserved immediately, exactly the config price

    const run = await waitTerminal(started.id);
    await mock.whenIdle();
    expect(run.status).toBe(row.status);
    expect(run.failureReason).toBe(row.reason);

    const rows = await ledgerOf(started.id);
    const reserves = rows.filter((r) => r.reason === "reserve");
    const refunds = rows.filter((r) => r.reason === "refund");
    expect(sum(reserves)).toBe(-price);
    expect(sum(refunds)).toBe(row.refund(price));
    expect(await balanceOf(u.id)).toBe(500 - price + row.refund(price));
    expect(run.creditsCharged).toBe(price - row.refund(price)); // net charge
    if (row.mode === "cancel") {
      expect(sum(refunds)).toBe(22); // ceil(40 * 54 / 100): a worked example, not just the formula
    }
    console.log(
      `[ledger] ${row.mode.padEnd(8)} ${row.depth.padEnd(8)} status=${run.status} reserve=${sum(reserves)} refund=${sum(refunds)} net=${run.creditsCharged}`,
    );
  });

  it("success runs the ingest hook exactly once in status ingesting, then completes with the bundle stored", async () => {
    useMock("success");
    const seen: string[] = [];
    registerIngest(async (id) => {
      seen.push((await runRow(id))!.status);
    });
    const u = await makeUser();
    const { id } = await startInvestigation(u, { query: "Cl0p MOVEit", depth: "quick" });
    const run = await waitTerminal(id);
    expect(run.status).toBe("completed");
    expect(seen).toEqual(["ingesting"]);
    expect(run.refinedQueries.length).toBeGreaterThan(0);
    expect(run.executionId).toBe(`mock-${id}`);
    expect(JSON.parse((await readMockBundle(id))!).run_id).toBe(id);
  });

  it("an ingest failure fails the run with a full refund", async () => {
    useMock("success");
    registerIngest(async () => {
      throw new Error("bundle invalid");
    });
    const u = await makeUser({ credits: 100 });
    const { id } = await startInvestigation(u, { query: "Cl0p MOVEit", depth: "quick" });
    const run = await waitTerminal(id);
    expect(run.status).toBe("failed");
    expect(run.failureReason).toBe("ingest_failure");
    expect(await balanceOf(u.id)).toBe(100);
  });

  it("a user cancel through the real route settles the partial refund by the stages that ran", async () => {
    useMock("success", 1800);
    const u = await makeUser({ credits: 500 });
    asUser(u);
    const created = await listRoute.POST(
      new Request(`${APP}/api/investigations`, {
        method: "POST",
        headers: sameOrigin,
        body: JSON.stringify({ query: "BlackCat ALPHV", depth: "standard" }),
      }),
    );
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    // wait until the collect stage has finished, then cancel
    await waitFor(async () => {
      const r = await db().withSystem(
        "test.read",
        (tx) =>
          tx.query.runEvents.findMany({
            where: (e, { and, eq }) => and(eq(e.runId, id), eq(e.type, "stage"), eq(e.status, "end")),
          }),
        { audit: false },
      );
      return r.some((e) => e.stage === "collect") || undefined;
    });
    const res = await cancelRoute.POST(
      new Request(`${APP}/api/investigations/${id}/cancel`, { method: "POST", headers: sameOrigin }),
      ctxFor(id),
    );
    expect(res.status).toBe(202);
    const run = await waitTerminal(id);
    expect(run.status).toBe("cancelled");
    const stages = (
      await db().withSystem(
        "test.read",
        (tx) =>
          tx.query.runEvents.findMany({
            where: (e, { and, eq }) => and(eq(e.runId, id), eq(e.type, "stage"), eq(e.status, "end")),
          }),
        { audit: false },
      )
    ).map((e) => e.stage!);
    const refund = sum((await ledgerOf(id)).filter((r) => r.reason === "refund"));
    expect(refund).toBe(cancelRefundAmount(40, stages));
    expect(refund).toBeGreaterThan(0);
    expect(refund).toBeLessThan(40);
    expect(await balanceOf(u.id)).toBe(500 - 40 + refund);
  });

  it("records first_investigation_started / completed once, with first-touch attribution", async () => {
    useMock("success");
    const u = await makeUser();
    await db().withSystem(
      "test.ft",
      async (tx) => {
        const { users } = await import("@voidaccess/db");
        await tx
          .update(users)
          .set({ firstTouch: { utm: { utm_source: "hn" }, ref: "abc" } })
          .where(eq(users.id, u.id));
      },
      { audit: false },
    );
    const a = await startInvestigation(u, { query: "first run query", depth: "quick" });
    await waitTerminal(a.id);
    const b = await startInvestigation(u, { query: "second run query", depth: "quick" });
    await waitTerminal(b.id);
    await mock.whenIdle();
    const rows = await db().withSystem(
      "test.ev",
      (tx) => tx.select().from(events).where(eq(events.userId, u.id)),
      {
        audit: false,
      },
    );
    expect(rows.filter((r) => r.name === "first_investigation_started")).toHaveLength(1);
    expect(rows.filter((r) => r.name === "first_investigation_completed")).toHaveLength(1);
    expect(rows[0]!.utm).toEqual({ utm_source: "hn" });
    expect(rows[0]!.ref).toBe("abc");
  });
});
