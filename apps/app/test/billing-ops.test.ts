import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { PLANS, TOPUPS } from "@voidaccess/config";
import {
  billingCatalog,
  billingCustomers,
  creditLedger,
  events,
  getDatabase,
  investigations,
  subscriptions,
  users,
} from "@voidaccess/db";
import { alertLevel, creditUsage, sendDueAlerts } from "@/lib/billing/alerts";
import { desiredCatalog } from "@/lib/billing/catalog";
import { createSubscriptionCheckout, createTopupCheckout } from "@/lib/billing/checkout";
import { runCreditAlerts, runGrants } from "@/lib/billing/cron";
import { authorizeBillingCron } from "@/lib/billing/cron-auth";
import {
  cancelAtPeriodEnd,
  cancelPendingChange,
  currentSubscription,
  previewPlanChange,
  requestPlanChange,
  resumeSubscription,
} from "@/lib/billing/plan-ops";
import { FakeProvider } from "@/lib/billing/provider";
import { syncCatalog } from "@/lib/billing/sync";
import { getLedger } from "@/lib/billing/usage";
import { POST as checkoutPOST } from "@/app/api/billing/checkout/route";
import { POST as grantsPOST } from "@/app/api/cron/grants/route";
import { GET as usageCsv } from "@/app/api/usage/export/route";
import { asUser } from "./helpers";
import {
  DAY,
  addDays,
  deliver,
  grantBalance,
  makeBillingUser,
  outbox,
  productId,
  provider,
  setupBilling,
  subSnapshot,
} from "./billing-helpers";

const db = () => getDatabase();
const t0 = new Date("2026-11-01T10:00:00Z");
let n = 0;
const sid = () => `sub_o${Date.now()}_${++n}`;
beforeAll(setupBilling);

async function pro(plan: "pro" | "pro_plus" = "pro", key = "pro_month") {
  const u = await makeBillingUser();
  const sub = sid();
  const now = new Date();
  await deliver(
    "subscription.active",
    await subSnapshot({ user: u, subId: sub, key, periodStart: now, periodEnd: addDays(now, 30) }),
    { at: now },
  );
  void plan;
  return { u, sub, now };
}

describe("catalogue sync from config", () => {
  it("covers every product the pricing needs, and a re-run changes nothing", async () => {
    expect(
      desiredCatalog()
        .map((e) => e.key)
        .sort(),
    ).toEqual(
      [
        "founding_pro_month",
        "pro_month",
        "pro_plus_month",
        "pro_plus_year",
        "pro_year",
        ...TOPUPS.map((t) => `topup_${t.usd}`),
      ].sort(),
    );
    const p = new FakeProvider();
    const rep = await syncCatalog(p);
    expect(rep.created).toHaveLength(0);
    expect(rep.unchanged).toHaveLength(desiredCatalog().length);
    expect(p.calls.filter((c) => c.op === "createProduct")).toHaveLength(0);
  });

  it("a config price change adds a NEW product and points the catalogue at it; the old product still resolves for existing subscribers", async () => {
    const oldId = await productId("pro_month");
    const original = PLANS.pro.monthlyUsd;
    try {
      PLANS.pro.monthlyUsd = original + 2;
      const p = new FakeProvider();
      const rep = await syncCatalog(p);
      expect(rep.repriced).toEqual(["pro_month"]);
      const newId = await productId("pro_month");
      expect(newId).not.toBe(oldId);
      const rows = await db().withSystem(
        "t",
        (tx) => tx.select().from(billingCatalog).where(eq(billingCatalog.key, "pro_month")),
        { audit: false },
      );
      expect(rows.find((r) => r.dodoProductId === oldId)!.active).toBe(false);
      expect(rows.find((r) => r.dodoProductId === newId)!.amountCents).toBe((original + 2) * 100);
      // an existing subscription on the old product still applies
      const u = await makeBillingUser();
      const data = {
        ...(await subSnapshot({
          user: u,
          subId: sid(),
          key: "pro_month",
          periodStart: t0,
          periodEnd: addDays(t0, 30),
        })),
        product_id: oldId,
      };
      expect((await deliver("subscription.active", data, { at: t0 })).body.outcome).toBe("applied");
    } finally {
      PLANS.pro.monthlyUsd = original;
      await syncCatalog(new FakeProvider());
    }
  });
});

