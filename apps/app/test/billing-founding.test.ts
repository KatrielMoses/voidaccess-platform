import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FOUNDING, PLANS } from "@voidaccess/config";
import {
  availableSeats,
  foundingNotices,
  foundingSeats,
  getDatabase,
  investigations,
  payments,
  subscriptions,
  users,
} from "@voidaccess/db";
import { createSubscriptionCheckout } from "@/lib/billing/checkout";
import { applyPendingChanges, runFounding, sendDueFoundingNotices } from "@/lib/billing/cron";
import { requestPlanChange } from "@/lib/billing/plan-ops";
import { GET as seatsGET } from "@/app/api/founding/seats/route";
import {
  DAY,
  addDays,
  deliver,
  grantBalance,
  makeBillingUser,
  outbox,
  paymentData,
  planOf,
  productId,
  provider,
  setupBilling,
  subRows,
  subSnapshot,
  type BUser,
} from "./billing-helpers";
import { randomUUID } from "node:crypto";

const db = () => getDatabase();
const t0 = new Date("2026-01-10T10:00:00Z");
const addMonths = (d: Date, n: number) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate(), d.getUTCHours()));
let n = 0;
const sid = () => `sub_f${Date.now()}_${++n}`;

beforeAll(setupBilling);
beforeEach(async () => {
  await db().withSystem("t.reset", async (tx) => {
    await tx.update(foundingSeats).set({
      holderUserId: null,
      lastHolderUserId: null,
      claimedAt: null,
      termStart: null,
      anniversaryAt: null,
      releasedAt: null,
      releaseReason: null,
    });
    await tx.delete(foundingNotices);
  });
  provider.calls.length = 0;
});

async function activateFounding(u: BUser, at = t0) {
  const sub = sid();
  await deliver(
    "subscription.active",
    await subSnapshot({
      user: u,
      subId: sub,
      key: "founding_pro_month",
      periodStart: at,
      periodEnd: addDays(at, 30),
    }),
    { at },
  );
  return sub;
}
const seatOf = async (userId: string) =>
  (
    await db().withSystem(
      "t",
      (tx) => tx.select().from(foundingSeats).where(eq(foundingSeats.holderUserId, userId)),
      { audit: false },
    )
  )[0];
const mails = (template: string) => outbox.outbox.filter((m) => m.template === template);

describe("claim", () => {
  it("the first paid founding subscription claims a seat, with the term starting at the first payment", async () => {
    const u = await makeBillingUser();
    await activateFounding(u);
    const seat = await seatOf(u.id);
    expect(seat).toBeTruthy();
    expect(seat!.termStart?.toISOString()).toBe(t0.toISOString());
    expect(seat!.anniversaryAt?.toISOString()).toBe(addMonths(t0, FOUNDING.termMonths).toISOString());
    expect(await planOf(u.id)).toBe("pro");
    expect(await grantBalance(u.id)).toBe(FOUNDING.monthlyCredits);
    expect((await subRows(u.id))[0]!.isFounding).toBe(true);
    expect(await availableSeats({ database: db() })).toBe(FOUNDING.seats - 1);
  });

  it("100 seats, race-safe: with 3 left and 6 simultaneous activations exactly 3 win; the others are flagged and moved to standard Pro at the period end", async () => {
    // fill all but 3 seats with real users
    const filler = await db().withSystem("t.fill", async (tx) => {
      const ids: string[] = [];
      for (let i = 1; i <= FOUNDING.seats - 3; i++) {
        const id = randomUUID();
        await tx.insert(users).values({ id, name: "F" + i, email: `${id}@fill.test` });
        await tx
          .update(foundingSeats)
          .set({
            holderUserId: id,
            lastHolderUserId: id,
            claimedAt: t0,
            termStart: t0,
            anniversaryAt: addMonths(t0, 12),
          })
          .where(eq(foundingSeats.seatNo, i));
        ids.push(id);
      }
      return ids;
    });
    expect(filler).toHaveLength(FOUNDING.seats - 3);
    expect(await availableSeats({ database: db() })).toBe(3);

    const contenders = await Promise.all(Array.from({ length: 6 }, () => makeBillingUser()));
    await Promise.all(contenders.map((u) => activateFounding(u)));
    const holders = (await Promise.all(contenders.map((u) => seatOf(u.id)))).filter(Boolean);
    expect(holders).toHaveLength(3);
    expect(await availableSeats({ database: db() })).toBe(0);
    const losers = contenders.filter((_, i) => !holders.some((h) => h?.holderUserId === contenders[i]!.id));
    expect(losers).toHaveLength(3);
    for (const l of losers) {
      expect(await planOf(l.id)).toBe("pro"); // they paid, they get Pro
      const [s] = await subRows(l.id);
      expect(s!.isFounding).toBe(false);
      expect(s!.pendingProductKey).toBe("pro_month");
    }

    // founding checkout is refused while the seats are gone, and standard Pro is still available
    const fresh = await makeBillingUser();
    expect(
      await createSubscriptionCheckout(
        fresh.id,
        { plan: "pro", interval: "month", founding: true },
        { provider },
      ),
    ).toEqual({ ok: false, error: "founding_unavailable" });
    expect(
      (await createSubscriptionCheckout(fresh.id, { plan: "pro", interval: "month" }, { provider })).ok,
    ).toBe(true);

    // a released seat reopens, and the public counter shows it
    const res = await seatsGET();
    expect(await res.json()).toMatchObject({ available: 0, total: FOUNDING.seats, source: "db" });
    await db().withSystem("t.release", (tx) =>
      tx.update(foundingSeats).set({ holderUserId: null }).where(eq(foundingSeats.seatNo, 1)),
    );
    expect(await (await seatsGET()).json()).toMatchObject({ available: 1 });
    const open = await createSubscriptionCheckout(
      fresh.id,
      { plan: "pro", interval: "month", founding: true },
      { provider },
    );
    expect(open.ok).toBe(true);
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
  });

  it("founding is monthly Pro only", async () => {
    const u = await makeBillingUser();
    expect(
      await createSubscriptionCheckout(u.id, { plan: "pro", interval: "year", founding: true }, { provider }),
    ).toEqual({ ok: false, error: "founding_unavailable" });
    expect(
      await createSubscriptionCheckout(
        u.id,
        { plan: "pro_plus", interval: "month", founding: true },
        { provider },
      ),
    ).toEqual({ ok: false, error: "founding_unavailable" });
  });
});

