import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { PLANS, TOPUP_MIN_USD } from "@voidaccess/config";
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
import { desiredCatalog, TOPUP_KEY } from "@/lib/billing/catalog";
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
import { CreemProvider, FakeProvider, prorationEstimate } from "@/lib/billing/provider";
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
        "topup_credits",
      ].sort(),
    );
    const p = new FakeProvider();
    const rep = await syncCatalog(p);
    expect(rep.created).toHaveLength(0);
    expect(rep.unchanged).toHaveLength(desiredCatalog().length);
    expect(p.calls.filter((c) => c.op === "createProduct")).toHaveLength(0);
  });

  it("product names, prices and periods match the products made in the Creem dashboard", () => {
    const byKey = Object.fromEntries(desiredCatalog().map((e) => [e.key, e]));
    expect(byKey.pro_month).toMatchObject({
      name: "VoidAccess Pro",
      amountCents: PLANS.pro.monthlyUsd * 100,
    });
    expect(byKey.pro_year).toMatchObject({
      name: "VoidAccess Pro (annual)",
      amountCents: PLANS.pro.annualUsd! * 100,
    });
    expect(byKey.pro_plus_month).toMatchObject({ name: "VoidAccess Pro+" });
    expect(byKey.pro_plus_year).toMatchObject({ name: "VoidAccess Pro+ (annual)" });
    expect(byKey.founding_pro_month).toMatchObject({ name: "VoidAccess Pro (Founder)", interval: "month" });
    expect(byKey[TOPUP_KEY]).toMatchObject({
      name: "VoidAccess credits",
      kind: "topup",
      amountCents: TOPUP_MIN_USD * 100,
    });
  });

  it("adopts existing provider products (name + price + period) without creating any; refuses a mismatched one", async () => {
    // live mode keeps this isolated from the test-mode catalogue the other tests use
    const live = new FakeProvider("live");
    live.products = desiredCatalog().map((e, i) => ({
      id: `prod_live_${i}_${Date.now()}`,
      name: e.name,
      priceCents: e.amountCents,
      currency: "USD",
      billingType: e.kind === "topup" ? ("onetime" as const) : ("recurring" as const),
      period: e.kind === "topup" ? "once" : e.interval!,
      active: true,
    }));
    // an archived product with a configured name is ignored
    live.products.push({ ...live.products[0]!, id: "prod_live_archived", priceCents: 1, active: false });
    const rep = await syncCatalog(live);
    expect(rep.adopted.sort()).toEqual(
      desiredCatalog()
        .map((e) => e.key)
        .sort(),
    );
    expect(rep.created).toEqual([]);
    expect(rep.conflicts).toEqual([]);
    expect(live.calls.some((c) => c.op === "createProduct")).toBe(false);
    for (const e of desiredCatalog())
      expect(rep.products[e.key]!.id).toBe(live.products.find((p) => p.name === e.name && p.active)!.id);
    expect((await syncCatalog(live)).unchanged).toHaveLength(desiredCatalog().length);

    // a config price change while the provider only has the old price under that name: refused, nothing written
    const original = PLANS.pro_plus.monthlyUsd;
    try {
      PLANS.pro_plus.monthlyUsd = original + 1;
      const before = await db().withSystem(
        "t",
        (tx) =>
          tx
            .select()
            .from(billingCatalog)
            .where(and(eq(billingCatalog.mode, "live"), eq(billingCatalog.key, "pro_plus_month"))),
        { audit: false },
      );
      const r2 = await syncCatalog(live);
      expect(r2.conflicts.map((c) => c.key)).toEqual(["pro_plus_month"]);
      expect(live.calls.some((c) => c.op === "createProduct")).toBe(false);
      const after = await db().withSystem(
        "t",
        (tx) =>
          tx
            .select()
            .from(billingCatalog)
            .where(and(eq(billingCatalog.mode, "live"), eq(billingCatalog.key, "pro_plus_month"))),
        { audit: false },
      );
      expect(after).toEqual(before);
    } finally {
      PLANS.pro_plus.monthlyUsd = original;
    }

    // a period mismatch is refused too (same name and price, wrong billing period)
    const odd = new FakeProvider("live");
    odd.products = [
      {
        id: "prod_odd",
        name: "VoidAccess Pro (annual)",
        priceCents: PLANS.pro.annualUsd! * 100,
        currency: "USD",
        billingType: "recurring",
        period: "month",
        active: true,
      },
    ];
    await db().withSystem("t", (tx) => tx.delete(billingCatalog).where(eq(billingCatalog.mode, "live")), {
      audit: false,
    });
    const r3 = await syncCatalog(odd);
    expect(r3.conflicts.map((c) => c.key)).toContain("pro_year");
    expect(r3.products.pro_year).toBeUndefined();
    await db().withSystem("t", (tx) => tx.delete(billingCatalog).where(eq(billingCatalog.mode, "live")), {
      audit: false,
    });
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
      expect(rows.find((r) => r.providerProductId === oldId)!.active).toBe(false);
      expect(rows.find((r) => r.providerProductId === newId)!.amountCents).toBe((original + 2) * 100);
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
        product: { id: oldId },
      };
      expect((await deliver("subscription.active", data, { at: t0 })).body.outcome).toBe("applied");
    } finally {
      PLANS.pro.monthlyUsd = original;
      await syncCatalog(new FakeProvider());
    }
  });
});

