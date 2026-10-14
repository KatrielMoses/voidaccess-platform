import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { PLANS } from "@voidaccess/config";
import { creditLedger, getDatabase, users } from "@voidaccess/db";
import { getLogTransport, getTransport } from "@voidaccess/emails";
import { signInWithCode } from "./auth-helpers";
import { parseAttribution } from "@/lib/auth/attribution";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(fn: () => Promise<T | undefined | false>, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timeout");
    await wait(50);
  }
}

describe("Better Auth wiring", () => {
  it("the first email-code sign-in creates a verified free user with one grant and a referral code", async () => {
    getTransport(); // initialise the log transport
    const email = `ada-${Date.now()}@test.local`;
    const res = await signInWithCode(email);
    expect(res.status).toBe(200);
    const id = res.json!.user!.id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const rows = await until(async () => {
      const r = await getDatabase().withSystem(
        "test.read",
        (tx) => tx.select().from(creditLedger).where(eq(creditLedger.userId, id)),
        { audit: false },
      );
      return r.length ? r : undefined;
    });
    expect(rows.filter((r) => r.reason === "grant")).toHaveLength(1);
    expect(rows[0]!.amount).toBe(PLANS.free.monthlyCredits);
    const [u] = await getDatabase().withSystem(
      "test.read",
      (tx) => tx.select().from(users).where(eq(users.id, id)),
      { audit: false },
    );
    expect(u).toMatchObject({ plan: "free", status: "active", role: "user", emailVerified: true });
    expect(u!.referralCode).toMatch(/^[0-9a-f]{10}$/);
    // the code email went through the log transport
    expect(getLogTransport()?.outbox.some((m) => m.to === email && m.template === "signInCode")).toBe(true);
  });

  it("clients cannot set plan, role or status when the first sign-in creates the account", async () => {
    const email = `evil-${Date.now()}@test.local`;
    const res = await signInWithCode(email, {
      plan: "pro_plus",
      role: "admin",
      status: "banned",
      name: "Eve",
    });
    expect(res.status).toBe(200);
    const [u] = await getDatabase().withSystem(
      "test.read",
      (tx) => tx.select().from(users).where(eq(users.id, res.json!.user!.id)),
      { audit: false },
    );
    expect(u).toMatchObject({ plan: "free", role: "user", status: "active" });
  });
});

describe("attribution parser", () => {
  it("reads the va_ft cookie (plain or URL-encoded JSON) and falls back to query params", () => {
    const j = JSON.stringify({
      utm_source: "hn",
      utm_campaign: "launch",
      ref: "abc",
      landing: "/pricing",
      at: "2026-10-12T00:00:00Z",
    });
    expect(parseAttribution({ cookie: j })).toEqual({
      utm: { utm_source: "hn", utm_campaign: "launch" },
      ref: "abc",
      landing: "/pricing",
      at: "2026-10-12T00:00:00Z",
    });
    expect(parseAttribution({ cookie: encodeURIComponent(j) })?.ref).toBe("abc");
    expect(
      parseAttribution({ cookie: "{bad", query: new URLSearchParams("utm_source=x&ref=r") }),
    ).toMatchObject({ utm: { utm_source: "x" }, ref: "r" });
    expect(parseAttribution({ cookie: null, query: null })).toBeNull();
    expect(parseAttribution({ cookie: JSON.stringify({ utm: { source: "s" } }) })?.utm).toEqual({
      utm_source: "s",
    });
  });
});
