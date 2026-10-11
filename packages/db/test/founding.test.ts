import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { FOUNDING } from "@voidaccess/config";
import {
  addDays,
  addMonths,
  availableSeats,
  claimFoundingSeat,
  releaseFoundingSeat,
  runFoundingChecks,
} from "../src";
import { foundingNotices, investigations, payments, subscriptions } from "../src/schema";
import { appDb, makeUser, ownerPool } from "./helpers";

const db = appDb();
const ctx = { database: db };
const T0 = new Date("2027-01-10T00:00:00Z");

beforeEach(async () => {
  await ownerPool().query(`delete from founding_notices`);
  await ownerPool().query(
    `update founding_seats set holder_user_id=null, last_holder_user_id=null, claimed_at=null, term_start=null, anniversary_at=null, released_at=null, release_reason=null`,
  );
});

const pay = (userId: string, periodStart: Date) =>
  db.withSystem("t", (tx) =>
    tx.insert(payments).values({
      userId,
      providerPaymentId: `p_${userId}_${periodStart.toISOString()}`,
      amountCents: FOUNDING.monthlyUsd * 100,
      kind: "subscription",
      paidAt: periodStart,
      periodStart,
      periodEnd: addMonths(periodStart, 1),
    }),
    { audit: false },
  );
const subscribe = (userId: string, periodEnd: Date) =>
  db.withSystem("t", (tx) =>
    tx.insert(subscriptions).values({ userId, providerSubscriptionId: "s_" + userId, plan: "pro", status: "active", currentPeriodEnd: periodEnd }),
    { audit: false },
  );
const noticesOf = (userId: string) =>
  db.withSystem("t", (tx) => tx.select().from(foundingNotices).where(eq(foundingNotices.userId, userId)), { audit: false });

describe("founding seats: claims", () => {
  it("100 concurrent claims for the last 3 seats give exactly 3 winners, never more than 100 held", async () => {
    const first = await Promise.all(Array.from({ length: FOUNDING.seats - 3 }, async () => claimFoundingSeat(await makeUser("pro"), { ...ctx, now: T0 })));
    expect(first.every((s) => s !== null)).toBe(true);
    expect(await availableSeats(ctx)).toBe(3);

    const challengers = await Promise.all(Array.from({ length: 100 }, () => makeUser("pro")));
    const results = await Promise.all(challengers.map((u) => claimFoundingSeat(u, { ...ctx, now: T0 })));
    const winners = results.filter((s): s is number => s !== null);
    expect(winners).toHaveLength(3);
    expect(new Set(winners).size).toBe(3);
    expect(await availableSeats(ctx)).toBe(0);
    const held = await ownerPool().query(`select count(*)::int n from founding_seats where holder_user_id is not null`);
    expect(held.rows[0].n).toBe(100);
  });

  it("the table can never hold more than 100 seats, and a user holds at most one", async () => {
    await expect(ownerPool().query(`insert into founding_seats (seat_no) values (101)`)).rejects.toThrow();
    const u = await makeUser("pro");
    const a = await claimFoundingSeat(u, { ...ctx, now: T0 });
    expect(await claimFoundingSeat(u, { ...ctx, now: T0 })).toBe(a); // idempotent
    const racing = await Promise.all(Array.from({ length: 10 }, () => claimFoundingSeat(u, { ...ctx, now: T0 })));
    expect(new Set(racing)).toEqual(new Set([a]));
  });

  it("the term starts at the claim and the anniversary is 12 months later", async () => {
    const u = await makeUser("pro");
    const seat = (await claimFoundingSeat(u, { ...ctx, now: T0 }))!;
    const { rows } = await ownerPool().query(`select * from founding_seats where seat_no=$1`, [seat]);
    expect(rows[0].term_start.toISOString()).toBe(T0.toISOString());
    expect(rows[0].anniversary_at.toISOString()).toBe(addMonths(T0, FOUNDING.termMonths).toISOString());
  });
});

