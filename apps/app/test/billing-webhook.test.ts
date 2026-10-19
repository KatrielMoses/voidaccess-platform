import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { PLANS, TOPUP_MAX_USD, TOPUP_MIN_USD, topupCredits, type PlanId } from "@voidaccess/config";
import {
  abuseFlags,
  auditLog,
  billingCheckouts,
  billingEvents,
  getBalance,
  getDatabase,
  grantMonthly,
  payments,
  topupLots,
} from "@voidaccess/db";
import { createTopupCheckout } from "@/lib/billing/checkout";
import { endCancelledSubscriptions } from "@/lib/billing/cron";
import { SIGNATURE_HEADER, signWebhook, verifyWebhook } from "@/lib/billing/webhook-verify";
import {
  DAY,
  SECRET,
  addDays,
  deliver,
  grantBalance,
  ledger,
  makeBillingUser,
  outbox,
  planOf,
  provider,
  setupBilling,
  startTopup,
  subRows,
  subSnapshot,
  topupCompleted,
} from "./billing-helpers";

const db = () => getDatabase();
beforeAll(setupBilling);

const t0 = new Date("2026-11-01T10:00:00Z");
let n = 0;
const sid = () => `sub_t${Date.now()}_${++n}`;

const lotsOf = (userId: string) =>
  db().withSystem("t", (tx) => tx.select().from(topupLots).where(eq(topupLots.userId, userId)), {
    audit: false,
  });
const flagsOf = (userId: string) =>
  db().withSystem("t", (tx) => tx.select().from(abuseFlags).where(eq(abuseFlags.userId, userId)), {
    audit: false,
  });

