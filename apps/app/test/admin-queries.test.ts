import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { DEPTHS, FOUNDING, PLANS } from "@voidaccess/config";
import {
  abuseFlags,
  claimFoundingSeat,
  events,
  investigations,
  payments,
  rateLimitEvents,
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
  getActivity,
  getCostRunsForExport,
  getFounding,
  getOverview,
  getPaidConversions,
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
  it("lists blocked_query runs, repeat users at the threshold, open flags, and per-user rate-limit hits (H1 rate_limit_events)", async () => {
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

    await sys((tx) =>
      tx.insert(rateLimitEvents).values([
        { source: "auth", path: "/sign-in/email", userId: few.id, ipHash: "h1" },
        { source: "run_create", path: "investigations", userId: few.id, ipHash: "h1" },
        { source: "auth", path: "/sign-in/email", userId: null, ipHash: "h2" }, // anonymous: not listed
      ]),
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
    expect(q.rateLimits.available).toBe(true);
    expect(q.rateLimits.rows.find((r) => r.userId === few.id)).toMatchObject({ hits: 2, email: few.email });
    expect(q.rateLimits.rows.every((r) => r.userId)).toBe(true);
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

describe("overview: paid conversions and what users do (a fixed past window, so other suites' data can't interfere)", () => {
  const now = new Date("2020-01-01T00:00:00Z");
  const at = (days: number) => new Date(now.getTime() - days * 86_400_000);

  it("lists the latest paid starts from every provider (subscriptions by their first payment, one-off payments), not renewals; counts 7 and 30 days; plan mix", async () => {
    const mixBefore = (await getPaidConversions({ now })).planMix;
    const a = await makeUser({ plan: "pro", credits: 0 });
    const b = await makeUser({ plan: "pro_plus", credits: 0 });
    const c = await makeUser({ plan: "free", credits: 0 });
    const [subA] = await sys<Array<{ id: string }>>((tx) =>
      tx
        .insert(subscriptions)
        .values({
          userId: a.id,
          provider: "creem",
          providerSubscriptionId: `conv_${a.id}`,
          plan: "pro",
          status: "cancelled", // a start even if it ended later; not active, so MRR elsewhere is unaffected
          interval: "year",
          createdAt: at(3),
        })
        .returning({ id: subscriptions.id }),
    );
    await sys((tx) =>
      tx.insert(subscriptions).values({
        userId: b.id,
        provider: "nowpayments",
        providerSubscriptionId: `conv_${b.id}`,
        plan: "pro_plus",
        status: "expired",
        createdAt: at(4), // no payment row: dated by the subscription itself
      }),
    );
    await sys((tx) =>
      tx.insert(payments).values([
        {
          userId: a.id,
          providerPaymentId: `conv_first_${a.id}`,
          amountCents: 7000,
          kind: "subscription",
          subscriptionId: subA!.id,
          paidAt: at(1),
        },
        {
          userId: a.id,
          providerPaymentId: `conv_renew_${a.id}`,
          amountCents: 7000,
          kind: "subscription",
          subscriptionId: subA!.id,
          paidAt: at(0.5),
        },
        {
          userId: c.id,
          provider: "nowpayments",
          providerPaymentId: `conv_top_${c.id}`,
          amountCents: 1500,
          currency: "USD",
          kind: "topup",
          paidAt: at(2),
          meta: { key: "topup_credits", usd: 15 },
        },
        {
          userId: c.id,
          providerPaymentId: `conv_old_${c.id}`,
          amountCents: 700,
          kind: "topup",
          paidAt: at(20),
        },
        {
          userId: c.id,
          providerPaymentId: `conv_older_${c.id}`,
          amountCents: 700,
          kind: "topup",
          paidAt: at(40),
        },
      ]),
    );

    // a crypto pass (prepaid, never renews) and a second pass bought on top of it: two purchases
    const d = await makeUser({ plan: "pro", credits: 0 });
    const [subD] = await sys<Array<{ id: string }>>((tx) =>
      tx
        .insert(subscriptions)
        .values({
          userId: d.id,
          provider: "nowpayments",
          providerSubscriptionId: `conv_${d.id}`,
          plan: "pro",
          status: "expired",
          interval: "year",
          createdAt: at(10),
        })
        .returning({ id: subscriptions.id }),
    );
    await sys((tx) =>
      tx.insert(payments).values(
        [10, 6].map((days, i) => ({
          userId: d.id,
          provider: "nowpayments",
          providerPaymentId: `conv_pass${i}_${d.id}`,
          amountCents: 7000,
          kind: "subscription" as const,
          subscriptionId: subD!.id,
          paidAt: at(days),
          meta: { pass: true },
        })),
      ),
    );

    const r = await getPaidConversions({ now });
    expect(r.d7).toBe(4);
    expect(r.d30).toBe(6);
    expect(
      r.latest
        .slice(0, 7)
        .map((x) => [x.email, x.kind, x.item, x.interval, x.amountCents, x.provider, x.pass, x.extension]),
    ).toEqual([
      [a.email, "subscription", "pro", "year", 7000, "creem", false, false], // the first payment, not the renewal
      [c.email, "payment", "topup_credits", null, 1500, "nowpayments", false, false],
      [b.email, "subscription", "pro_plus", "month", null, "nowpayments", false, false],
      [d.email, "subscription", "pro", "year", 7000, "nowpayments", true, true], // the second pass
      [d.email, "subscription", "pro", "year", 7000, "nowpayments", true, false], // the first pass
      [c.email, "payment", "topup", null, 700, "creem", false, false],
      [c.email, "payment", "topup", null, 700, "creem", false, false],
    ]);
    expect(r.latest[0]!.at.toISOString()).toBe(at(1).toISOString());
    expect(r.latest.length).toBeLessThanOrEqual(25);
    expect(r.latest.filter((x) => x.userId === a.id)).toHaveLength(1);

    const delta = (plan: string) =>
      r.planMix.find((m) => m.plan === plan)!.users - mixBefore.find((m) => m.plan === plan)!.users;
    expect(r.planMix.map((m) => m.plan)).toEqual(Object.keys(PLANS));
    expect([delta("free"), delta("pro"), delta("pro_plus")]).toEqual([1, 2, 1]);
  });

  it("counts events by name (top 15, no props) and runs by depth for the last 7 days", async () => {
    const u = await makeUser({ credits: 0 });
    const ev = (name: string, n: number, days: number) =>
      Array.from({ length: n }, () => ({
        name,
        userId: u.id,
        at: at(days),
        props: { query: "secret query text", value: "entity@example.com" },
      }));
    await sys((tx) =>
      tx.insert(events).values([
        ...ev("investigation_started", 5, 1),
        ...ev("results_viewed", 3, 2),
        ...ev("old_event", 9, 8), // outside the window
        ...Array.from({ length: 16 }, (_, i) => ev(`rare_${String(i).padStart(2, "0")}`, 1, 1)).flat(),
      ]),
    );
    await sys((tx) =>
      tx.insert(investigations).values([
        {
          userId: u.id,
          query: "secret query text",
          depth: "quick",
          status: "completed",
          creditsCharged: 0,
          createdAt: at(1),
        },
        {
          userId: u.id,
          query: "secret query text",
          depth: "quick",
          status: "failed",
          creditsCharged: 0,
          createdAt: at(1),
        },
        {
          userId: u.id,
          query: "secret query text",
          depth: "deep",
          status: "completed",
          creditsCharged: 0,
          createdAt: at(2),
        },
        {
          userId: u.id,
          query: "secret query text",
          depth: "standard",
          status: "completed",
          creditsCharged: 0,
          createdAt: at(9),
        },
      ]),
    );
    const r = await getActivity({ now });
    expect(r.events).toHaveLength(15);
    expect(r.events[0]).toEqual({ name: "investigation_started", n: 5, users: 1 });
    expect(r.events[1]).toEqual({ name: "results_viewed", n: 3, users: 1 });
    expect(r.events.map((e) => e.name)).not.toContain("old_event");
    expect(r.runsByDepth).toEqual(
      Object.keys(DEPTHS).map((depth) => ({
        depth,
        n: depth === "quick" ? 2 : depth === "deep" ? 1 : 0,
        completed: depth === "quick" ? 1 : depth === "deep" ? 1 : 0,
      })),
    );
    const dump = JSON.stringify(r);
    expect(dump).not.toContain("secret query text");
    expect(dump).not.toContain("entity@example.com");
  });
});
