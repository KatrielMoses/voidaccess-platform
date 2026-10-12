import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { DEPTHS, FOUNDING, PLANS } from "@voidaccess/config";
import {
  abuseFlags,
  claimFoundingSeat,
  investigations,
  payments,
  reserve,
  runCosts,
  subscriptions,
  users,
} from "@voidaccess/db";
import { ABUSE_BLOCKED_THRESHOLD } from "@/lib/admin/constants";
import { markAbuseReviewed } from "@/lib/admin/actions";
import {
  PRO_USD_PER_CREDIT,
  getAbuseQueue,
  getCostReport,
  getCostRunsForExport,
  getFounding,
  getOverview,
  monthlyUsdOf,
  percentile,
  searchUsers,
} from "@/lib/admin/queries";
import { costsCsv } from "@/lib/admin/costs-csv";
import { db, makeUser } from "./helpers";
import { addInvestigation, audits, makeAdmin } from "./admin-helpers";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const sys = <T>(fn: Parameters<ReturnType<typeof db>["withSystem"]>[1]) =>
  db().withSystem("t", fn as never, { audit: false }) as Promise<T>;

describe("abuse queue", () => {
  it("lists blocked_query runs, repeat users at the threshold, open flags, and says none for rate limits when H1's table is absent", async () => {
    const admin = await makeAdmin();
    const few = await makeUser({ credits: 0 });
    const many = await makeUser({ credits: 0 });
    const fewRun = await addInvestigation(few.id, {
      status: "failed",
      failureReason: "blocked_query",
      query: "one bad query",
    });
    for (let i = 0; i < ABUSE_BLOCKED_THRESHOLD; i++)
      await addInvestigation(many.id, {
        status: "failed",
        failureReason: "blocked_query",
        query: `bad ${i}`,
      });
    await addInvestigation(many.id, { status: "failed", failureReason: "no_results" }); // not blocked: must not count
    const [flag] = await sys<Array<{ id: string }>>((tx) =>
      tx
        .insert(abuseFlags)
        .values({ userId: few.id, kind: "dispute", detail: { amount: 9 } })
        .returning({ id: abuseFlags.id }),
    );

    const q = await getAbuseQueue(admin.id);
    expect(q.blockedRuns.find((r) => r.id === fewRun)).toMatchObject({
      userId: few.id,
      query: "one bad query",
      email: few.email,
    });
    expect(q.blockedRuns.filter((r) => r.userId === many.id)).toHaveLength(ABUSE_BLOCKED_THRESHOLD);
    expect(q.repeatUsers.map((u) => u.userId)).toContain(many.id);
    expect(q.repeatUsers.map((u) => u.userId)).not.toContain(few.id);
    expect(q.repeatUsers.find((u) => u.userId === many.id)!.blocked).toBe(ABUSE_BLOCKED_THRESHOLD);
    expect(q.flags.find((f) => f.id === flag!.id)).toMatchObject({ kind: "dispute", userId: few.id });
    expect(q.rateLimits).toEqual({ available: false, rows: [] });
    // the queue shows query text, so opening it is an audited read
    expect((await audits("admin.abuse.view")).some((a) => a.actor === admin.id)).toBe(true);

    // reviewing removes each item from the queue
    await markAbuseReviewed(admin, { kind: "run", id: fewRun }, "reviewed", "looked, nothing to do");
    await markAbuseReviewed(admin, { kind: "user", id: many.id }, "actioned", "warned the user");
    await markAbuseReviewed(admin, { kind: "flag", id: flag!.id }, "dismissed", "refund was legitimate");
    const after = await getAbuseQueue(admin.id);
    expect(after.blockedRuns.map((r) => r.id)).not.toContain(fewRun);
    expect(after.repeatUsers.map((u) => u.userId)).not.toContain(many.id);
    expect(after.flags.map((f) => f.id)).not.toContain(flag!.id);
    // ...and a new blocked query after the review brings the user back once they cross the threshold again
    for (let i = 0; i < ABUSE_BLOCKED_THRESHOLD; i++)
      await addInvestigation(many.id, { status: "failed", failureReason: "blocked_query" });
    expect((await getAbuseQueue(admin.id)).repeatUsers.map((u) => u.userId)).toContain(many.id);
  });
});