async function payMonths(u: BUser, sub: string, months: number[]) {
  for (const m of months) {
    const at = addMonths(t0, m);
    await db().withSystem("t.pay", (tx) =>
      tx.insert(payments).values({
        userId: u.id,
        providerPaymentId: `pay_${u.id}_${m}`,
        amountCents: FOUNDING.monthlyUsd * 100,
        kind: "subscription",
        paidAt: at,
        periodStart: at,
        periodEnd: addDays(at, 30),
        meta: { providerSubscriptionId: sub },
      }),
    );
  }
}
async function activity(u: BUser, at: Date) {
  await db().withSystem("t.inv", (tx) =>
    tx.insert(investigations).values({ userId: u.id, query: "q", depth: "quick", createdAt: at }),
  );
}

describe("yearly renewal check, release, notices", () => {
  it("renews at 3 or more paid months of the trailing 12; releases below 3, moving a paying founder to Pro only at the next renewal", async () => {
    const keep = await makeBillingUser();
    const lose = await makeBillingUser();
    const keepSub = await activateFounding(keep);
    const loseSub = await activateFounding(lose);
    await payMonths(keep, keepSub, [0, 1, 2, 5]);
    await payMonths(lose, loseSub, [0, 1]);
    await activity(keep, addMonths(t0, 11));
    await activity(lose, addMonths(t0, 11));

    const anniversary = addMonths(t0, FOUNDING.termMonths);
    const now = addDays(anniversary, 1);
    // the loser's subscription period ends 20 days after "now" (current period for the check)
    await db().withSystem("t.period", (tx) =>
      tx
        .update(subscriptions)
        .set({ currentPeriodStart: addDays(now, -10), currentPeriodEnd: addDays(now, 20) })
        .where(eq(subscriptions.providerSubscriptionId, loseSub)),
    );
    const out = await runFounding(now, { database: db(), provider });
    expect(out.renewed).toBe(1);
    expect(out.released).toBe(1);
    expect((await seatOf(keep.id))!.anniversaryAt?.toISOString()).toBe(
      addMonths(anniversary, 12).toISOString(),
    );
    expect(await seatOf(lose.id)).toBeUndefined();
    expect(await availableSeats({ database: db() })).toBe(FOUNDING.seats - 1); // the reopened seat counts

    // applied at the next renewal, never mid-period
    const [s] = await subRows(lose.id);
    expect(s!.isFounding).toBe(false);
    expect(s!.pendingProductKey).toBe("pro_month");
    expect(s!.pendingEffectiveAt?.toISOString()).toBe(addDays(now, 20).toISOString());
    const forLoser = () =>
      provider.calls.filter(
        (c) => c.op === "changePlan" && (c.args as { subscriptionId: string }).subscriptionId === loseSub,
      );
    expect(forLoser()).toHaveLength(0); // 20 days out: nothing asked of Dodo yet
    expect(await planOf(lose.id)).toBe("pro");

    // the day before the period ends the cron asks Dodo for a no-charge product switch, once
    expect(await applyPendingChanges(addDays(now, 19.5), { database: db(), provider })).toBe(1);
    expect(await applyPendingChanges(addDays(now, 19.6), { database: db(), provider })).toBe(0);
    const call = provider.calls.find((c) => c.op === "changePlan")!.args as {
      billing: string;
      productId: string;
    };
    expect(call.billing).toBe("do_not_bill");
    expect(call.productId).toBe(await productId("pro_month"));

    // Dodo then renews on the standard Pro product: plan stays Pro, grant for the new period
    const t1 = addDays(now, 20);
    await deliver(
      "subscription.renewed",
      await subSnapshot({
        user: lose,
        subId: loseSub,
        key: "pro_month",
        periodStart: t1,
        periodEnd: addDays(t1, 30),
      }),
      { at: t1 },
    );
    expect(await planOf(lose.id)).toBe("pro");
    expect((await subRows(lose.id))[0]!.productKey).toBe("pro_month");
    expect(await grantBalance(lose.id)).toBe(PLANS.pro.monthlyCredits);
  });

  it("releases after 10 inactive months, and a released founder who has left lands on Free", async () => {
    const u = await makeBillingUser();
    await activateFounding(u);
    const out = await runFounding(addMonths(t0, FOUNDING.inactivityReleaseMonths), {
      database: db(),
      provider,
    });
    expect(out.released).toBe(1);
    expect(await seatOf(u.id)).toBeUndefined();
  });

  it("sends the 30-day warning and the release-day notice exactly once each", async () => {
    const u = await makeBillingUser();
    const sub = await activateFounding(u);
    await payMonths(u, sub, [0]);
    await activity(u, addMonths(t0, 11));
    const anniversary = addMonths(t0, FOUNDING.termMonths);
    const warnAt = addDays(anniversary, -FOUNDING.noticeDaysBeforeRelease + 1);

    const before = mails("foundingReleaseWarning").length;
    const first = await runFounding(warnAt, { database: db(), provider });
    expect(first.noticesScheduled).toBe(1);
    expect(first.noticesSent).toBe(1);
    expect(mails("foundingReleaseWarning").length).toBe(before + 1);
    expect((await runFounding(addDays(warnAt, 1), { database: db(), provider })).noticesSent).toBe(0);
    expect(await sendDueFoundingNotices(addDays(warnAt, 2), db())).toBe(0);
    expect(mails("foundingReleaseWarning").length).toBe(before + 1);

    const releasedBefore = mails("foundingReleased").length;
    const day = addDays(anniversary, 1);
    const out = await runFounding(day, { database: db(), provider });
    expect(out.released).toBe(1);
    expect(mails("foundingReleased").length).toBe(releasedBefore + 1);
    await runFounding(addDays(day, 1), { database: db(), provider });
    expect(mails("foundingReleased").length).toBe(releasedBefore + 1);
    const open = await db().withSystem(
      "t",
      (tx) =>
        tx
          .select()
          .from(foundingNotices)
          .where(and(eq(foundingNotices.userId, u.id), isNull(foundingNotices.sentAt))),
      { audit: false },
    );
    expect(open).toHaveLength(0);
  });
});

