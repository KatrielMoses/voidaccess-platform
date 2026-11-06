import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { FOUNDING, PLANS } from "@voidaccess/config";
import { events, getDatabase } from "@voidaccess/db";
import { POST as checkoutPOST } from "@/app/api/billing/checkout/route";
import { GET as statusGET } from "@/app/api/billing/checkout/status/route";
import { POST as eventsPOST } from "@/app/api/preview/events/route";
import { runPostEffects } from "@/lib/billing/post-effects";
import { chooseUnlockOffer, countNoun, countsPhrase, safeReturnPath } from "@/lib/preview/offer";
import { parseClientPreviewEvent } from "@/lib/preview/events";
import { unlockCheckoutState } from "@/lib/preview/checkout-status";
import { failureReason, ABANDONED_AFTER_MS } from "@/components/results/preview/client-events";
import { asUser } from "./helpers";
import { addDays, deliver, makeBillingUser, provider, setupBilling, subSnapshot } from "./billing-helpers";

beforeAll(setupBilling);

const eventsFor = (userId: string, name: string) =>
  getDatabase().withSystem(
    "t",
    (tx) =>
      tx
        .select()
        .from(events)
        .where(and(eq(events.userId, userId), eq(events.name, name))),
    { audit: false },
  );

const totals = (o: Partial<Parameters<typeof countsPhrase>[0]> = {}) => ({
  sources: 0,
  entities: 0,
  byType: {},
  actors: 0,
  onions: 0,
  iocs: 0,
  relationships: 0,
  ...o,
});

describe("counts phrase", () => {
  it("is sources first, then the two largest entity or actor categories, in plain plural words", () => {
    expect(
      countsPhrase(
        totals({ sources: 38, byType: { BITCOIN_ADDRESS: 12, CVE_NUMBER: 3, EMAIL_ADDRESS: 0 }, actors: 6 }),
      ),
    ).toBe("38 sources, 12 Bitcoin wallets, 6 actors");
    expect(countsPhrase(totals({ sources: 1, byType: { IP_ADDRESS: 4, ONION_URL: 9 }, actors: 2 }))).toBe(
      "1 source, 9 onion addresses, 4 IP addresses",
    );
  });

  it("skips empty categories, and falls back to three categories when there are no sources", () => {
    expect(countsPhrase(totals({ byType: { MALWARE_FAMILY: 2, CVE_NUMBER: 1, DOMAIN: 5 } }))).toBe(
      "5 domains, 2 malware families, 1 CVE",
    );
    expect(countsPhrase(totals())).toBe("");
  });

  it("uses the existing type labels with singular and irregular plurals", () => {
    expect(countNoun("PERSON_NAME", 3)).toBe("3 people");
    expect(countNoun("URL", 105)).toBe("105 URLs");
    expect(countNoun("PERSON_NAME", 1)).toBe("1 person");
    expect(countNoun("FILE_HASH_SHA256", 2)).toBe("2 SHA-256 hashes");
    expect(countNoun("RANSOMWARE_GROUP", 2)).toBe("2 ransomware groups");
    expect(countNoun("CVE_NUMBER", 1500)).toBe("1,500 CVEs");
  });
});

describe("unlock price", () => {
  it("is the founding price only while a seat is free for this user, otherwise Pro monthly", () => {
    expect(chooseUnlockOffer({ seatsAvailable: 3, holdsSeat: false, hasSubscription: false })).toEqual({
      founding: true,
      priceUsd: FOUNDING.monthlyUsd,
    });
    for (const s of [
      { seatsAvailable: 0, holdsSeat: false, hasSubscription: false },
      { seatsAvailable: 3, holdsSeat: true, hasSubscription: false },
      { seatsAvailable: 3, holdsSeat: false, hasSubscription: true },
    ])
      expect(chooseUnlockOffer(s)).toEqual({ founding: false, priceUsd: PLANS.pro.monthlyUsd });
  });
});

describe("return path", () => {
  const id = randomUUID();
  it("accepts only this app's report paths", () => {
    expect(safeReturnPath(`/investigations/${id}`)).toBe(`/investigations/${id}`);
    expect(safeReturnPath(`/investigations/${id}/results`)).toBe(`/investigations/${id}/results`);
    expect(safeReturnPath(`/investigations/${id}/results/graph`)).toBe(`/investigations/${id}/results/graph`);
    expect(safeReturnPath(`/investigations/${id.toUpperCase()}/results/summary`)).toBe(
      `/investigations/${id}/results/summary`,
    );
  });
  it("refuses anything that could leave the report or the site", () => {
    for (const bad of [
      undefined,
      null,
      42,
      "",
      "/billing",
      "https://evil.example/investigations/" + id,
      "//evil.example/investigations/" + id,
      `/investigations/${id}/results/../../billing`,
      `/investigations/${id}/results/summary?next=https://evil.example`,
      `/investigations/${id}/results/summary#x`,
      `/investigations/${id}/results/nope`,
      `/investigations/${id}/results/graph/extra`,
      `/investigations/not-a-uuid/results`,
      `/investigations/${id}\\@evil.example`,
      `/investigations/${id}%2F..`,
      `\t/investigations/${id}`,
    ])
      expect(safeReturnPath(bad), String(bad)).toBeNull();
  });
});

