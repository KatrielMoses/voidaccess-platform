import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { PLANS, TOPUPS, topupCredits, type PlanId } from "@voidaccess/config";
import {
  abuseFlags,
  auditLog,
  billingEvents,
  creditLedger,
  getBalance,
  getDatabase,
  payments,
  topupLots,
} from "@voidaccess/db";
import { endCancelledSubscriptions } from "@/lib/billing/cron";
import { verifyWebhook, WEBHOOK_TOLERANCE_SECONDS } from "@/lib/billing/webhook-verify";
import {
  DAY,
  SECRET,
  addDays,
  deliver,
  grantBalance,
  ledger,
  makeBillingUser,
  outbox,
  paymentData,
  planOf,
  productId,
  setupBilling,
  subRows,
  subSnapshot,
} from "./billing-helpers";

const db = () => getDatabase();
beforeAll(setupBilling);

const t0 = new Date("2026-11-01T10:00:00Z");
let n = 0;
const sid = () => `sub_t${Date.now()}_${++n}`;

describe("webhook signature and freshness", () => {
  it("accepts a correctly signed event and rejects tampered, wrong-secret, stale and unsigned ones", async () => {
    const u = await makeBillingUser();
    const data = await subSnapshot({
      user: u,
      subId: sid(),
      key: "pro_month",
      periodStart: t0,
      periodEnd: addDays(t0, 30),
    });
    expect((await deliver("subscription.active", data, { at: t0 })).status).toBe(200);
    const u2 = await makeBillingUser();
    const d2 = await subSnapshot({
      user: u2,
      subId: sid(),
      key: "pro_month",
      periodStart: t0,
      periodEnd: addDays(t0, 30),
    });
    expect((await deliver("subscription.active", d2, { at: t0, tamper: true })).status).toBe(400);
    expect(
      (
        await deliver("subscription.active", d2, {
          at: t0,
          secret: "whsec_" + Buffer.from("another-secret-another-secret-xx").toString("base64"),
        })
      ).body.reason,
    ).toBe("bad_signature");
    expect(
      (await deliver("subscription.active", d2, { at: t0, skewSeconds: WEBHOOK_TOLERANCE_SECONDS + 5 })).body
        .reason,
    ).toBe("stale");
    expect(
      (await deliver("subscription.active", d2, { at: t0, skewSeconds: -(WEBHOOK_TOLERANCE_SECONDS + 5) }))
        .body.reason,
    ).toBe("stale");
    expect(verifyWebhook(SECRET, new Headers(), "{}").ok).toBe(false);
    expect(verifyWebhook(undefined, new Headers(), "{}")).toMatchObject({ ok: false, reason: "no_secret" });
    // none of the rejected deliveries changed anything for u2
    expect(await planOf(u2.id)).toBe("free");
    expect(await ledger(u2.id)).toHaveLength(0);
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

    const pay = paymentData({
      user: u,
      paymentId: `pay_${sub}`,
      subId: sub,
      cents: PLANS.pro.monthlyUsd * 100,
      at: t0,
    });
    await deliver("payment.succeeded", pay, { at: t0 });
    const rows = await db().withSystem(
      "t",
      (tx) => tx.select().from(payments).where(eq(payments.userId, u.id)),
      { audit: false },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.periodStart?.toISOString()).toBe(t0.toISOString());

    // exact duplicate delivery (same webhook-id): acknowledged, no effects
    const dup = await deliver("subscription.active", data, { id: "evt_dup_1", at: t0 });
    expect(dup.body).toMatchObject({ ok: true, outcome: "duplicate" });
    // replay of the same period under a different event id: the period-keyed ledger entry blocks a second grant
    await deliver("subscription.active", data, { at: t0 });
    await deliver("subscription.renewed", data, { at: t0 });
    expect(await grantBalance(u.id)).toBe(PLANS.pro.monthlyCredits);
    expect((await ledger(u.id)).filter((r) => r.reason === "grant")).toHaveLength(1);
    const ev = await db().withSystem(
      "t",
      (tx) => tx.select().from(billingEvents).where(eq(billingEvents.eventId, "evt_dup_1")),
      { audit: false },
    );
    expect(ev).toHaveLength(1);
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

  it("monthly renewal grants the next period and expires the old remainder; the plan stays", async () => {
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
      "subscription.renewed",
      await subSnapshot({
        user: u,
        subId: sub,
        key: "pro_month",
        periodStart: t1,
        periodEnd: addDays(t1, 30),
      }),
      { at: t1 },
    );
    expect(await grantBalance(u.id)).toBe(PLANS.pro.monthlyCredits); // previous remainder expired, new grant added: no rollover
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
      "subscription.renewed",
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

  it("payment before the subscription event: the payment is linked and gets its billing period when the snapshot arrives", async () => {
    const u = await makeBillingUser();
    const sub = sid();
    await deliver(
      "payment.succeeded",
      paymentData({ user: u, paymentId: `pay_${sub}`, subId: sub, cents: 900, at: t0 }),
      { at: t0 },
    );
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
    const [p] = await db().withSystem(
      "t",
      (tx) => tx.select().from(payments).where(eq(payments.userId, u.id)),
      { audit: false },
    );
    expect(p!.subscriptionId).not.toBeNull();
    expect(p!.periodStart?.toISOString()).toBe(t0.toISOString());
    expect(await grantBalance(u.id)).toBe(PLANS.pro.monthlyCredits);
  });
});

describe("identity: unknown customers are rejected, never guessed", () => {
  it("an unmapped customer, or a metadata user that disagrees with the mapping, changes nothing and leaves an audit row", async () => {
    const victim = await makeBillingUser();
    const stranger = { ...victim, customer: "cus_not_mapped" };
    const sub = sid();
    const a = await deliver(
      "subscription.active",
      await subSnapshot({
        user: stranger,
        subId: sub,
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
    await deliver("subscription.plan_changed", up, { at: mid });
    expect(await planOf(u.id)).toBe("pro_plus");
    const diff = PLANS.pro_plus.monthlyCredits - PLANS.pro.monthlyCredits;
    expect(await grantBalance(u.id)).toBe(PLANS.pro.monthlyCredits + diff);
    await deliver("subscription.plan_changed", up, { at: mid }); // new event id, same change
    await deliver("subscription.updated", up, { at: addDays(mid, 1) });
    expect(await grantBalance(u.id)).toBe(PLANS.pro_plus.monthlyCredits);
    expect((await ledger(u.id)).filter((r) => r.idempotencyKey.startsWith("grant-diff:"))).toHaveLength(1);

    // downgrade: Dodo's product changes mid-period, but the plan (and credits) stay until the new period starts
    const down = await subSnapshot({
      user: u,
      subId: sub,
      key: "pro_month",
      periodStart: t0,
      periodEnd: addDays(t0, 30),
    });
    await deliver("subscription.plan_changed", down, { at: addDays(t0, 20) });
    expect(await planOf(u.id)).toBe("pro_plus");
    const [pending] = await subRows(u.id);
    expect(pending!.pendingProductKey).toBe("pro_month");
    const t1 = addDays(t0, 30);
    await deliver(
      "subscription.renewed",
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

  it("cancel at period end keeps the plan until then; the cron then moves the user to Free; an immediate end moves them at once", async () => {
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
    const end = addDays(t0, 30);
    await deliver(
      "subscription.updated",
      await subSnapshot({
        user: u,
        subId: sub,
        key: "pro_month",
        periodStart: t0,
        periodEnd: end,
        cancelFlag: true,
      }),
      { at: addDays(t0, 5) },
    );
    expect((await subRows(u.id))[0]!.cancelAt?.toISOString()).toBe(end.toISOString());
    expect(await planOf(u.id)).toBe("pro");
    await deliver(
      "subscription.cancelled",
      await subSnapshot({
        user: u,
        subId: sub,
        key: "pro_month",
        status: "cancelled",
        periodStart: t0,
        periodEnd: end,
      }),
      { at: addDays(t0, 6) },
    );
    expect(await planOf(u.id)).toBe("pro"); // still inside the paid period
    expect(await endCancelledSubscriptions(addDays(t0, 29), db())).toBe(0);
    expect(await endCancelledSubscriptions(addDays(end, 1), db())).toBeGreaterThanOrEqual(1);
    expect(await planOf(u.id)).toBe("free");
    expect(await grantBalance(u.id)).toBe(PLANS.free.monthlyCredits);
    expect(await endCancelledSubscriptions(addDays(end, 2), db())).toBe(0); // idempotent

    const v = await makeBillingUser();
    const s2 = sid();
    await deliver(
      "subscription.active",
      await subSnapshot({ user: v, subId: s2, key: "pro_month", periodStart: t0, periodEnd: end }),
      { at: t0 },
    );
    await deliver(
      "subscription.expired",
      await subSnapshot({
        user: v,
        subId: s2,
        key: "pro_month",
        status: "expired",
        periodStart: t0,
        periodEnd: end,
      }),
      { at: addDays(end, 3) },
    );
    expect(await planOf(v.id)).toBe("free");
  });

  it("past due keeps the plan and flags the subscription; it ends only on Dodo's final state", async () => {
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
    await deliver(
      "subscription.on_hold",
      await subSnapshot({
        user: u,
        subId: sub,
        key: "pro_month",
        status: "on_hold",
        periodStart: t0,
        periodEnd: addDays(t0, 30),
      }),
      { at: addDays(t0, 31) },
    );
    expect(await planOf(u.id)).toBe("pro");
    expect((await subRows(u.id))[0]!.status).toBe("past_due");
    const failed = await deliver(
      "payment.failed",
      paymentData({ user: u, paymentId: "pay_failed_" + sub, subId: sub, cents: 900, at: addDays(t0, 31) }),
      { at: addDays(t0, 31) },
    );
    expect(failed.post.map((p) => p.kind)).toEqual(["payment_failed"]);
    await deliver(
      "subscription.expired",
      await subSnapshot({
        user: u,
        subId: sub,
        key: "pro_month",
        status: "expired",
        periodStart: t0,
        periodEnd: addDays(t0, 30),
      }),
      { at: addDays(t0, 40) },
    );
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

describe("top-ups", () => {
  const plans: PlanId[] = ["free", "pro", "pro_plus"];
  for (const plan of plans) {
    for (const tier of TOPUPS) {
      it(`${plan}: a ${tier.usd} top-up grants exactly topupCredits(), once`, async () => {
        const u = await makeBillingUser(plan);
        const pid = `pay_top_${plan}_${tier.usd}_${u.id}`;
        const data = paymentData({
          user: u,
          paymentId: pid,
          productId: await productId(`topup_${tier.usd}`),
          cents: tier.usd * 100,
          at: t0,
        });
        await deliver("payment.succeeded", data, { at: t0 });
        await deliver("payment.succeeded", data, { at: t0 }); // replay under a new event id
        const lots = await db().withSystem(
          "t",
          (tx) => tx.select().from(topupLots).where(eq(topupLots.userId, u.id)),
          { audit: false },
        );
        expect(lots).toHaveLength(1);
        expect(lots[0]!.creditsInitial).toBe(topupCredits(tier.usd, plan));
        const bal = await getBalance(u.id, { now: t0 });
        expect(bal.topup).toBe(topupCredits(tier.usd, plan));
        expect(lots[0]!.expiresAt.getTime()).toBeGreaterThan(t0.getTime() + 300 * DAY);
      });
    }
  }
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
    const refund = {
      payload_type: "Refund",
      refund_id: "ref_1",
      payment_id: "pay_x",
      customer: { customer_id: u.customer },
      metadata: {},
    };
    await deliver("refund.succeeded", refund, { at: addDays(t0, 3) });
    await deliver(
      "dispute.opened",
      {
        payload_type: "Dispute",
        dispute_id: "dp_1",
        payment_id: "pay_x",
        customer: { customer_id: u.customer },
        metadata: {},
      },
      { at: addDays(t0, 4) },
    );
    expect((await ledger(u.id)).length).toBe(before);
    expect(await grantBalance(u.id)).toBe(bal);
    const flags = await db().withSystem(
      "t",
      (tx) => tx.select().from(abuseFlags).where(eq(abuseFlags.userId, u.id)),
      { audit: false },
    );
    expect(flags.map((f) => f.kind).sort()).toEqual(["billing_dispute", "billing_refund"]);
    void creditLedger;
  });
  it("unknown event types are acknowledged and logged", async () => {
    const r = await deliver("something.new", { x: 1 });
    expect(r.body).toMatchObject({ ok: true, outcome: "ignored" });
  });
});
