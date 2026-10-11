import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { PLANS } from "@voidaccess/config";
import { creditLedger, getDatabase, users } from "@voidaccess/db";
import { getLogTransport, getTransport } from "@voidaccess/emails";
import { getAuth } from "@/lib/auth/auth";
import { parseAttribution } from "@/lib/auth/attribution";

const headers = new Headers({ origin: "http://localhost:3000" });
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
  it("sign-up creates a free user, grants the free credits exactly once, sends a verification email, and verification works", async () => {
    getTransport(); // initialise the log transport
    const email = `ada-${Date.now()}@test.local`;
    const res = await getAuth().api.signUpEmail({ body: { name: "Ada", email, password: "correct-horse-battery" }, headers });
    const id = res.user.id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    // after-create hook: free plan, one grant row, referral code
    const rows = await until(async () => {
      const r = await getDatabase().withSystem("test.read", (tx) => tx.select().from(creditLedger).where(eq(creditLedger.userId, id)), { audit: false });
      return r.length ? r : undefined;
    });
    expect(rows.filter((r) => r.reason === "grant")).toHaveLength(1);
    expect(rows[0]!.amount).toBe(PLANS.free.monthlyCredits);
    const [u] = await getDatabase().withSystem("test.read", (tx) => tx.select().from(users).where(eq(users.id, id)), { audit: false });
    expect(u).toMatchObject({ plan: "free", status: "active", role: "user", emailVerified: false, aupAcceptedAt: null });
    expect(u!.referralCode).toMatch(/^[0-9a-f]{10}$/);

    // unverified users cannot sign in
    await expect(getAuth().api.signInEmail({ body: { email, password: "correct-horse-battery" }, headers })).rejects.toThrow();

    // verification email went through the log transport; following the link verifies the account
    const mail = await until(async () => getLogTransport()?.outbox.find((m) => m.to === email && m.template === "verifyEmail"));
    const token = new URL(mail.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
    await getAuth().api.verifyEmail({ query: { token }, headers });
    const [v] = await getDatabase().withSystem("test.read", (tx) => tx.select().from(users).where(eq(users.id, id)), { audit: false });
    expect(v!.emailVerified).toBe(true);
    const signedIn = await getAuth().api.signInEmail({ body: { email, password: "correct-horse-battery" }, headers });
    expect(signedIn.user.id).toBe(id);
  });

  it("clients cannot set plan, role or status at sign-up", async () => {
    const email = `evil-${Date.now()}@test.local`;
    const res = await getAuth().api.signUpEmail({
      body: { name: "Eve", email, password: "correct-horse-battery", plan: "pro_plus", role: "admin", status: "active" } as never,
      headers,
    });
    const [u] = await getDatabase().withSystem("test.read", (tx) => tx.select().from(users).where(eq(users.id, res.user.id)), { audit: false });
    expect(u).toMatchObject({ plan: "free", role: "user" });
  });
});

describe("attribution parser", () => {
  it("reads the va_ft cookie (plain or URL-encoded JSON) and falls back to query params", () => {
    const j = JSON.stringify({ utm_source: "hn", utm_campaign: "launch", ref: "abc", landing: "/pricing", at: "2026-10-12T00:00:00Z" });
    expect(parseAttribution({ cookie: j })).toEqual({ utm: { utm_source: "hn", utm_campaign: "launch" }, ref: "abc", landing: "/pricing", at: "2026-10-12T00:00:00Z" });
    expect(parseAttribution({ cookie: encodeURIComponent(j) })?.ref).toBe("abc");
    expect(parseAttribution({ cookie: "{bad", query: new URLSearchParams("utm_source=x&ref=r") })).toMatchObject({ utm: { utm_source: "x" }, ref: "r" });
    expect(parseAttribution({ cookie: null, query: null })).toBeNull();
    expect(parseAttribution({ cookie: JSON.stringify({ utm: { source: "s" } }) })?.utm).toEqual({ utm_source: "s" });
  });
});