describe("client preview events", () => {
  const id = randomUUID();
  it("accept only the three names, an investigation id and fixed reasons; content never passes", () => {
    expect(
      parseClientPreviewEvent({ name: "preview_shown", investigationId: id, sources: 3, title: "x" }),
    ).toEqual({
      name: "preview_shown",
      props: { investigationId: id, source: "preview_unlock", sources: 3 },
    });
    expect(
      parseClientPreviewEvent({ name: "unlock_clicked", investigationId: id, origin: "graph_node" })?.props,
    ).toMatchObject({ origin: "graph_node" });
    expect(
      parseClientPreviewEvent({ name: "unlock_clicked", investigationId: id, origin: "<b>" })?.props.origin,
    ).toBe("panel");
    expect(
      parseClientPreviewEvent({ name: "checkout_failed", investigationId: id, reason: "abandoned" })?.props,
    ).toMatchObject({ reason: "abandoned" });
    expect(
      parseClientPreviewEvent({ name: "checkout_failed", investigationId: id, reason: "card declined" }),
    ).toBeNull();
    expect(parseClientPreviewEvent({ name: "subscribed", investigationId: id })).toBeNull();
    expect(parseClientPreviewEvent({ name: "preview_shown", investigationId: "x" })).toBeNull();
  });

  it("the failure reason: Creem's expired status, else abandoned after a long absence, else a quick return", () => {
    const st = (provider: "pending" | "expired") => ({ paidPlan: false, completed: false, provider });
    expect(failureReason(st("expired"), 1000)).toBe("expired");
    expect(failureReason(st("pending"), 1000)).toBe("returned_without_payment");
    expect(failureReason(st("pending"), ABANDONED_AFTER_MS + 1)).toBe("abandoned");
    expect(failureReason(null, 0)).toBe("returned_without_payment");
  });

  it("the route records them for the signed-in user only", async () => {
    const u = await makeBillingUser();
    const post = (body: unknown) =>
      eventsPOST(
        new Request("http://localhost/api/preview/events", {
          method: "POST",
          headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
          body: JSON.stringify(body),
        }),
      );
    asUser(null);
    expect((await post({ name: "preview_shown", investigationId: id })).status).toBe(401);
    asUser(u.session);
    expect((await post({ name: "preview_shown", investigationId: id, sources: 4 })).status).toBe(204);
    expect((await post({ name: "nope", investigationId: id })).status).toBe(400);
    const rows = await eventsFor(u.id, "preview_shown");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.props).toMatchObject({ investigationId: id, sources: 4 });
    asUser(null);
  });
});