describe("moving off the founding price", () => {
  it("upgrading to Pro+ needs an explicit confirmation, then releases the seat when Dodo applies the change", async () => {
    const u = await makeBillingUser();
    const sub = await activateFounding(u);
    expect(await requestPlanChange(u.id, { plan: "pro_plus", interval: "month" }, { provider })).toEqual({
      ok: false,
      error: "founding_release_confirmation_required",
    });
    expect(provider.calls.filter((c) => c.op === "changePlan")).toHaveLength(0);
    expect(await seatOf(u.id)).toBeTruthy(); // the warning alone releases nothing

    const r = await requestPlanChange(
      u.id,
      { plan: "pro_plus", interval: "month", confirmReleaseFounding: true },
      { provider },
    );
    expect(r).toMatchObject({ ok: true, kind: "upgrade" });
    expect((provider.calls.find((c) => c.op === "changePlan")!.args as { billing: string }).billing).toBe(
      "prorated_immediately",
    );

    await deliver(
      "subscription.plan_changed",
      await subSnapshot({
        user: u,
        subId: sub,
        key: "pro_plus_month",
        periodStart: t0,
        periodEnd: addDays(t0, 30),
      }),
      { at: addDays(t0, 5) },
    );
    expect(await seatOf(u.id)).toBeUndefined();
    expect(await planOf(u.id)).toBe("pro_plus");
    expect((await subRows(u.id))[0]!.isFounding).toBe(false);
    expect(await grantBalance(u.id)).toBe(PLANS.pro_plus.monthlyCredits);
    const seat = await db().withSystem(
      "t",
      (tx) => tx.select().from(foundingSeats).where(eq(foundingSeats.lastHolderUserId, u.id)),
      { audit: false },
    );
    expect(seat[0]!.releaseReason).toBe("upgraded");
    expect(await availableSeats({ database: db() })).toBe(FOUNDING.seats);
    void DAY;
  });
});
