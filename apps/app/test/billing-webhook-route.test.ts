import { beforeAll, describe, expect, it } from "vitest";
import { PLANS } from "@voidaccess/config";
import { POST } from "@/app/api/webhooks/dodo/route";
import { signWebhook } from "@/lib/billing/webhook-verify";
import { SECRET, grantBalance, makeBillingUser, planOf, setupBilling, subSnapshot } from "./billing-helpers";

beforeAll(setupBilling);

describe("POST /api/webhooks/dodo", () => {
  it("reads the raw body, verifies, applies once, and answers Dodo's retry rules (2xx done, 4xx bad, 5xx retry)", async () => {
    const u = await makeBillingUser();
    const t = new Date();
    const body = JSON.stringify({
      type: "subscription.active",
      timestamp: t.toISOString(),
      data: await subSnapshot({
        user: u,
        subId: `sub_route_${u.id}`,
        key: "pro_month",
        periodStart: t,
        periodEnd: new Date(t.getTime() + 30 * 86_400_000),
      }),
    });
    const send = (over: Record<string, string> = {}, b = body, signed = body) => {
      const ts = String(Math.floor(Date.now() / 1000));
      const id = over["webhook-id"] ?? "evt_route_" + u.id;
      return POST(
        new Request("http://localhost/api/webhooks/dodo", {
          method: "POST",
          body: b,
          headers: {
            "webhook-id": id,
            "webhook-timestamp": ts,
            "webhook-signature": signWebhook(SECRET, id, Number(ts), signed),
            ...over,
          },
        }),
      );
    };
    expect((await send({ "webhook-signature": "v1,AAAA" })).status).toBe(400);
    expect((await send({}, body + " ")).status).toBe(400); // signature covers the exact bytes
    expect(
      (await POST(new Request("http://localhost/api/webhooks/dodo", { method: "POST", body }))).status,
    ).toBe(400);
    expect(await planOf(u.id)).toBe("free");
    const ok = await send();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, outcome: "applied" });
    expect(await planOf(u.id)).toBe("pro");
    expect(await grantBalance(u.id)).toBe(PLANS.pro.monthlyCredits);
    expect(await (await send()).json()).toMatchObject({ outcome: "duplicate" });
    expect(await grantBalance(u.id)).toBe(PLANS.pro.monthlyCredits);
  });
});