describe("webhook signature", () => {
  it("verifies the hex HMAC of the raw body: valid, tampered, wrong secret, missing header, missing secret", async () => {
    const body = JSON.stringify({ id: "evt_sig", eventType: "x", created_at: 1, object: {} });
    const good = new Headers({ [SIGNATURE_HEADER]: signWebhook(SECRET, body) });
    expect(verifyWebhook(SECRET, good, body)).toEqual({ ok: true });
    expect(verifyWebhook(SECRET, good, body + " ")).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(
      verifyWebhook(SECRET, new Headers({ [SIGNATURE_HEADER]: signWebhook("whsec_another", body) }), body),
    ).toMatchObject({ ok: false, reason: "bad_signature" });
    expect(verifyWebhook(SECRET, new Headers({ [SIGNATURE_HEADER]: "not-hex!" }), body)).toMatchObject({
      ok: false,
      reason: "bad_signature",
    });
    expect(verifyWebhook(SECRET, new Headers({ [SIGNATURE_HEADER]: "abcd" }), body)).toMatchObject({
      ok: false,
      reason: "bad_signature",
    });
    expect(verifyWebhook(SECRET, new Headers(), body)).toMatchObject({
      ok: false,
      reason: "missing_signature",
    });
    expect(verifyWebhook(undefined, good, body)).toMatchObject({ ok: false, reason: "no_secret" });
    expect(verifyWebhook("", good, body)).toMatchObject({ ok: false, reason: "no_secret" });
  });

  it("rejected deliveries change nothing: tampered 400, wrong secret 400", async () => {
    const u = await makeBillingUser();
    const data = await subSnapshot({
      user: u,
      subId: sid(),
      key: "pro_month",
      periodStart: t0,
      periodEnd: addDays(t0, 30),
    });
    expect((await deliver("subscription.active", data, { at: t0, tamper: true })).status).toBe(400);
    const wrong = await deliver("subscription.active", data, { at: t0, secret: "whsec_another-secret-xx" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.reason).toBe("bad_signature");
    expect(await planOf(u.id)).toBe("free");
    expect(await ledger(u.id)).toHaveLength(0);
  });
});

describe("subscription activation and idempotency", () => {
  it("activates Pro: plan, monthly grant, payment row, welcome email; a duplicate event id and a replay under a new id change nothing", async () => {
    const u = await makeBillingUser();
    const sub = sid();
    const data = await subSnapshot({
      user: u,
      subId: sub,
      key: "pro_month",
      periodStart: t0,
      periodEnd: addDays(t0, 30),
    });
    const before = outbox.outbox.length;
    const first = await deliver("subscription.active", data, { id: "evt_dup_1", at: t0 });
    expect(first.body).toMatchObject({ ok: true, outcome: "applied" });
    expect(await planOf(u.id)).toBe("pro");
    expect(await grantBalance(u.id)).toBe(PLANS.pro.monthlyCredits);
    expect(outbox.outbox.length).toBe(before); // emails go out after commit via post effects, not inside the transaction
    expect(first.post.map((p) => p.kind).sort()).toEqual(["subscribed", "welcome"]);

    // subscription.paid carries the transaction: one payment row, linked, with its period
    const paid = await subSnapshot({
      user: u,
      subId: sub,
      key: "pro_month",
      periodStart: t0,
      periodEnd: addDays(t0, 30),
      transactionId: `tran_${sub}`,
    });
    await deliver("subscription.paid", paid, { at: t0 });
    await deliver("subscription.paid", paid, { at: t0 }); // replay under a new event id
    const rows = await db().withSystem(
      "t",
      (tx) => tx.select().from(payments).where(eq(payments.userId, u.id)),
      {
        audit: false,
      },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "creem",
      kind: "subscription",
      amountCents: PLANS.pro.monthlyUsd * 100,
    });
    expect(rows[0]!.subscriptionId).not.toBeNull();
    expect(rows[0]!.periodStart?.toISOString()).toBe(t0.toISOString());

    // exact duplicate delivery (same event id): acknowledged, no effects
    const dup = await deliver("subscription.active", data, { id: "evt_dup_1", at: t0 });
    expect(dup.body).toMatchObject({ ok: true, outcome: "duplicate" });
    expect(await grantBalance(u.id)).toBe(PLANS.pro.monthlyCredits);
    expect((await ledger(u.id)).filter((r) => r.reason === "grant")).toHaveLength(1);
    const ev = await db().withSystem(
      "t",
      (tx) => tx.select().from(billingEvents).where(eq(billingEvents.eventId, "evt_dup_1")),
      { audit: false },
    );
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ provider: "creem", mode: "test" });
  });

  it("a user who got the Free signup grant today still gets the Pro grant when they subscribe today", async () => {
    const u = await makeBillingUser();
    const now = new Date();
    await grantMonthly(u.id, "free", now);
    await deliver(
      "subscription.active",
      await subSnapshot({
        user: u,
        subId: sid(),
        key: "pro_month",
        periodStart: now,
        periodEnd: addDays(now, 30),
      }),
      { at: now },
    );
    expect(await grantBalance(u.id)).toBe(PLANS.pro.monthlyCredits);
  });

  it("concurrent deliveries of the same event id apply exactly once", async () => {
    const u = await makeBillingUser();
    const data = await subSnapshot({
      user: u,
      subId: sid(),
      key: "pro_month",
      periodStart: t0,
      periodEnd: addDays(t0, 30),
    });
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        deliver("subscription.active", data, { id: "evt_conc_" + u.id, at: t0 }),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.outcome === "applied")).toHaveLength(1);
    expect(await grantBalance(u.id)).toBe(PLANS.pro.monthlyCredits);
  });

  it("monthly renewal (subscription.paid, new period) grants the next period and expires the old remainder", async () => {
    const u = await makeBillingUser();
    const sub = sid();
    await deliver(
      "subscription.active",
      await subSnapshot({
        user: u,
        subId: sub,
        key: "pro_month",
        periodStart: t0,
        periodEnd: addDays(t0, 30),
      }),
      { at: t0 },
    );
    const t1 = addDays(t0, 30);
    await deliver(
      "subscription.paid",
      await subSnapshot({
        user: u,
        subId: sub,
        key: "pro_month",
        periodStart: t1,
        periodEnd: addDays(t1, 30),
        transactionId: `tran_r_${sub}`,
      }),
      { at: t1 },
    );
    expect(await grantBalance(u.id)).toBe(PLANS.pro.monthlyCredits);
    expect((await ledger(u.id)).filter((r) => r.reason === "grant")).toHaveLength(2);
    expect((await subRows(u.id))[0]!.currentPeriodStart?.toISOString()).toBe(t1.toISOString());
  });
});