describe("checkout from the unlock panel", () => {
  const post = (body: unknown) =>
    checkoutPOST(
      new Request("http://localhost/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
        body: JSON.stringify(body),
      }),
    );
  const sub = (extra: Record<string, unknown>) => ({
    kind: "subscription",
    plan: "pro",
    interval: "month",
    ...extra,
  });

  it("returns to the same report with its reference, carries the source in the metadata, and logs checkout_started", async () => {
    const u = await makeBillingUser();
    const inv = randomUUID();
    asUser(u.session);
    provider.calls.length = 0;
    const res = await post(
      sub({ source: "preview_unlock", returnTo: `/investigations/${inv}/results/entities` }),
    );
    expect(res.status).toBe(200);
    const { url, ref } = (await res.json()) as { url: string; ref: string };
    expect(url).toContain("creem.io/test/checkout/");
    const ck = provider.calls.find((c) => c.op === "createCheckout")!.args as {
      successUrl: string;
      metadata: Record<string, string>;
    };
    expect(ck.successUrl).toBe(`http://localhost:3000/investigations/${inv}/results/entities?unlock=${ref}`);
    expect(ck.metadata).toMatchObject({ user_id: u.id, source: "preview_unlock", checkout_ref: ref });
    const started = await eventsFor(u.id, "checkout_started");
    expect(started[0]!.props).toMatchObject({
      source: "preview_unlock",
      investigationId: inv,
      checkoutRef: ref,
    });
    asUser(null);
  });

  it("refuses an off-site or malformed return path (no open redirect), and an unknown source", async () => {
    const u = await makeBillingUser();
    asUser(u.session);
    for (const returnTo of [
      "https://evil.example/",
      "//evil.example",
      "/billing",
      `/investigations/x/results`,
    ])
      expect((await post(sub({ source: "preview_unlock", returnTo }))).status, returnTo).toBe(400);
    expect(
      (await post(sub({ source: "newsletter", returnTo: `/investigations/${randomUUID()}/results` }))).status,
    ).toBe(400);
    // Billing's own checkout is unchanged
    provider.calls.length = 0;
    expect((await post(sub({}))).status).toBe(200);
    const ck = provider.calls.find((c) => c.op === "createCheckout")!.args as {
      successUrl: string;
      metadata: Record<string, string>;
    };
    expect(ck.successUrl).toContain("/billing?checkout=success");
    expect(ck.metadata.source).toBeUndefined();
    asUser(null);
  });

  it("status: the caller's own checkout only; Creem's status only when probed", async () => {
    const u = await makeBillingUser();
    const other = await makeBillingUser();
    asUser(u.session);
    const res = await post(sub({ source: "preview_unlock", returnTo: `/investigations/${randomUUID()}` }));
    const { ref } = (await res.json()) as { ref: string };
    provider.calls.length = 0;
    expect(await unlockCheckoutState(u.id, ref, { provider })).toEqual({
      plan: "free",
      paidPlan: false,
      completed: false,
      provider: null,
    });
    expect(provider.calls.filter((c) => c.op === "checkoutStatus")).toHaveLength(0);
    provider.checkoutStatusValue = "expired";
    expect((await unlockCheckoutState(u.id, ref, { probe: true, provider }))?.provider).toBe("expired");
    provider.checkoutStatusValue = "pending";
    expect(await unlockCheckoutState(other.id, ref, { provider })).toBeNull();
    expect(await unlockCheckoutState(u.id, "not-a-uuid", { provider })).toBeNull();
    const r = await statusGET(new Request(`http://localhost/api/billing/checkout/status?ref=${ref}`));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ paidPlan: false, completed: false });
    asUser(other.session);
    expect(
      (await statusGET(new Request(`http://localhost/api/billing/checkout/status?ref=${ref}`))).status,
    ).toBe(404);
    asUser(null);
  });
});

describe("webhook attribution", () => {
  it("subscribed carries source=preview_unlock from the subscription metadata", async () => {
    const u = await makeBillingUser();
    const now = new Date();
    const snap = await subSnapshot({
      user: u,
      subId: `sub_pv_${Date.now()}`,
      key: "pro_month",
      periodStart: now,
      periodEnd: addDays(now, 30),
    });
    const r = await deliver("subscription.active", {
      ...snap,
      metadata: { user_id: u.id, source: "preview_unlock" },
    });
    const subscribed = r.post.find((p) => p.kind === "subscribed");
    expect(subscribed).toMatchObject({ source: "preview_unlock", plan: "pro" });
    await runPostEffects(r.post.filter((p) => p.kind === "subscribed"));
    const rows = await eventsFor(u.id, "subscribed");
    expect(rows.at(-1)!.props).toMatchObject({ source: "preview_unlock", plan: "pro" });
  });

  it("a failed payment on a panel subscription records checkout_failed with Creem's status as the reason", async () => {
    const u = await makeBillingUser();
    const now = new Date();
    const snap = await subSnapshot({
      user: u,
      subId: `sub_pvf_${Date.now()}`,
      key: "pro_month",
      status: "past_due",
      periodStart: now,
      periodEnd: addDays(now, 30),
    });
    const r = await deliver("subscription.past_due", {
      ...snap,
      metadata: { user_id: u.id, source: "preview_unlock" },
    });
    const failed = r.post.find((p) => p.kind === "payment_failed");
    expect(failed).toMatchObject({ source: "preview_unlock", status: "past_due" });
    await runPostEffects([failed!]);
    const rows = await eventsFor(u.id, "checkout_failed");
    expect(rows[0]!.props).toMatchObject({ source: "preview_unlock", reason: "past_due", via: "webhook" });
  });

  it("an unknown source is never recorded", async () => {
    const u = await makeBillingUser();
    const now = new Date();
    const snap = await subSnapshot({
      user: u,
      subId: `sub_pvx_${Date.now()}`,
      key: "pro_month",
      periodStart: now,
      periodEnd: addDays(now, 30),
    });
    const r = await deliver("subscription.active", {
      ...snap,
      metadata: { user_id: u.id, source: "<script>" },
    });
    expect(r.post.find((p) => p.kind === "subscribed")).toMatchObject({ source: null });
  });
});
