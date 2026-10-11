import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { PLANS, TOPUPS, depthCredits, topupCredits, type Depth, type PlanId } from "@voidaccess/config";
import { adminGrant, addMonths, expireLots, getBalance, grantMonthly, refund, reserve, topup } from "../src";
import { creditLedger, investigations, topupLots } from "../src/schema";
import { appDb, makeUser, ownerPool, pgError } from "./helpers";

const db = appDb();
const ctx = { database: db };

async function newInvestigation(userId: string, depth: Depth = "standard") {
  const [r] = await db.withUser(userId, (tx) =>
    tx.insert(investigations).values({ userId, query: "q", depth }).returning({ id: investigations.id }),
  );
  return r!.id;
}
async function ledgerRows(userId: string) {
  return db.withSystem(
    "test.ledger",
    (tx) =>
      tx.select().from(creditLedger).where(eq(creditLedger.userId, userId)).orderBy(creditLedger.createdAt),
    { audit: false },
  );
}
/** invariant: per-lot remaining equals the sum of its ledger rows; no bucket negative */
async function assertConsistent(userId: string) {
  const { rows } = await ownerPool().query(
    `select l.id, l.remaining, coalesce(sum(c.amount),0)::int as ledger
     from topup_lots l left join credit_ledger c on c.lot_id = l.id where l.user_id=$1 group by l.id`,
    [userId],
  );
  for (const r of rows) expect(r.remaining).toBe(r.ledger);
  const b = await ownerPool().query(
    `select grant_balance, topup_balance from credit_balances where user_id=$1`,
    [userId],
  );
  expect(b.rows[0].grant_balance).toBeGreaterThanOrEqual(0);
  expect(b.rows[0].topup_balance).toBeGreaterThanOrEqual(0);
}