describe("out-of-order delivery", () => {
  it("renewal before activation: the newer period is granted once, the late activation grants nothing and doesn't regress state", async () => {
    const u = await makeBillingUser();
    const sub = sid();
    const t1 = addDays(t0, 30);
    await deliver(
      "subscription.paid",
      await subSnapshot({
        user: u,
        subId: sub,
        key: "pro_month",
        periodStart: t1,
        periodEnd: addDays(t1, 30),
      }),
      { at: t1 },
    );
    await deliver(
      "subscription.active",
      await subSnapshot({ user: u, subId: sub, key: "pro_month", periodStart: t0, periodEnd: t1 }),
      { at: t0 },
    );
    expect((await ledger(u.id)).filter((r) => r.reason === "grant")).toHaveLength(1);
    expect(await grantBalance(u.id)).toBe(PLANS.pro.monthlyCredits);
    const [s] = await subRows(u.id);
    expect(s!.currentPeriodStart?.toISOString()).toBe(t1.toISOString());
    expect(await planOf(u.id)).toBe("pro");
  });

  it("a stale scheduled_cancel delivered after a newer active snapshot doesn't bring the cancellation back", async () => {
    const u = await makeBillingUser();
    const sub = sid();
    const base = { user: u, subId: sub, key: "pro_month", periodStart: t0, periodEnd: addDays(t0, 30) };
    await deliver("subscription.active", await subSnapshot(base), { at: t0 });
    await deliver("subscription.update", await subSnapshot(base), { at: addDays(t0, 6) });
    await deliver(
      "subscription.scheduled_cancel",
      await subSnapshot({ ...base, status: "scheduled_cancel" }),
      {
        at: addDays(t0, 5),
      },
    );
    expect((await subRows(u.id))[0]!.cancelAt).toBeNull();
  });
});

describe("identity: unknown customers are rejected, never guessed", () => {
  it("an unmapped customer, or a metadata user that disagrees with the mapping, changes nothing and leaves an audit row", async () => {
    const victim = await makeBillingUser();
    const stranger = { ...victim, customer: "cust_not_mapped" };
    const a = await deliver(
      "subscription.active",
      await subSnapshot({
        user: stranger,
        subId: sid(),
        key: "pro_month",
        periodStart: t0,
        periodEnd: addDays(t0, 30),
      }),
      { at: t0 },
    );
    expect(a.body).toMatchObject({ ok: true, outcome: "rejected" });
    const other = await makeBillingUser();
    const mismatch = await deliver(
      "subscription.active",
      await subSnapshot({
        user: victim,
        metadataUser: other.id,
        subId: sid(),
        key: "pro_month",
        periodStart: t0,
        periodEnd: addDays(t0, 30),
      }),
      { at: t0 },
    );
    expect(mismatch.body.outcome).toBe("rejected");
    for (const u of [victim, other]) {
      expect(await planOf(u.id)).toBe("free");
      expect(await ledger(u.id)).toHaveLength(0);
      expect(await subRows(u.id)).toHaveLength(0);
    }
    const audit = await db().withSystem(
      "t",
      (tx) => tx.select().from(auditLog).where(eq(auditLog.action, "billing.webhook.rejected")),
      { audit: false },
    );
    expect(audit.length).toBeGreaterThanOrEqual(2);
    expect(audit.some((r) => r.actor === "webhook:creem")).toBe(true);
  });
});

describe("test and live are separate", () => {
  it("a production event reaching the test deployment (or the reverse) is rejected; event ids are keyed by mode", async () => {
    const u = await makeBillingUser();
    const data = await subSnapshot({
      user: u,
      subId: sid(),
      key: "pro_month",
      periodStart: t0,
      periodEnd: addDays(t0, 30),
      mode: "prod",
    });
    const r = await deliver("subscription.active", data, { at: t0 });
    expect(r.body).toMatchObject({ outcome: "rejected" });
    expect(await planOf(u.id)).toBe("free");

    // a live deployment doesn't know test customers or test products, and refuses test-mode objects
    const testData = await subSnapshot({
      user: u,
      subId: sid(),
      key: "pro_month",
      periodStart: t0,
      periodEnd: addDays(t0, 30),
    });
    const asLive = await deliver("subscription.active", testData, { id: "evt_mode_1", at: t0, mode: "live" });
    expect(asLive.body.outcome).toBe("rejected");
    // the same event id in test mode is a different event, not a duplicate
    const asTest = await deliver("subscription.active", testData, { id: "evt_mode_1", at: t0 });
    expect(asTest.body.outcome).toBe("applied");
    expect(await planOf(u.id)).toBe("pro");
    const evs = await db().withSystem(
      "t",
      (tx) => tx.select().from(billingEvents).where(eq(billingEvents.eventId, "evt_mode_1")),
      { audit: false },
    );
    expect(evs.map((e) => e.mode).sort()).toEqual(["live", "test"]);
  });
});