describe("cost view against fixture run_costs", () => {
  const NOW = new Date("2031-03-10T12:00:00Z");
  const AT = new Date("2031-03-10T08:00:00Z");

  async function costedRun(
    userId: string,
    depth: "quick" | "standard",
    cost: { compute: number; llm: number },
    o: { refund?: boolean; status?: "completed" | "failed" } = {},
  ) {
    const id = await addInvestigation(userId, { depth, status: o.status ?? "completed" });
    await db().withUser(userId, async (tx) => {
      await reserve(userId, id, depth, { tx });
    });
    if (o.refund)
      await db().withSystem(
        "t",
        async (tx) => (await import("@voidaccess/db")).refund(userId, id, {}, { tx }),
        { audit: false },
      );
    await sys((tx) =>
      tx.insert(runCosts).values({
        investigationId: id,
        computeUsd: cost.compute,
        llmUsd: cost.llm,
        tokensIn: 1000,
        tokensOut: 200,
        durationMs: 60_000,
        measuredAt: AT,
      }),
    );
    return id;
  }

  it("per-run margins, per-depth p50/p90 and the price check, per-day totals, worst runs, wasted spend, and the CSV", async () => {
    const u = await makeUser({ credits: 100_000 });
    const totals = [0.02, 0.03, 0.04, 0.05, 0.1];
    const ids: string[] = [];
    for (const t of totals) ids.push(await costedRun(u.id, "standard", { compute: t / 2, llm: t / 2 }));
    await costedRun(u.id, "quick", { compute: 0.004, llm: 0.004 });
    const failed = await costedRun(
      u.id,
      "standard",
      { compute: 0.01, llm: 0.005 },
      { refund: true, status: "failed" },
    );

    const r = await getCostReport({ days: 1 }, { now: NOW });
    expect(r.runs).toHaveLength(7);
    const std = r.byDepth.find((g) => g.key === "standard")!;
    expect(std.runs).toBe(6);
    expect(std.costP50).toBeCloseTo(0.04, 10);
    expect(std.costP90).toBeCloseTo(percentile(totals, 0.9), 10);
    expect(std.costP90).toBeCloseTo(0.08, 10);
    expect(std.costMax).toBeCloseTo(0.1, 10);
    // the price check: margin of the depth's credits at the Pro rate when a run costs its p90
    const rev = DEPTHS.standard.credits * PRO_USD_PER_CREDIT;
    expect(std.marginAtP90Pro).toBeCloseTo((rev - 0.08) / rev, 10);
    expect(r.byDepth.find((g) => g.key === "quick")!.runs).toBe(1);

    const run = r.runs.find((x) => x.id === ids[4])!;
    expect(run).toMatchObject({
      creditsNet: DEPTHS.standard.credits,
      creditsReserved: DEPTHS.standard.credits,
      costUsd: expect.closeTo(0.1, 10),
    });
    expect(run.revenueListUsd).toBeCloseTo(DEPTHS.standard.credits * 0.01, 10);
    expect(run.marginList).toBeCloseTo((0.4 - 0.1) / 0.4, 10);
    expect(run.marginPro).toBeCloseTo((0.18 - 0.1) / 0.18, 10);

    // a refunded run keeps no credits: no margin, and its cost is the money spent for nothing
    const lost = r.runs.find((x) => x.id === failed)!;
    expect(lost).toMatchObject({
      creditsNet: 0,
      creditsReserved: DEPTHS.standard.credits,
      marginPro: null,
      marginList: null,
    });
    expect(r.wastedUsd).toBeCloseTo(0.015, 10);
    expect(std.runs - r.runs.filter((x) => x.depth === "standard" && x.status === "completed").length).toBe(
      1,
    );

    expect(r.worstByCost[0]!.id).toBe(ids[4]);
    expect(r.worstByMargin[0]!.id).toBe(ids[4]);
    expect(r.worstByMargin.map((x) => x.id)).not.toContain(failed);
    expect(r.byDay).toHaveLength(1);
    expect(r.byDay[0]!.key).toBe("2031-03-10");
    expect(r.byDay[0]!.runs).toBe(7);

    // depth filter
    const q = await getCostReport({ days: 1, depth: "quick" }, { now: NOW });
    expect(q.runs).toHaveLength(1);

    // the CSV carries every run, one row each, and no query text
    const csv = costsCsv(await getCostRunsForExport({ days: 1 }, { now: NOW }));
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(8);
    expect(lines[0]).toContain("margin_pro_pct");
    expect(csv).toContain(ids[4]);
    expect(csv).not.toContain("test query");
  });

  it("an empty range is an empty report", async () => {
    const r = await getCostReport({ days: 1 }, { now: new Date("2041-01-01T00:00:00Z") });
    expect(r.runs).toEqual([]);
    expect(r.byDepth).toEqual([]);
    expect(r.wastedUsd).toBe(0);
  });
});