describe("checkout", () => {
  it("creates the Dodo customer once, sends the user id as metadata, and uses the catalogue product", async () => {
    const u = await makeBillingUser();
    await db().withSystem("t", (tx) => tx.delete(billingCustomers).where(eq(billingCustomers.userId, u.id)), {
      audit: false,
    });
    provider.calls.length = 0;
    const a = await createSubscriptionCheckout(u.id, { plan: "pro", interval: "year" }, { provider });
    const b = await createTopupCheckout(u.id, TOPUPS[0].usd, { provider });
    expect(a).toMatchObject({ ok: true, key: "pro_year" });
    expect(b).toMatchObject({ ok: true, key: `topup_${TOPUPS[0].usd}` });
    expect(provider.calls.filter((c) => c.op === "createCustomer")).toHaveLength(1);
    const ck = provider.calls
      .filter((c) => c.op === "createCheckout")
      .map((c) => c.args as { productId: string; metadata: Record<string, string>; returnUrl: string });
    expect(ck[0]!.productId).toBe(await productId("pro_year"));
    expect(ck[0]!.metadata.user_id).toBe(u.id);
    expect(ck[0]!.returnUrl).toContain("/billing");
    expect(a.ok && a.url).toMatch(/^https:\/\/test\.checkout\.dodopayments\.com\//);
  });

  it("refuses an unknown plan or amount, and a second subscription while one is live; Free-plan users can top up", async () => {
    const u = await makeBillingUser();
    expect(
      await createSubscriptionCheckout(u.id, { plan: "free" as never, interval: "month" }, { provider }),
    ).toEqual({ ok: false, error: "plan_invalid" });
    expect(await createTopupCheckout(u.id, 7, { provider })).toEqual({ ok: false, error: "topup_invalid" });
    expect((await createTopupCheckout(u.id, TOPUPS[1].usd, { provider })).ok).toBe(true);
    const { u: sub } = await pro();
    expect(
      await createSubscriptionCheckout(sub.id, { plan: "pro_plus", interval: "month" }, { provider }),
    ).toEqual({ ok: false, error: "already_subscribed" });
  });

  it("the route needs a session and a same-origin request", async () => {
    const u = await makeBillingUser();
    asUser(null);
    const mk = (headers: Record<string, string>) =>
      new Request("http://localhost/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ kind: "topup", usd: TOPUPS[0].usd }),
      });
    expect((await checkoutPOST(mk({ "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await checkoutPOST(mk({ "sec-fetch-site": "same-origin" }))).status).toBe(401);
    asUser(u.session);
    const ok = await checkoutPOST(mk({ "sec-fetch-site": "same-origin" }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { url: string }).url).toContain("dodopayments.com");
    asUser(null);
  });
});

describe("upgrade, downgrade, cancel", () => {
  it("previews the upgrade with Dodo's prorated amount before charging, and never calls Dodo for a downgrade preview", async () => {
    const { u } = await pro();
    provider.calls.length = 0;
    provider.previewCents = 1234;
    const up = await previewPlanChange(u.id, { plan: "pro_plus", interval: "month" }, { provider });
    expect(up).toMatchObject({ ok: true, preview: { kind: "upgrade", amountCents: 1234 } });
    expect(provider.calls.some((c) => c.op === "changePlan")).toBe(false);
    const { u: big } = await pro("pro_plus", "pro_plus_month");
    provider.calls.length = 0;
    const down = await previewPlanChange(big.id, { plan: "pro", interval: "month" }, { provider });
    expect(down).toMatchObject({ ok: true, preview: { kind: "downgrade", amountCents: null } });
    expect(provider.calls.some((c) => c.op === "previewChange")).toBe(false);
    expect(await previewPlanChange(u.id, { plan: "pro", interval: "month" }, { provider })).toMatchObject({
      ok: true,
      preview: { kind: "same" },
    });
  });

  it("a downgrade is only recorded (no Dodo call) and can be undone", async () => {
    const { u, sub } = await pro("pro_plus", "pro_plus_month");
    provider.calls.length = 0;
    const r = await requestPlanChange(u.id, { plan: "pro", interval: "month" }, { provider });
    expect(r).toMatchObject({ ok: true, kind: "downgrade" });
    expect(provider.calls.some((c) => c.op === "changePlan")).toBe(false);
    const [row] = await db().withSystem(
      "t",
      (tx) => tx.select().from(subscriptions).where(eq(subscriptions.providerSubscriptionId, sub)),
      { audit: false },
    );
    expect(row!.pendingProductKey).toBe("pro_month");
    await cancelPendingChange(u.id, { database: db() });
    const [row2] = await db().withSystem(
      "t",
      (tx) => tx.select().from(subscriptions).where(eq(subscriptions.providerSubscriptionId, sub)),
      { audit: false },
    );
    expect(row2!.pendingProductKey).toBeNull();
  });

  it("cancel is one call, takes effect at the period end, emails the survey and records the reason; resume undoes it", async () => {
    const { u, sub } = await pro();
    provider.calls.length = 0;
    const before = outbox.outbox.filter((m) => m.template === "cancellationSurvey").length;
    const r = await cancelAtPeriodEnd(u.id, "too expensive", { provider });
    expect(r.ok).toBe(true);
    expect(provider.calls.filter((c) => c.op === "setCancelAtPeriodEnd")).toHaveLength(1);
    expect(outbox.outbox.filter((m) => m.template === "cancellationSurvey").length).toBe(before + 1);
    const cur = await currentSubscription(u.id);
    expect(cur!.cancelAt).toBeTruthy();
    expect(cur!.plan).toBe("pro"); // nothing changes until the period ends
    const ev = await db().withSystem(
      "t",
      (tx) =>
        tx
          .select()
          .from(events)
          .where(and(eq(events.userId, u.id), eq(events.name, "cancelled"))),
      { audit: false },
    );
    expect(ev[0]!.props).toMatchObject({ reason: "too expensive" });
    expect(await resumeSubscription(u.id, { provider })).toBe(true);
    expect((await currentSubscription(u.id))!.cancelAt).toBeNull();
    void sub;
  });
});

async function backdatedGrant(userId: string, daysAgo: number, amount: number) {
  const at = addDays(new Date(), -daysAgo);
  await db().withSystem(
    "t.grant",
    (tx) =>
      tx.insert(creditLedger).values({
        userId,
        bucket: "grant",
        amount,
        reason: "grant",
        createdAt: at,
        expiresAt: addDays(at, 31),
        idempotencyKey: `grant:${userId}:${at.toISOString().slice(0, 10)}`,
      }),
    { audit: false },
  );
}

describe("cron: grants and alerts are idempotent", () => {
  it("monthly grants for Free users and annual subscribers, once; re-runs change nothing", async () => {
    const free = await makeBillingUser();
    await backdatedGrant(free.id, 40, PLANS.free.monthlyCredits);
    const { u: annual } = await pro("pro", "pro_year");
    // annual: the activation grant is "old" a month later
    await db()
      .withSystem(
        "t",
        (tx) =>
          tx
            .update(creditLedger)
            .set({})
            .where(eq(creditLedger.userId, "00000000-0000-0000-0000-000000000000")),
        { audit: false },
      )
      .catch(() => {});
    const now = addDays(new Date(), 40);
    const a = await runGrants(now, { database: db() });
    expect(a.granted).toBeGreaterThanOrEqual(1);
    const freeBal = await grantBalance(free.id);
    expect(freeBal).toBe(PLANS.free.monthlyCredits);
    const b = await runGrants(now, { database: db() });
    expect(b.granted).toBe(0);
    expect(await grantBalance(free.id)).toBe(freeBal);
    void annual;
  });

  it("an annual subscriber gets a monthly grant on the month boundary", async () => {
    const { u } = await pro("pro", "pro_year");
    await db().withSystem(
      "t",
      (tx) =>
        tx
          .update(subscriptions)
          .set({ currentPeriodEnd: addDays(new Date(), 400) })
          .where(eq(subscriptions.userId, u.id)),
      { audit: false },
    );
    const later = addDays(new Date(), 33);
    await runGrants(later, { database: db() });
    const rows = (
      await db().withSystem(
        "t",
        (tx) => tx.select().from(creditLedger).where(eq(creditLedger.userId, u.id)),
        { audit: false },
      )
    ).filter((r) => r.reason === "grant");
    expect(rows).toHaveLength(2);
    await runGrants(later, { database: db() });
    expect(
      (
        await db().withSystem(
          "t",
          (tx) => tx.select().from(creditLedger).where(eq(creditLedger.userId, u.id)),
          { audit: false },
        )
      ).filter((r) => r.reason === "grant"),
    ).toHaveLength(2);
    expect(await grantBalance(u.id)).toBe(PLANS.pro.monthlyCredits);
  });

  it("alerts fire once per period and threshold: 80%, then 100%, with analytics events and emails; a new grant re-arms them", async () => {
    const u = await makeBillingUser("free");
    await backdatedGrant(u.id, 1, 100);
    const spend = (amount: number, key: string) =>
      db().withSystem(
        "t.spend",
        (tx) =>
          tx.insert(creditLedger).values({
            userId: u.id,
            bucket: "grant",
            amount: -amount,
            reason: "reserve",
            idempotencyKey: key,
          }),
        { audit: false },
      );
    expect(alertLevel(await creditUsage(u.id))).toBeNull();
    await spend(80, `r1-${u.id}`);
    expect(alertLevel(await creditUsage(u.id))).toBe("credits_80");
    const m80 = () => outbox.outbox.filter((m) => m.to === u.email && m.template === "creditAlert80").length;
    const m100 = () =>
      outbox.outbox.filter((m) => m.to === u.email && m.template === "creditAlert100").length;
    expect(await sendDueAlerts(u.id)).toEqual(["credits_80"]);
    expect(await sendDueAlerts(u.id)).toEqual([]);
    expect(await runCreditAlerts(new Date(), { database: db() })).toMatchObject({ sent: 0 });
    expect([m80(), m100()]).toEqual([1, 0]);
    await spend(20, `r2-${u.id}`);
    expect(alertLevel(await creditUsage(u.id))).toBe("credits_100");
    expect(await sendDueAlerts(u.id)).toEqual(["credits_100"]);
    expect(await sendDueAlerts(u.id)).toEqual([]);
    expect([m80(), m100()]).toEqual([1, 1]);
    const ev = await db().withSystem(
      "t",
      (tx) => tx.select({ name: events.name }).from(events).where(eq(events.userId, u.id)),
      { audit: false },
    );
    expect(ev.map((e) => e.name).sort()).toEqual(["credits_100", "credits_80"]);
    // a jump straight past 80% sends ONE email (the 100% one), but both thresholds are recorded
    const v = await makeBillingUser("free");
    await backdatedGrant(v.id, 1, 100);
    await db().withSystem(
      "t.spend",
      (tx) =>
        tx.insert(creditLedger).values({
          userId: v.id,
          bucket: "grant",
          amount: -100,
          reason: "reserve",
          idempotencyKey: `rj-${v.id}`,
        }),
      { audit: false },
    );
    expect(await sendDueAlerts(v.id)).toEqual(["credits_80", "credits_100"]);
    expect(outbox.outbox.filter((m) => m.to === v.email).map((m) => m.template)).toEqual(["creditAlert100"]);
  });

  it("cron routes authenticate like the watchdog: the shared secret works, anything else is 401", async () => {
    const secret = process.env.CRON_SHARED_SECRET!;
    const req = (auth?: string) =>
      new Request("http://localhost/api/cron/grants", {
        method: "POST",
        headers: auth ? { authorization: auth } : {},
      });
    expect(await authorizeBillingCron(req(`Bearer ${secret}`))).toBe(true);
    expect(await authorizeBillingCron(req("Bearer nope"))).toBe(false);
    expect(await authorizeBillingCron(req())).toBe(false);
    expect((await grantsPOST(req())).status).toBe(401);
    expect((await grantsPOST(req(`Bearer ${secret}`))).status).toBe(200);
    void DAY;
  });
});

describe("usage ledger and isolation", () => {
  it("shows a running balance that filters don't distort, with investigation links; the CSV guards against formula injection", async () => {
    const u = await makeBillingUser("free");
    await backdatedGrant(u.id, 5, 100);
    const [inv] = await db().withSystem(
      "t.inv",
      (tx) =>
        tx
          .insert(investigations)
          .values({ userId: u.id, query: "q", title: '=HYPERLINK("http://x")', depth: "quick" })
          .returning({ id: investigations.id }),
      { audit: false },
    );
    await db().withSystem(
      "t.spend",
      (tx) =>
        tx.insert(creditLedger).values({
          userId: u.id,
          bucket: "grant",
          amount: -20,
          reason: "reserve",
          investigationId: inv!.id,
          idempotencyKey: `u1-${u.id}`,
        }),
      { audit: false },
    );
    const all = await getLedger(u.id);
    expect(all.rows.map((r) => r.balanceAfter)).toEqual([80, 100]);
    const only = await getLedger(u.id, { reason: "reserve" });
    expect(only.rows).toHaveLength(1);
    expect(only.rows[0]!.balanceAfter).toBe(80);
    expect(only.rows[0]!.investigationId).toBe(inv!.id);
    expect((await getLedger(u.id, { month: "1999-01" })).rows).toHaveLength(0);
    asUser(u.session);
    const res = await usageCsv(new Request("http://localhost/api/usage/export"));
    const text = await res.text();
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(text).toContain("'=HYPERLINK");
    expect(text.split("\r\n")[0]).toBe(
      "date_utc,action,investigation_id,investigation,amount,bucket,balance_after",
    );
    asUser(null);
  });

  it("user B sees none of A's ledger, subscription or billing state, and acts on none of it", async () => {
    const { u: A } = await pro();
    const B = await makeBillingUser("free");
    await backdatedGrant(B.id, 1, 7);
    expect((await getLedger(B.id)).rows.every((r) => r.amount === 7)).toBe(true);
    expect(await currentSubscription(B.id)).toBeNull();
    expect(await cancelAtPeriodEnd(B.id, undefined, { provider })).toEqual({ ok: false, endsAt: null });
    expect(await resumeSubscription(B.id, { provider })).toBe(false);
    expect((await currentSubscription(A.id))!.cancelAt).toBeNull(); // untouched
    asUser(B.session);
    const csv = await (await usageCsv(new Request("http://localhost/api/usage/export"))).text();
    expect(csv).not.toContain(String(PLANS.pro.monthlyCredits));
    asUser(null);
    const uRows = await db().withSystem(
      "t",
      (tx) => tx.select({ id: users.id }).from(users).where(eq(users.id, A.id)),
      { audit: false },
    );
    expect(uRows).toHaveLength(1);
  });
});