describe("plan changes", () => {
  it("upgrade Pro -> Pro+ grants the credit difference once and switches the plan; a downgrade waits for the period end", async () => {
    const u = await makeBillingUser();
    const sub = sid();
    await deliver(
      "subscription.active",
      await subSnapshot({
        user: u,
        subId: sub,
        key: "pro_month",
        periodStart: t0,
        periodEnd: addDays(t0, 30),
      }),
      { at: t0 },
    );
    const mid = addDays(t0, 10);
    const up = await subSnapshot({
      user: u,
      subId: sub,
      key: "pro_plus_month",
      periodStart: t0,
      periodEnd: addDays(t0, 30),
    });
    await deliver("subscription.update", up, { at: mid });
    expect(await planOf(u.id)).toBe("pro_plus");
    const diff = PLANS.pro_plus.monthlyCredits - PLANS.pro.monthlyCredits;
    expect(await grantBalance(u.id)).toBe(PLANS.pro.monthlyCredits + diff);
    await deliver("subscription.update", up, { at: mid }); // new event id, same change
    await deliver("subscription.paid", up, { at: addDays(mid, 1) }); // the proration charge
    expect(await grantBalance(u.id)).toBe(PLANS.pro_plus.monthlyCredits);
    expect((await ledger(u.id)).filter((r) => r.idempotencyKey.startsWith("grant-diff:"))).toHaveLength(1);

    // downgrade: Creem's product changes before the period end, but the plan (and credits) stay until the new period
    const down = await subSnapshot({
      user: u,
      subId: sub,
      key: "pro_month",
      periodStart: t0,
      periodEnd: addDays(t0, 30),
    });
    await deliver("subscription.update", down, { at: addDays(t0, 20) });
    expect(await planOf(u.id)).toBe("pro_plus");
    expect((await subRows(u.id))[0]!.pendingProductKey).toBe("pro_month");
    const t1 = addDays(t0, 30);
    await deliver(
      "subscription.paid",
      await subSnapshot({
        user: u,
        subId: sub,
        key: "pro_month",
        periodStart: t1,
        periodEnd: addDays(t1, 30),
      }),
      { at: t1 },
    );
    expect(await planOf(u.id)).toBe("pro");
    expect(await grantBalance(u.id)).toBe(PLANS.pro.monthlyCredits);
    expect((await subRows(u.id))[0]!.pendingProductKey).toBeNull();
  });

  it("cancel at period end keeps the plan until then, resume clears it; canceled moves the user to Free at the period end", async () => {
    const u = await makeBillingUser();
    const sub = sid();
    const end = addDays(t0, 30);
    const base = { user: u, subId: sub, key: "pro_month", periodStart: t0, periodEnd: end };
    await deliver("subscription.active", await subSnapshot(base), { at: t0 });
    await deliver(
      "subscription.scheduled_cancel",
      await subSnapshot({ ...base, status: "scheduled_cancel" }),
      {
        at: addDays(t0, 5),
      },
    );
    expect((await subRows(u.id))[0]!.cancelAt?.toISOString()).toBe(end.toISOString());
    expect((await subRows(u.id))[0]!.status).toBe("active");
    expect(await planOf(u.id)).toBe("pro");

    // resumed before the end: Creem sends the active snapshot again
    await deliver("subscription.active", await subSnapshot(base), { at: addDays(t0, 6) });
    expect((await subRows(u.id))[0]!.cancelAt).toBeNull();

    await deliver(
      "subscription.scheduled_cancel",
      await subSnapshot({ ...base, status: "scheduled_cancel" }),
      {
        at: addDays(t0, 7),
      },
    );
    await deliver("subscription.canceled", await subSnapshot({ ...base, status: "canceled" }), {
      at: addDays(t0, 8),
    });
    expect(await planOf(u.id)).toBe("pro"); // still inside the paid period
    expect(await endCancelledSubscriptions(addDays(t0, 29), db())).toBe(0);
    expect(await endCancelledSubscriptions(addDays(end, 1), db())).toBeGreaterThanOrEqual(1);
    expect(await planOf(u.id)).toBe("free");
    expect(await grantBalance(u.id)).toBe(PLANS.free.monthlyCredits);
    expect(await endCancelledSubscriptions(addDays(end, 2), db())).toBe(0); // idempotent

    // canceled at (or after) the period end: Free at once
    const v = await makeBillingUser();
    const s2 = sid();
    await deliver(
      "subscription.active",
      await subSnapshot({ user: v, subId: s2, key: "pro_month", periodStart: t0, periodEnd: end }),
      { at: t0 },
    );
    await deliver(
      "subscription.canceled",
      await subSnapshot({
        user: v,
        subId: s2,
        key: "pro_month",
        status: "canceled",
        periodStart: t0,
        periodEnd: end,
      }),
      { at: addDays(end, 3) },
    );
    expect(await planOf(v.id)).toBe("free");
  });

  it("past due, unpaid and expired keep the plan while Creem retries; only canceled ends it", async () => {
    const u = await makeBillingUser();
    const sub = sid();
    const base = { user: u, subId: sub, key: "pro_month", periodStart: t0, periodEnd: addDays(t0, 30) };
    await deliver("subscription.active", await subSnapshot(base), { at: t0 });
    const pd = await deliver("subscription.past_due", await subSnapshot({ ...base, status: "past_due" }), {
      at: addDays(t0, 31),
    });
    expect(pd.post.map((p) => p.kind)).toEqual(["payment_failed"]);
    expect(await planOf(u.id)).toBe("pro");
    expect((await subRows(u.id))[0]!.status).toBe("past_due");
    await deliver("subscription.unpaid", await subSnapshot({ ...base, status: "unpaid" }), {
      at: addDays(t0, 33),
    });
    await deliver("subscription.expired", await subSnapshot(base), { at: addDays(t0, 34) });
    expect(await planOf(u.id)).toBe("pro");
    expect((await subRows(u.id))[0]!.status).toBe("past_due");
    await deliver("subscription.canceled", await subSnapshot({ ...base, status: "canceled" }), {
      at: addDays(t0, 40),
    });
    expect(await planOf(u.id)).toBe("free");
  });

  it("annual billing grants once at activation (monthly grants after that come from cron)", async () => {
    const u = await makeBillingUser();
    await deliver(
      "subscription.active",
      await subSnapshot({
        user: u,
        subId: sid(),
        key: "pro_plus_year",
        periodStart: t0,
        periodEnd: addDays(t0, 365),
      }),
      { at: t0 },
    );
    expect(await planOf(u.id)).toBe("pro_plus");
    expect(await grantBalance(u.id)).toBe(PLANS.pro_plus.monthlyCredits);
    expect((await subRows(u.id))[0]!.interval).toBe("year");
  });
});

