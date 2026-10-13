import { createHmac, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog, users } from "@voidaccess/db";
import { GET as unsubGET, POST as unsubPOST } from "@/app/api/unsubscribe/route";
import { GET as prefGET, PATCH as prefPATCH } from "@/app/api/account/notifications/route";
import { DELETE as starDELETE } from "@/app/api/account/star-prompt/route";
import {
  signUnsubscribe,
  unsubscribeOneClickUrl,
  unsubscribePageUrl,
  verifyUnsubscribe,
} from "@/lib/ops/unsubscribe";
import { starPromptVisible } from "@/lib/ops/star-prompt";
import { asUser, db, makeUser } from "./helpers";
import { SAME_ORIGIN, userRow } from "./admin-helpers";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const post = (url: string, body?: BodyInit, headers: Record<string, string> = {}) =>
  unsubPOST(new Request(url, { method: "POST", body, headers }));
const prefs = async (id: string) => (await userRow(id)).productEmails;

describe("unsubscribe signature", () => {
  it("verifies its own tokens and rejects every other id, token or shape", () => {
    const a = randomUUID();
    const b = randomUUID();
    const ta = signUnsubscribe(a);
    expect(verifyUnsubscribe(a, ta)).toBe(true);
    expect(verifyUnsubscribe(a.toUpperCase(), ta)).toBe(true); // same user, id case doesn't matter
    expect(verifyUnsubscribe(b, ta)).toBe(false); // someone else's id with my token
    expect(verifyUnsubscribe(a, signUnsubscribe(b))).toBe(false);
    for (const t of [
      "",
      ta.slice(0, -1),
      ta + "x",
      ta.replace(/.$/, ta.endsWith("A") ? "B" : "A"),
      "AAAA",
      ta.toUpperCase() === ta ? ta.toLowerCase() : ta.toUpperCase(),
    ])
      expect(verifyUnsubscribe(a, t), t).toBe(false);
    for (const id of ["", "not-a-uuid", `${a}'; drop table users;--`, "../" + a])
      expect(verifyUnsubscribe(id, ta)).toBe(false);
    expect(verifyUnsubscribe(a, undefined as never)).toBe(false);
  });

  it("is keyed by a value derived from the app secret, not by the secret itself, and changes with the secret", () => {
    const id = randomUUID();
    const secret = process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-dev-only-secret-dev-only-secret";
    const direct = createHmac("sha256", secret).update(id).digest("base64url");
    expect(signUnsubscribe(id)).not.toBe(direct);
    const derivedKey = createHmac("sha256", secret).update("voidaccess:unsubscribe:v1").digest();
    expect(signUnsubscribe(id)).toBe(createHmac("sha256", derivedKey).update(id).digest("base64url"));
    const prev = process.env.BETTER_AUTH_SECRET;
    process.env.BETTER_AUTH_SECRET = "a-completely-different-secret-value-0123456789";
    try {
      expect(signUnsubscribe(id)).not.toBe(
        derivedKey && createHmac("sha256", derivedKey).update(id).digest("base64url"),
      );
    } finally {
      if (prev === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = prev;
    }
  });

  it("the links carry the user id and its signature on the app origin", () => {
    const id = randomUUID();
    expect(unsubscribePageUrl(id)).toBe(`http://localhost:3000/unsubscribe?u=${id}&t=${signUnsubscribe(id)}`);
    expect(unsubscribeOneClickUrl(id)).toBe(
      `http://localhost:3000/api/unsubscribe?u=${id}&t=${signUnsubscribe(id)}`,
    );
  });
});

describe("one-click unsubscribe endpoint (no sign-in)", () => {
  it("a valid link switches off product email for that user only, and is audited", async () => {
    const me = await makeUser({ credits: 0 });
    const other = await makeUser({ credits: 0 });
    asUser(null); // not signed in
    const res = await post(unsubscribeOneClickUrl(me.id), "List-Unsubscribe=One-Click", {
      "content-type": "application/x-www-form-urlencoded",
    });
    expect(res.status).toBe(200);
    expect(await prefs(me.id)).toBe(false);
    expect(await prefs(other.id)).toBe(true);
    expect((await userRow(me.id)).productEmailsChangedAt).toBeInstanceOf(Date);
    const log = await db().withSystem(
      "t",
      (tx) =>
        tx
          .select()
          .from(auditLog)
          .where(eq(auditLog.actor, `unsubscribe:${me.id}`)),
      { audit: false },
    );
    expect(log.length).toBeGreaterThan(0);
    // idempotent
    expect((await post(unsubscribeOneClickUrl(me.id))).status).toBe(200);
  });

  it("someone else's id with a valid token, a tampered token, and missing params are rejected and change nothing", async () => {
    const victim = await makeUser({ credits: 0 });
    const attacker = await makeUser({ credits: 0 });
    const base = "http://localhost:3000/api/unsubscribe";
    for (const url of [
      `${base}?u=${victim.id}&t=${signUnsubscribe(attacker.id)}`, // wrong user's signature
      `${base}?u=${victim.id}&t=${signUnsubscribe(victim.id)}x`, // tampered
      `${base}?u=${victim.id}`,
      `${base}?t=${signUnsubscribe(victim.id)}`,
      `${base}?u=%27%3B--&t=abc`,
      base,
    ]) {
      const res = await post(url);
      expect(res.status, url).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_link" });
    }
    expect(await prefs(victim.id)).toBe(true);
    expect(await prefs(attacker.id)).toBe(true);
  });

  it("GET never unsubscribes (mail scanners prefetch links): it redirects to the confirmation page", async () => {
    const u = await makeUser({ credits: 0 });
    const res = await unsubGET(new Request(unsubscribeOneClickUrl(u.id)));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/unsubscribe");
    expect(await prefs(u.id)).toBe(true);
  });

  it("the confirmation page's form posts here with from=page and is sent back to the page", async () => {
    const u = await makeUser({ credits: 0 });
    const fd = new FormData();
    fd.set("from", "page");
    const res = await post(unsubscribeOneClickUrl(u.id), fd);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("done=1");
    expect(await prefs(u.id)).toBe(false);
  });
});

describe("notification preferences (signed in)", () => {
  const req = (method: string, body?: unknown, headers: Record<string, string> = SAME_ORIGIN) =>
    new Request("http://localhost:3000/api/account/notifications", {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it("reads and flips only the signed-in user's own preference; usage alerts are not a preference", async () => {
    const u = await makeUser({ credits: 0 });
    const other = await makeUser({ credits: 0 });
    asUser(u);
    expect(await (await prefGET()).json()).toEqual({ productEmails: true });
    expect(await (await prefPATCH(req("PATCH", { productEmails: false }))).json()).toEqual({
      productEmails: false,
    });
    expect(await prefs(u.id)).toBe(false);
    expect(await prefs(other.id)).toBe(true);
    // an attempt to also switch off usage alerts (or anything unknown) is refused
    for (const body of [
      { productEmails: true, usageAlerts: false },
      { usageAlerts: false },
      { productEmails: "no" },
      {},
      null,
    ])
      expect((await prefPATCH(req("PATCH", body))).status, JSON.stringify(body)).toBe(400);
    expect(await prefs(u.id)).toBe(false);
    // cross-site and signed-out requests are refused
    expect(
      (
        await prefPATCH(
          req(
            "PATCH",
            { productEmails: true },
            { "sec-fetch-site": "cross-site", "content-type": "application/json" },
          ),
        )
      ).status,
    ).toBe(403);
    asUser(null);
    expect((await prefPATCH(req("PATCH", { productEmails: true }))).status).toBe(401);
    expect((await prefGET()).status).toBe(401);
    expect(await prefs(u.id)).toBe(false);
    asUser(null);
  });
});

describe("the GitHub star prompt is remembered per user", () => {
  it("shows until dismissed, then never again, for that user only", async () => {
    const u = await makeUser({ credits: 0 });
    const other = await makeUser({ credits: 0 });
    expect(await starPromptVisible(u.id)).toBe(true);
    asUser(u);
    const ok = await starDELETE(
      new Request("http://localhost:3000/api/account/star-prompt", {
        method: "DELETE",
        headers: SAME_ORIGIN,
      }),
    );
    expect(ok.status).toBe(200);
    expect(await starPromptVisible(u.id)).toBe(false);
    expect(await starPromptVisible(other.id)).toBe(true);
    const [row] = await db().withSystem(
      "t",
      (tx) => tx.select({ at: users.starPromptDismissedAt }).from(users).where(eq(users.id, u.id)),
      { audit: false },
    );
    expect(row!.at).toBeInstanceOf(Date);
    expect(
      (
        await starDELETE(
          new Request("http://localhost:3000/api/account/star-prompt", {
            method: "DELETE",
            headers: { "sec-fetch-site": "cross-site" },
          }),
        )
      ).status,
    ).toBe(403);
    asUser(null);
  });
});