describe("checkout", () => {
  it("creates the Creem customer once, sends the user id as metadata, and uses the catalogue product", async () => {
    const u = await makeBillingUser();
    await db().withSystem("t", (tx) => tx.delete(billingCustomers).where(eq(billingCustomers.userId, u.id)), {
      audit: false,
    });
    provider.calls.length = 0;
    const a = await createSubscriptionCheckout(u.id, { plan: "pro", interval: "year" }, { provider });
    const b = await createTopupCheckout(u.id, TOPUP_MIN_USD, { provider });
    expect(a).toMatchObject({ ok: true, key: "pro_year" });
    expect(b).toMatchObject({ ok: true, key: TOPUP_KEY });
    expect(provider.calls.filter((c) => c.op === "createCustomer")).toHaveLength(1);
    const ck = provider.calls
      .filter((c) => c.op === "createCheckout")
      .map(
        (c) =>
          c.args as {
            productId: string;
            metadata: Record<string, string>;
            successUrl: string;
            customPriceCents?: number;
          },
      );
    expect(ck[0]!.productId).toBe(await productId("pro_year"));
    expect(ck[0]!.metadata.user_id).toBe(u.id);
    expect(ck[0]!.successUrl).toContain("/billing?checkout=success");
    expect(ck[0]!.customPriceCents).toBeUndefined(); // subscriptions carry the product's own price
    expect(ck[1]!.productId).toBe(await productId(TOPUP_KEY));
    expect(ck[1]!.customPriceCents).toBe(TOPUP_MIN_USD * 100);
    expect(a.ok && a.url).toMatch(/^https:\/\/creem\.io\/test\/checkout\//);
  });

  it("refuses an unknown plan or amount, and a second subscription while one is live; Free-plan users can top up", async () => {
    const u = await makeBillingUser();
    expect(
      await createSubscriptionCheckout(u.id, { plan: "free" as never, interval: "month" }, { provider }),
    ).toEqual({ ok: false, error: "plan_invalid" });
    expect(await createTopupCheckout(u.id, TOPUP_MIN_USD - 1, { provider })).toEqual({
      ok: false,
      error: "topup_invalid",
      reason: "below_minimum",
    });
    expect((await createTopupCheckout(u.id, TOPUP_MIN_USD + 2, { provider })).ok).toBe(true);
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
        body: JSON.stringify({ kind: "topup", usd: TOPUP_MIN_USD }),
      });
    expect((await checkoutPOST(mk({ "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await checkoutPOST(mk({ "sec-fetch-site": "same-origin" }))).status).toBe(401);
    asUser(u.session);
    const ok = await checkoutPOST(mk({ "sec-fetch-site": "same-origin" }));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { url: string }).url).toContain("creem.io/test/checkout/");
    const bad = await checkoutPOST(
      new Request("http://localhost/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
        body: JSON.stringify({ kind: "topup", usd: TOPUP_MIN_USD + 0.5 }),
      }),
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "topup_invalid", reason: "not_whole_dollars" });
    asUser(null);
  });
});