describe("pay-as-you-go top-ups", () => {
  it("checkout refuses amounts outside the rule and never reaches the provider", async () => {
    const u = await makeBillingUser();
    const calls = provider.calls.length;
    for (const bad of [
      TOPUP_MIN_USD - 1,
      TOPUP_MAX_USD + 1,
      TOPUP_MIN_USD + 0.5,
      0,
      -5,
      Number.NaN,
      "abc",
      null,
      "5.50",
    ]) {
      const r = await createTopupCheckout(u.id, bad, { provider });
      expect(r, String(bad)).toMatchObject({ ok: false, error: "topup_invalid" });
    }
    expect(await createTopupCheckout(u.id, 4, { provider })).toMatchObject({ reason: "below_minimum" });
    expect(await createTopupCheckout(u.id, 501, { provider })).toMatchObject({ reason: "above_maximum" });
    expect(await createTopupCheckout(u.id, 5.5, { provider })).toMatchObject({ reason: "not_whole_dollars" });
    expect(provider.calls.length).toBe(calls);
  });

  it("checkout sends the amount as Creem's custom price on the one credits product, and records it", async () => {
    const u = await makeBillingUser();
    const row = await startTopup(u, 37);
    expect(row).toMatchObject({
      kind: "topup",
      key: "topup_credits",
      amountCents: 3700,
      topupUsd: 37,
      mode: "test",
    });
    const call = provider.calls.filter((c) => c.op === "createCheckout").at(-1)!.args as Record<
      string,
      unknown
    >;
    expect(call).toMatchObject({ customPriceCents: 3700, requestId: row.id, customerId: u.customer });
    expect((call.metadata as Record<string, string>).user_id).toBe(u.id);
    expect(row.providerCheckoutId).toMatch(/^ch_fake_/);
  });

  const plans: PlanId[] = ["free", "pro", "pro_plus"];
  for (const plan of plans) {
    for (const usd of [5, 10, 25, 50, 500]) {
      it(`${plan}: a $${usd} top-up grants exactly topupCredits(), once`, async () => {
        const u = await makeBillingUser(plan);
        const checkout = await startTopup(u, usd);
        const obj = await topupCompleted(u, checkout, { at: t0 });
        const r = await deliver("checkout.completed", obj, { at: t0 });
        expect(r.body).toMatchObject({ outcome: "applied" });
        expect(r.post).toEqual([{ kind: "topup_purchased", userId: u.id, usd }]);
        await deliver("checkout.completed", obj, { at: t0 }); // replay under a new event id
        const lots = await lotsOf(u.id);
        expect(lots).toHaveLength(1);
        expect(lots[0]!.creditsInitial).toBe(topupCredits(usd, plan));
        expect(lots[0]!.usd).toBe(usd);
        expect((await getBalance(u.id, { now: t0 })).topup).toBe(topupCredits(usd, plan));
        expect(lots[0]!.expiresAt.getTime()).toBeGreaterThan(t0.getTime() + 300 * DAY);
        const pay = await db().withSystem(
          "t",
          (tx) => tx.select().from(payments).where(eq(payments.userId, u.id)),
          {
            audit: false,
          },
        );
        expect(pay).toHaveLength(1);
        expect(pay[0]).toMatchObject({ kind: "topup", provider: "creem", amountCents: usd * 100 });
      });
    }
  }

  it("the subscriber bonus is the plan at payment time", async () => {
    const u = await makeBillingUser("free");
    const checkout = await startTopup(u, 25);
    await deliver(
      "subscription.active",
      await subSnapshot({
        user: u,
        subId: sid(),
        key: "pro_plus_month",
        periodStart: t0,
        periodEnd: addDays(t0, 30),
      }),
      { at: t0 },
    );
    await deliver("checkout.completed", await topupCompleted(u, checkout, { at: t0 }), { at: t0 });
    expect((await lotsOf(u.id))[0]!.creditsInitial).toBe(topupCredits(25, "pro_plus"));
  });

  it("a paid amount that differs from the checkout is rejected and flagged; no credits", async () => {
    const cases: [string, Parameters<typeof topupCompleted>[2]][] = [
      ["amount_mismatch", { paidCents: 500 }],
      ["custom_price_mismatch", { customPrice: 100 }],
      ["discounted", { discountCents: 100 }],
      ["currency_mismatch", { currency: "EUR" }],
    ];
    for (const [reason, over] of cases) {
      const u = await makeBillingUser("pro");
      const checkout = await startTopup(u, 50);
      const r = await deliver("checkout.completed", await topupCompleted(u, checkout, over), { at: t0 });
      expect(r.body, reason).toMatchObject({ ok: true, outcome: "rejected" });
      expect(r.post).toEqual([]);
      expect(await lotsOf(u.id)).toHaveLength(0);
      const flags = await flagsOf(u.id);
      expect(flags.map((f) => f.kind)).toEqual(["billing_topup_mismatch"]);
      expect((flags[0]!.detail as { problems: string[] }).problems).toContain(reason);
    }
  });

  it("a checkout we didn't create, another user's checkout, or a metadata user mismatch is never credited", async () => {
    const u = await makeBillingUser();
    const other = await makeBillingUser();
    // unknown checkout (e.g. a payment link opened outside the app)
    const ghost = {
      id: "00000000-0000-4000-8000-000000000000",
      providerCheckoutId: "ch_ghost",
      amountCents: 1000,
    };
    const a = await deliver("checkout.completed", await topupCompleted(u, ghost), { at: t0 });
    expect(a.body.outcome).toBe("rejected");
    // the other user's checkout, paid from this user's customer
    const theirs = await startTopup(other, 10);
    const b = await deliver("checkout.completed", await topupCompleted(u, theirs), { at: t0 });
    expect(b.body.outcome).toBe("rejected");
    // metadata says another user
    const mine = await startTopup(u, 10);
    const c = await deliver("checkout.completed", await topupCompleted(u, mine, { metadataUser: other.id }), {
      at: t0,
    });
    expect(c.body.outcome).toBe("rejected");
    // unmapped customer
    const d = await deliver(
      "checkout.completed",
      await topupCompleted(u, mine, { customer: "cust_unknown" }),
      { at: t0 },
    );
    expect(d.body.outcome).toBe("rejected");
    expect(await lotsOf(u.id)).toHaveLength(0);
    expect(await lotsOf(other.id)).toHaveLength(0);
    // and the real one still works afterwards
    await deliver("checkout.completed", await topupCompleted(u, mine), { at: t0 });
    expect((await lotsOf(u.id))[0]!.creditsInitial).toBe(topupCredits(10, "free"));
    const [done] = await db().withSystem(
      "t",
      (tx) => tx.select().from(billingCheckouts).where(eq(billingCheckouts.id, mine.id)),
      { audit: false },
    );
    expect(done!.completedAt).not.toBeNull();
  });

  it("a subscription checkout.completed only closes the checkout record; credits come from the subscription events", async () => {
    const u = await makeBillingUser();
    const obj = {
      id: "ch_sub_1",
      object: "checkout",
      order: {
        id: "ord_sub_1",
        customer: u.customer,
        type: "recurring",
        status: "paid",
        amount: 900,
        sub_total: 900,
      },
      subscription: { id: sid(), status: "active" },
      customer: { id: u.customer },
      metadata: { user_id: u.id },
      mode: "test",
    };
    const r = await deliver("checkout.completed", obj, { at: t0 });
    expect(r.body.outcome).toBe("applied");
    expect(await ledger(u.id)).toHaveLength(0);
    expect(await planOf(u.id)).toBe("free");
  });
});