describe("ledger", () => {
  it("grantMonthly grants config credits, expires the previous remainder, and is idempotent", async () => {
    const u = await makeUser("pro");
    const p1 = new Date("2026-11-01T00:00:00Z");
    expect(await grantMonthly(u, "pro", p1, ctx)).toMatchObject({
      granted: true,
      expired: 0,
      credits: PLANS.pro.monthlyCredits,
    });
    const inv = await newInvestigation(u);
    await reserve(u, inv, "standard", ctx);
    expect((await getBalance(u, ctx)).grant).toBe(PLANS.pro.monthlyCredits - depthCredits("standard"));
    // same period again: no-op
    expect((await grantMonthly(u, "pro", p1, ctx)).granted).toBe(false);
    // next period: remainder expires, balance resets to exactly the monthly grant (no rollover)
    const r = await grantMonthly(u, "pro", new Date("2026-12-01T00:00:00Z"), ctx);
    expect(r.expired).toBe(PLANS.pro.monthlyCredits - depthCredits("standard"));
    expect((await getBalance(u, ctx)).grant).toBe(PLANS.pro.monthlyCredits);
    await assertConsistent(u);
  });

  it("reserve fails cleanly with a too-low balance and never goes negative", async () => {
    const u = await makeUser("free");
    await grantMonthly(u, "free", new Date(), ctx); // 100 credits
    for (let i = 0; i < 2; i++)
      expect((await reserve(u, await newInvestigation(u), "standard", ctx)).ok).toBe(true); // 80
    const res = await reserve(u, await newInvestigation(u), "standard", ctx); // needs 40, has 20
    expect(res).toMatchObject({
      ok: false,
      reason: "insufficient_credits",
      needed: depthCredits("standard"),
      balance: 20,
    });
    expect((await getBalance(u, ctx)).total).toBe(20);
    // the DB itself refuses to overdraw, even if app code were wrong
    const err = await pgError(
      db.withSystem("test.overdraw", (tx) =>
        tx.insert(creditLedger).values({
          userId: u,
          bucket: "grant",
          amount: -21,
          reason: "settle",
          idempotencyKey: "overdraw:" + u,
        }),
      ),
    );
    expect(err.code).toBe("23514");
    await assertConsistent(u);
  });

  it("deep is unavailable while not launched; reserve is idempotent per investigation", async () => {
    const u = await makeUser("pro");
    await grantMonthly(u, "pro", new Date(), ctx);
    expect(await reserve(u, await newInvestigation(u, "deep"), "deep", ctx)).toMatchObject({
      ok: false,
      reason: "depth_unavailable",
    });
    const inv = await newInvestigation(u, "quick");
    expect(await reserve(u, inv, "quick", ctx)).toMatchObject({ ok: true, alreadyReserved: false });
    expect(await reserve(u, inv, "quick", ctx)).toMatchObject({ ok: true, alreadyReserved: true });
    expect((await getBalance(u, ctx)).total).toBe(PLANS.pro.monthlyCredits - depthCredits("quick"));
  });

  it("reserve can run inside the caller's transaction together with the investigation insert (atomic)", async () => {
    const u = await makeUser("free");
    await grantMonthly(u, "free", new Date(), ctx);
    await expect(
      db.withUser(u, async (tx) => {
        const [i] = await tx
          .insert(investigations)
          .values({ userId: u, query: "q", depth: "quick" })
          .returning({ id: investigations.id });
        expect((await reserve(u, i!.id, "quick", { tx })).ok).toBe(true);
        throw new Error("boom"); // rollback both
      }),
    ).rejects.toThrow("boom");
    expect((await getBalance(u, ctx)).total).toBe(PLANS.free.monthlyCredits);
  });

  it("spend order: grant first, then top-up lots by soonest expiry; expired lots are unusable and swept by expireLots", async () => {
    const u = await makeUser("free");
    const t0 = new Date("2026-11-01T00:00:00Z");
    await grantMonthly(u, "free", t0, ctx); // 100 grant
    const late = await adminGrant(u, 50, u, "late:" + u, { expiresAt: addMonths(t0, 3) }, ctx);
    const soon = await adminGrant(u, 50, u, "soon:" + u, { expiresAt: addMonths(t0, 1) }, ctx);
    const spend = async () => {
      const inv = await newInvestigation(u, "quick");
      return reserve(u, inv, "quick", { ...ctx, now: t0 });
    };
    for (let i = 0; i < 5; i++) await spend(); // drains the grant (5 × 20)
    const b = await getBalance(u, { ...ctx, now: t0 });
    expect(b.grant).toBe(0);
    await spend(); // must come from the lot expiring soonest
    const lots = await db.withSystem(
      "t",
      (tx) => tx.select().from(topupLots).where(eq(topupLots.userId, u)),
      { audit: false },
    );
    expect(lots.find((l) => l.id === soon.lotId)!.remaining).toBe(30);
    expect(lots.find((l) => l.id === late.lotId)!.remaining).toBe(50);

    // after the soon lot's expiry, even before the sweep, only the late lot is spendable
    const afterSoon = addMonths(t0, 2);
    expect((await getBalance(u, { ...ctx, now: afterSoon })).total).toBe(50);
    const swept = await expireLots(afterSoon, ctx);
    expect(swept.credits).toBeGreaterThanOrEqual(30);
    expect((await getBalance(u, { ...ctx, now: afterSoon })).total).toBe(50);
    // sweeping again is a no-op
    expect((await expireLots(afterSoon, ctx)).lots).toBe(0);
    await assertConsistent(u);
  });

  it("every top-up credit amount equals topupCredits() for every tier and plan; idempotent on payment ref", async () => {
    for (const plan of Object.keys(PLANS) as PlanId[]) {
      const u = await makeUser(plan);
      for (const tier of TOPUPS) {
        const r = await topup(u, tier.usd, `pay_${u}_${tier.usd}`, ctx);
        expect(r.credits).toBe(topupCredits(tier.usd, plan));
        const again = await topup(u, tier.usd, `pay_${u}_${tier.usd}`, ctx);
        expect(again).toMatchObject({ duplicate: true, lotId: r.lotId, credits: r.credits });
      }
      const rows = await ledgerRows(u);
      const total = rows.reduce((a, r) => a + r.amount, 0);
      expect(total).toBe(TOPUPS.reduce((a, t) => a + topupCredits(t.usd, plan), 0));
      await assertConsistent(u);
    }
    await expect(topup(await makeUser("pro"), 7, "x", ctx)).rejects.toThrow(/No top-up tier/);
  });

  it("refund: full, partial by stages, idempotent, returns credits to the buckets they came from", async () => {
    const u = await makeUser("free");
    await grantMonthly(u, "free", new Date(), ctx); // 100
    await adminGrant(u, 100, u, "r:" + u, {}, ctx);
    const inv1 = await newInvestigation(u, "standard");
    await reserve(u, inv1, "standard", ctx); // 40 from grant
    expect(await refund(u, inv1, {}, ctx)).toMatchObject({
      refunded: 40,
      charged: 40,
      alreadyRefunded: false,
    });
    expect(await refund(u, inv1, {}, ctx)).toMatchObject({ alreadyRefunded: true });
    expect((await getBalance(u, ctx)).total).toBe(200);

    // spans both buckets: drain grant to 10 then a 40 run takes 10 grant + 30 lot
    for (let i = 0; i < 4; i++) await reserve(u, await newInvestigation(u, "standard"), "standard", ctx); // 100 - 40*2 = 20 grant left…
    const b0 = await getBalance(u, ctx);
    const inv2 = await newInvestigation(u, "standard");
    const r = await reserve(u, inv2, "standard", ctx);
    expect(r.ok).toBe(true);
    const b1 = await getBalance(u, ctx);
    expect(b0.total - b1.total).toBe(40);
    // partial: only 'refine' and 'collect' ran → keep their share, refund the rest
    const part = await refund(u, inv2, { stagesCompleted: ["refine", "collect"] }, ctx);
    expect(part.charged).toBe(40);
    expect(part.refunded).toBe(40 - Math.round((40 * 22) / 100));
    const b2 = await getBalance(u, ctx);
    expect(b2.total).toBe(b1.total + part.refunded);
    // blocked query: zero stages completed => full refund
    const inv3 = await newInvestigation(u, "quick");
    await reserve(u, inv3, "quick", ctx);
    expect((await refund(u, inv3, { stagesCompleted: [] }, ctx)).refunded).toBe(20);
    await assertConsistent(u);
  });

  it("refund: an explicit refundAmount overrides the stage maths (ceil rule), clamped to the charge", async () => {
    const u = await makeUser("free");
    await adminGrant(u, 100, u, "ra:" + u, {}, ctx);
    const inv = await newInvestigation(u, "standard");
    await reserve(u, inv, "standard", ctx); // 40
    // ceil(40 * 78 / 100) = 32 (the stage-share path would give 40 - round(8.8) = 31)
    const r = await refund(u, inv, { refundAmount: Math.ceil((40 * 78) / 100) }, ctx);
    expect(r).toMatchObject({ charged: 40, refunded: 32, alreadyRefunded: false });
    expect(await refund(u, inv, { refundAmount: 40 }, ctx)).toMatchObject({ alreadyRefunded: true });
    const inv2 = await newInvestigation(u, "quick");
    await reserve(u, inv2, "quick", ctx); // 20
    expect((await refund(u, inv2, { refundAmount: 999 }, ctx)).refunded).toBe(20);
    await assertConsistent(u);
  });

  it("20 parallel reserves cannot double-spend", async () => {
    const u = await makeUser("free");
    await adminGrant(u, 100, u, "par:" + u, {}, ctx); // 100 credits → exactly 2 standard runs (40 each), 20 left
    const invs = await Promise.all(Array.from({ length: 20 }, () => newInvestigation(u, "standard")));
    const results = await Promise.all(invs.map((i) => reserve(u, i, "standard", ctx)));
    const ok = results.filter((r) => r.ok).length;
    expect(ok).toBe(2);
    expect(results.filter((r) => !r.ok && r.reason === "insufficient_credits")).toHaveLength(18);
    expect((await getBalance(u, ctx)).total).toBe(20);
    const reserved = (await ledgerRows(u))
      .filter((r) => r.reason === "reserve")
      .reduce((a, r) => a + r.amount, 0);
    expect(reserved).toBe(-80);
    await assertConsistent(u);
  });

  it("20 parallel reserves racing on grant + lots stay exact", async () => {
    const u = await makeUser("free");
    await grantMonthly(u, "free", new Date(), ctx); // 100
    await adminGrant(u, 60, u, "par2:" + u, {}, ctx); // 160 total = 8 quick runs
    const invs = await Promise.all(Array.from({ length: 20 }, () => newInvestigation(u, "quick")));
    const results = await Promise.all(invs.map((i) => reserve(u, i, "quick", ctx)));
    expect(results.filter((r) => r.ok)).toHaveLength(8);
    expect((await getBalance(u, ctx)).total).toBe(0);
    await assertConsistent(u);
  });

  it("idempotency keys are unique and the ledger rejects duplicates at the DB level", async () => {
    const u = await makeUser("pro");
    const key = "dup:" + u;
    await db.withSystem("t", (tx) =>
      tx
        .insert(creditLedger)
        .values({ userId: u, bucket: "grant", amount: 5, reason: "grant", idempotencyKey: key }),
    );
    const err = await pgError(
      db.withSystem("t", (tx) =>
        tx
          .insert(creditLedger)
          .values({ userId: u, bucket: "grant", amount: 5, reason: "grant", idempotencyKey: key }),
      ),
    );
    expect(err.code).toBe("23505");
  });

  it("only the system role can add credits; the app role can only insert reserve rows", async () => {
    const u = await makeUser("pro");
    const err = await pgError(
      db.withUser(u, (tx) =>
        tx
          .insert(creditLedger)
          .values({ userId: u, bucket: "grant", amount: 500, reason: "grant", idempotencyKey: "self:" + u }),
      ),
    );
    expect(err.code).toBe("42501");
  });
});