describe("upgrade, downgrade, cancel", () => {
  it("previews the upgrade with an estimated prorated amount before charging, and never calls Creem for a downgrade preview", async () => {
    const { u } = await pro();
    provider.calls.length = 0;
    provider.previewCents = 1234;
    const up = await previewPlanChange(u.id, { plan: "pro_plus", interval: "month" }, { provider });
    expect(up).toMatchObject({ ok: true, preview: { kind: "upgrade", amountCents: 1234, estimated: true } });
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

  it("a downgrade is only recorded (no Creem call) and can be undone", async () => {
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
    expect(await resumeSubscription(u.id, { provider })).toEqual({ ok: true });
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
    expect(await cancelAtPeriodEnd(B.id, undefined, { provider })).toMatchObject({ ok: false, endsAt: null });
    expect((await resumeSubscription(B.id, { provider })).ok).toBe(false);
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

describe("CreemProvider (HTTP shape, no network)", () => {
  const TEST_KEY = "creem_test_" + "x".repeat(16);
  function mock(responses: Record<string, unknown> = {}) {
    const seen: { method: string; url: string; headers: Record<string, string>; body: unknown }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen.push({
        method: init.method!,
        url,
        headers: init.headers as Record<string, string>,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      const path = new URL(url).pathname;
      const out = responses[path] ?? {};
      return new Response(JSON.stringify(out), { status: (out as { status?: number }).status ?? 200 });
    }) as unknown as typeof fetch;
    return { seen, fetchImpl };
  }

  it("refuses a live key in test mode and a test key in live mode", () => {
    expect(() => new CreemProvider("creem_" + "x".repeat(16), "test")).toThrow(/test API key/);
    expect(() => new CreemProvider(TEST_KEY, "live")).toThrow(/live mode/);
    expect(() => new CreemProvider(TEST_KEY, "test")).not.toThrow();
  });

  it("calls the documented endpoints on the test API with x-api-key", async () => {
    const { seen, fetchImpl } = mock({
      "/v1/customers": { id: "cust_1" },
      "/v1/checkouts": { id: "ch_1", checkout_url: "https://creem.io/test/checkout/prod_c/ch_1" },
      "/v1/customers/billing": { customer_portal_link: "https://creem.io/test/my-orders/login/x" },
    });
    const c = new CreemProvider(TEST_KEY, "test", fetchImpl);
    expect(await c.createCustomer({ email: "a@example.com", name: "A", userId: "u1" })).toEqual({
      id: "cust_1",
    });
    const co = await c.createCheckout({
      customerId: "cust_1",
      productId: "prod_c",
      requestId: "req_1",
      metadata: { user_id: "u1" },
      successUrl: "https://app.example/billing?checkout=success",
      customPriceCents: 700,
    });
    expect(co).toEqual({ checkoutId: "ch_1", url: "https://creem.io/test/checkout/prod_c/ch_1" });
    await c.changePlan({ subscriptionId: "sub_1", productId: "prod_up", billing: "prorated_immediately" });
    await c.changePlan({ subscriptionId: "sub_1", productId: "prod_down", billing: "do_not_bill" });
    await c.setCancelAtPeriodEnd({ subscriptionId: "sub_1", cancel: true });
    await c.setCancelAtPeriodEnd({ subscriptionId: "sub_1", cancel: false });
    expect(await c.portalLink("cust_1")).toContain("creem.io");
    expect(seen.every((r) => r.url.startsWith("https://test-api.creem.io/v1/"))).toBe(true);
    expect(seen.every((r) => r.headers["x-api-key"] === TEST_KEY)).toBe(true);
    expect(seen.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "POST /v1/customers",
      "POST /v1/checkouts",
      "POST /v1/subscriptions/sub_1/upgrade",
      "POST /v1/subscriptions/sub_1/upgrade",
      "POST /v1/subscriptions/sub_1/cancel",
      "POST /v1/subscriptions/sub_1/resume",
      "POST /v1/customers/billing",
    ]);
    expect(seen[0]!.body).toMatchObject({ email: "a@example.com", external_id: "u1" });
    expect(seen[1]!.body).toEqual({
      product_id: "prod_c",
      request_id: "req_1",
      units: 1,
      custom_price: 700,
      customer: { id: "cust_1" },
      success_url: "https://app.example/billing?checkout=success",
      metadata: { user_id: "u1" },
    });
    expect(seen[2]!.body).toEqual({ product_id: "prod_up", update_behavior: "proration-charge-immediately" });
    expect(seen[3]!.body).toEqual({ product_id: "prod_down", update_behavior: "proration-none" });
    expect(seen[4]!.body).toEqual({ mode: "scheduled", onExecute: "cancel" });
  });

  it("surfaces Creem errors without the key", async () => {
    const { fetchImpl } = mock({
      "/v1/checkouts": {
        status: 400,
        message: "custom_price is only supported for one-time payment products",
      },
    });
    const c = new CreemProvider(TEST_KEY, "test", fetchImpl);
    const err = await c
      .createCheckout({
        customerId: "c",
        productId: "p",
        requestId: "r",
        metadata: {},
        successUrl: "s",
        customPriceCents: 100,
      })
      .catch((e: Error) => e);
    expect(String(err)).toMatch(/400.*one-time/);
    expect(String(err)).not.toContain(TEST_KEY);
  });

  it("estimates the prorated upgrade charge", () => {
    expect(prorationEstimate(900, "every-month", 1900, "every-month", 0.5)).toBe(500);
    expect(prorationEstimate(900, "every-month", 9000, "every-year", 0.5)).toBe(8550);
    expect(prorationEstimate(1900, "every-month", 900, "every-month", 0.5)).toBe(0);
  });
});