describe("overview: the #1 metric, MRR and counts", () => {
  it("computes first-investigation-within-24h per signup week from verified signups whose window has closed", async () => {
    const NOW = new Date("2032-06-16T12:00:00Z"); // a Wednesday; the week starts Mon 2032-06-14
    const hours = (n: number) => new Date(NOW.getTime() - n * 3_600_000);
    const mk = async (createdAt: Date, verified: boolean) => {
      const u = await makeUser({ credits: 0, emailVerified: verified });
      await sys((tx) => tx.update(users).set({ createdAt }).where(eq(users.id, u.id)));
      return u;
    };
    const done = (u: { id: string }, signup: Date, afterH: number) =>
      sys((tx) =>
        tx.insert(investigations).values({
          userId: u.id,
          query: "q",
          depth: "quick",
          status: "completed",
          createdAt: signup,
          completedAt: new Date(signup.getTime() + afterH * 3_600_000),
        }),
      );
    const a = await mk(hours(48), true); // converted in 2 h
    await done(a, hours(48), 2);
    const b = await mk(hours(47), true); // completed after 30 h: too late
    await done(b, hours(47), 30);
    await mk(hours(46), true); // never ran one
    const c = await mk(hours(10), true); // window still open: excluded from the rate
    await done(c, hours(10), 1);
    await mk(hours(40), false); // unverified: not counted at all

    const o = await getOverview({ now: NOW });
    const week = o.cohorts.find((x) => x.weekStart === "2032-06-14")!;
    expect(week).toMatchObject({ verified: 4, matured: 3, converted: 1 });
    expect(week.rate).toBeCloseTo(1 / 3, 10);
    expect(o.signups.d7).toBeGreaterThanOrEqual(5);
    expect(o.signups.verifiedD7).toBeGreaterThanOrEqual(4);
  });

  it("MRR comes from active subscriptions at config prices (annual / 12, founding price for founders)", async () => {
    expect(monthlyUsdOf("pro", "month", false)).toBe(PLANS.pro.monthlyUsd);
    expect(monthlyUsdOf("pro", "year", false)).toBeCloseTo(PLANS.pro.annualUsd! / 12, 10);
    expect(monthlyUsdOf("pro", "month", true)).toBe(FOUNDING.monthlyUsd);
    expect(monthlyUsdOf("free", "month", false)).toBe(0);
    const before = (await getOverview()).subscriptions.mrrUsd;
    const u = await makeUser({ plan: "pro_plus", credits: 0 });
    const f = await makeUser({ plan: "pro", credits: 0 });
    await sys((tx) =>
      tx.insert(subscriptions).values([
        {
          userId: u.id,
          providerSubscriptionId: `sub_${u.id}`,
          plan: "pro_plus",
          status: "active",
          interval: "month",
        },
        {
          userId: f.id,
          providerSubscriptionId: `sub_${f.id}`,
          plan: "pro",
          status: "active",
          interval: "month",
          isFounding: true,
        },
        {
          userId: f.id,
          providerSubscriptionId: `sub2_${f.id}`,
          plan: "pro",
          status: "cancelled",
          interval: "month",
        },
      ]),
    );
    const after = (await getOverview()).subscriptions.mrrUsd;
    expect(after - before).toBeCloseTo(PLANS.pro_plus.monthlyUsd + FOUNDING.monthlyUsd, 2);
  });

  it("runs per day, failure reasons and credits flow", async () => {
    const u = await makeUser({ credits: 0 });
    await addInvestigation(u.id, { status: "failed", failureReason: "p6-unique-reason" });
    const o = await getOverview();
    expect(o.failureReasons.find((r) => r.reason === "p6-unique-reason")!.n).toBe(1);
    expect(o.runsByDay.length).toBeGreaterThan(0);
    expect(o.credits.granted).toBeGreaterThan(0);
  });
});

describe("users search and founding view", () => {
  it("finds users by partial email or exact id, and pages", async () => {
    const u = await makeUser({ credits: 70 });
    const byEmail = await searchUsers(u.email.slice(0, 12), 0);
    expect(byEmail.rows.map((r) => r.id)).toContain(u.id);
    const byId = await searchUsers(u.id, 0);
    expect(byId.rows).toHaveLength(1);
    expect(byId.rows[0]).toMatchObject({ email: u.email, credits: 70, investigations: 0 });
    expect((await searchUsers("100%_\\", 0)).rows).toEqual([]); // LIKE wildcards are literal
    expect((await searchUsers("", 0)).rows.length).toBeLessThanOrEqual(50);
  });

  it("founding: holder, term, anniversary, paid months in the last 12, last investigation and available seats", async () => {
    const before = await getFounding();
    const u = await makeUser({ plan: "pro", credits: 0 });
    const seat = await claimFoundingSeat(u.id);
    expect(seat).not.toBeNull();
    const now = new Date();
    await sys((tx) =>
      tx.insert(payments).values(
        [0, 1, 2].map((m) => ({
          userId: u.id,
          providerPaymentId: `pay_${u.id}_${m}`,
          amountCents: 700,
          kind: "subscription" as const,
          paidAt: new Date(now.getTime() - m * 31 * 86_400_000),
          periodStart: new Date(now.getTime() - m * 31 * 86_400_000),
        })),
      ),
    );
    const last = await addInvestigation(u.id);
    expect(last).toBeTruthy();
    const f = await getFounding();
    expect(f.available).toBe(before.available - 1);
    const row = f.held.find((h) => h.userId === u.id)!;
    expect(row).toMatchObject({ seatNo: seat, email: u.email });
    expect(row.paidMonths12).toBeGreaterThanOrEqual(2);
    expect(row.lastInvestigationAt).toBeInstanceOf(Date);
    expect(row.anniversaryAt!.getTime()).toBeGreaterThan(now.getTime());
  });
});