describe("founding seats: yearly check", () => {
  it("renews at ≥ 3 paid months in the trailing 12", async () => {
    const u = await makeUser("pro");
    const seat = (await claimFoundingSeat(u, { ...ctx, now: T0 }))!;
    for (const m of [0, 1, 2]) await pay(u, addMonths(T0, m));
    await db.withSystem("t", (tx) => tx.insert(investigations).values({ userId: u, query: "q", depth: "quick", createdAt: addMonths(T0, 11) }), { audit: false });
    const anniv = addMonths(T0, 12);
    const out = await runFoundingChecks(anniv, ctx);
    expect(out.filter((o) => o.userId === u)).toEqual([
      expect.objectContaining({ action: "renewed", seatNo: seat, nextAnniversary: addMonths(anniv, 12) }),
    ]);
    expect(await availableSeats(ctx)).toBe(FOUNDING.seats - 1);
  });

  it("does not release the day before the anniversary", async () => {
    const u = await makeUser("pro");
    await claimFoundingSeat(u, { ...ctx, now: T0 });
    await db.withSystem("t", (tx) => tx.insert(investigations).values({ userId: u, query: "q", depth: "quick", createdAt: addMonths(T0, 11) }), { audit: false });
    const out = (await runFoundingChecks(addDays(addMonths(T0, 12), -1), ctx)).filter((o) => o.userId === u);
    expect(out.every((o) => o.action === "notice_scheduled")).toBe(true);
  });

  it("releases at < 3 paid months: paying founder goes to Pro at period end, lapsed founder to Free; seat reopens; release-day notice scheduled", async () => {
    const payer = await makeUser("pro");
    const lapsed = await makeUser("pro");
    await claimFoundingSeat(payer, { ...ctx, now: T0 });
    await claimFoundingSeat(lapsed, { ...ctx, now: T0 });
    await pay(payer, addMonths(T0, 0));
    await pay(payer, addMonths(T0, 1)); // only 2
    const anniv = addMonths(T0, 12);
    const periodEnd = addDays(anniv, 9);
    await subscribe(payer, periodEnd);
    for (const u of [payer, lapsed]) {
      await db.withSystem("t", (tx) => tx.insert(investigations).values({ userId: u, query: "q", depth: "quick", createdAt: addMonths(T0, 11) }), { audit: false });
    }
    const before = await availableSeats(ctx);
    const out = await runFoundingChecks(anniv, ctx);
    const p = out.find((o) => o.userId === payer)!;
    const l = out.find((o) => o.userId === lapsed)!;
    expect(p).toMatchObject({ action: "released", reason: "renewal_failed", targetPlan: "pro", effectiveAt: periodEnd });
    expect(l).toMatchObject({ action: "released", reason: "renewal_failed", targetPlan: "free" });
    expect(await availableSeats(ctx)).toBe(before + 2); // reopened seats count
    const n = (await noticesOf(payer)).filter((x) => x.kind === "release_day");
    expect(n).toHaveLength(1);
    expect(n[0]!.scheduledFor.toISOString()).toBe(anniv.toISOString());
    // idempotent: a second run does nothing new
    expect((await runFoundingChecks(anniv, ctx)).filter((o) => o.userId === payer)).toEqual([]);
    // a reopened seat can be claimed by the next subscriber
    const next = await makeUser("pro");
    expect(await claimFoundingSeat(next, { ...ctx, now: anniv })).not.toBeNull();
  });

  it("the same calendar month paid twice counts once (2 distinct months → released)", async () => {
    const u = await makeUser("pro");
    await claimFoundingSeat(u, { ...ctx, now: T0 });
    await pay(u, T0);
    await pay(u, addDays(T0, 3)); // same calendar month
    await pay(u, addMonths(T0, 1));
    await db.withSystem("t", (tx) => tx.insert(investigations).values({ userId: u, query: "q", depth: "quick", createdAt: addMonths(T0, 11) }), { audit: false });
    const out = (await runFoundingChecks(addMonths(T0, 12), ctx)).find((o) => o.userId === u)!;
    expect(out).toMatchObject({ action: "released", reason: "renewal_failed" }); // only 2 distinct months
  });

  it("schedules the 30-day renewal notice only when paid months + 1 more renewal would still be < 3", async () => {
    const risky = await makeUser("pro"); // 1 paid month + active sub = 2 < 3 → notice
    const safe = await makeUser("pro"); // 2 paid + active sub = 3 → no notice
    for (const u of [risky, safe]) {
      await claimFoundingSeat(u, { ...ctx, now: T0 });
      await subscribe(u, addMonths(T0, 13));
      await db.withSystem("t", (tx) => tx.insert(investigations).values({ userId: u, query: "q", depth: "quick", createdAt: addMonths(T0, 11) }), { audit: false });
    }
    await pay(risky, T0);
    await pay(safe, T0);
    await pay(safe, addMonths(T0, 1));
    const anniv = addMonths(T0, 12);
    const out = await runFoundingChecks(addDays(anniv, -30), ctx);
    const r = out.find((o) => o.userId === risky);
    expect(r).toMatchObject({ action: "notice_scheduled", kind: "renewal_check_30d" });
    expect((r as { scheduledFor: Date }).scheduledFor.toISOString()).toBe(addDays(anniv, -30).toISOString());
    expect(out.find((o) => o.userId === safe)).toBeUndefined();
    // not scheduled earlier than 30 days before, and not duplicated on rerun
    expect((await runFoundingChecks(addDays(anniv, -29), ctx)).find((o) => o.userId === risky)).toBeUndefined();
    expect((await noticesOf(risky)).filter((n) => n.kind === "renewal_check_30d")).toHaveLength(1);
  });
});