describe("refunds and disputes never move credits", () => {
  it("raise an admin flag and an audit row, and leave every credit untouched", async () => {
    const u = await makeBillingUser("pro");
    const sub = sid();
    await deliver(
      "subscription.active",
      await subSnapshot({
        user: u,
        subId: sub,
        key: "pro_month",
        periodStart: t0,
        periodEnd: addDays(t0, 30),
      }),
      { at: t0 },
    );
    const before = (await ledger(u.id)).length;
    const bal = await grantBalance(u.id);
    await deliver(
      "refund.created",
      {
        id: "ref_1",
        object: "refund",
        status: "succeeded",
        refund_amount: 900,
        refund_currency: "USD",
        transaction: { id: "tran_x", amount: 900, order: "ord_x", subscription: sub, customer: u.customer },
        subscription: { id: sub, customer: u.customer, metadata: { user_id: u.id } },
        customer: { id: u.customer },
        mode: "test",
      },
      { at: addDays(t0, 3) },
    );
    await deliver(
      "dispute.created",
      {
        id: "disp_1",
        object: "dispute",
        amount: 900,
        currency: "USD",
        transaction: { id: "tran_x", order: "ord_x", customer: u.customer },
        order: { id: "ord_x", customer: u.customer },
        mode: "test",
      },
      { at: addDays(t0, 4) },
    );
    expect((await ledger(u.id)).length).toBe(before);
    expect(await grantBalance(u.id)).toBe(bal);
    expect((await flagsOf(u.id)).map((f) => f.kind).sort()).toEqual(["billing_dispute", "billing_refund"]);
  });

  it("unknown event types are acknowledged and logged", async () => {
    const r = await deliver("credits.granted", { x: 1 });
    expect(r.body).toMatchObject({ ok: true, outcome: "ignored" });
  });
});
