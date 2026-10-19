import { beforeAll, describe, expect, it } from "vitest";
import { PLANS } from "@voidaccess/config";
import { POST } from "@/app/api/webhooks/creem/route";
import { handleCreemWebhook } from "@/lib/billing/webhook";
import { SIGNATURE_HEADER, signWebhook } from "@/lib/billing/webhook-verify";
import { SECRET, grantBalance, makeBillingUser, planOf, setupBilling, subSnapshot } from "./billing-helpers";

beforeAll(setupBilling);

const URL_ = "http://localhost/api/webhooks/creem";

describe("POST /api/webhooks/creem", () => {
  it("reads the raw body, verifies, applies once, and answers Creem's retry rules (2xx done, 4xx bad, 5xx retry)", async () => {
    const u = await makeBillingUser();
    const t = new Date();
    const body = JSON.stringify({
      id: "evt_route_" + u.id,
      eventType: "subscription.active",
      created_at: t.getTime(),
      object: await subSnapshot({
        user: u,
        subId: `sub_route_${u.id}`,
        key: "pro_month",
        periodStart: t,
        periodEnd: new Date(t.getTime() + 30 * 86_400_000),
      }),
    });
    const send = (sig: string | null, b = body) =>
      POST(
        new Request(URL_, {
          method: "POST",
          body: b,
          headers: sig === null ? {} : { [SIGNATURE_HEADER]: sig },
        }),
      );
    expect((await send("00".repeat(32))).status).toBe(400);
    expect((await send(signWebhook(SECRET, body), body + " ")).status).toBe(400); // signature covers the exact bytes
    expect((await send(null)).status).toBe(400);
    // signed but not an event
    expect((await send(signWebhook(SECRET, "{}"), "{}")).status).toBe(400);
    expect(await planOf(u.id)).toBe("free");
    const ok = await send(signWebhook(SECRET, body));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, outcome: "applied" });
    expect(await planOf(u.id)).toBe("pro");
    expect(await grantBalance(u.id)).toBe(PLANS.pro.monthlyCredits);
    expect(await (await send(signWebhook(SECRET, body))).json()).toMatchObject({ outcome: "duplicate" });
    expect(await grantBalance(u.id)).toBe(PLANS.pro.monthlyCredits);
  });

  it("answers 503 when the webhook secret isn't configured (Creem retries later)", async () => {
    const body = JSON.stringify({ id: "evt_nosecret", eventType: "x", created_at: 1, object: {} });
    const headers = new Headers({ [SIGNATURE_HEADER]: signWebhook(SECRET, body) });
    expect((await handleCreemWebhook(body, headers, { secret: "" })).status).toBe(503);
  });
});