describe("founding seats: inactivity", () => {
  it("releases after 10 months with no investigations; 30-day notice, then release-day notice", async () => {
    const u = await makeUser("pro");
    await claimFoundingSeat(u, { ...ctx, now: T0 });
    for (const m of [0, 1, 2, 3]) await pay(u, addMonths(T0, m));
    const releaseAt = addMonths(T0, FOUNDING.inactivityReleaseMonths);
    expect(await runFoundingChecks(addDays(releaseAt, -31), ctx)).toEqual([]);
    const warn = (await runFoundingChecks(addDays(releaseAt, -30), ctx)).find((o) => o.userId === u);
    expect(warn).toMatchObject({ action: "notice_scheduled", kind: "inactivity_30d" });
    expect((await runFoundingChecks(addDays(releaseAt, -20), ctx)).find((o) => o.userId === u)).toBeUndefined(); // deduped
    const out = (await runFoundingChecks(releaseAt, ctx)).find((o) => o.userId === u);
    expect(out).toMatchObject({ action: "released", reason: "inactivity", targetPlan: "free" });
    const kinds = (await noticesOf(u)).map((n) => n.kind).sort();
    expect(kinds).toEqual(["inactivity_30d", "release_day"]);
  });

  it("an investigation resets the inactivity clock; last investigation date derives from investigations", async () => {
    const u = await makeUser("pro");
    await claimFoundingSeat(u, { ...ctx, now: T0 });
    const active = addMonths(T0, 6);
    await db.withSystem("t", (tx) => tx.insert(investigations).values({ userId: u, query: "q", depth: "quick", createdAt: active }), { audit: false });
    // at T0+10 months the user would have been released without that investigation
    const early = (await runFoundingChecks(addMonths(T0, 10), ctx)).filter((o) => o.userId === u);
    expect(early.some((o) => o.action === "released")).toBe(false);
    const late = (await runFoundingChecks(addMonths(active, 10), ctx)).find((o) => o.userId === u);
    expect(late).toMatchObject({ action: "released" });
  });

  it("a paying but inactive founder moves to Pro only at the next renewal (never mid-period)", async () => {
    const u = await makeUser("pro");
    await claimFoundingSeat(u, { ...ctx, now: T0 });
    const releaseAt = addMonths(T0, 10);
    const periodEnd = addDays(releaseAt, 12);
    await subscribe(u, periodEnd);
    const out = (await runFoundingChecks(releaseAt, ctx)).find((o) => o.userId === u);
    expect(out).toMatchObject({ action: "released", reason: "inactivity", targetPlan: "pro", effectiveAt: periodEnd });
  });
});

describe("founding seats: explicit release", () => {
  it("upgrading to Pro+ releases the seat (interpretation d)", async () => {
    const u = await makeUser("pro");
    await claimFoundingSeat(u, { ...ctx, now: T0 });
    const before = await availableSeats(ctx);
    expect(await releaseFoundingSeat(u, "upgraded", { ...ctx, now: T0 })).toMatchObject({ targetPlan: "free" });
    expect(await availableSeats(ctx)).toBe(before + 1);
    expect(await releaseFoundingSeat(u, "upgraded", ctx)).toBeNull();
  });
});
