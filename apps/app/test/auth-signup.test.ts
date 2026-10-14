// Passwordless sign-in: Google, Microsoft, GitHub, or a 6-digit email code. There is no separate sign-up; the first
// sign-in creates the account (email verified), every later one signs the same account back in.
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { PLANS } from "@voidaccess/config";
import { creditLedger, users } from "@voidaccess/db/schema";
import { bootstrapAccount } from "@/lib/auth/bootstrap";
import { startInvestigation } from "@/lib/runs/service";
import { authPost, lastSignInCode, requestCode, sessionCookie, signInWithCode } from "./auth-helpers";
import { balanceOf, db, makeUser } from "./helpers";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const userByEmail = (email: string) =>
  db().withSystem("test.user", (tx) => tx.select().from(users).where(eq(users.email, email)), {
    audit: false,
  });
const grants = (userId: string) =>
  db().withSystem(
    "test.grants",
    (tx) => tx.select().from(creditLedger).where(eq(creditLedger.userId, userId)),
    { audit: false },
  );
const unique = (tag: string) => `${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;

describe("sign-in with an email code", () => {
  it("the first sign-in creates a verified free account with the free credits, exactly once", async () => {
    const email = unique("first");
    const r = await signInWithCode(email);
    expect(r.status).toBe(200);
    expect(sessionCookie(r)).toMatch(/better-auth\.session_token=/);
    const [u] = await userByEmail(email);
    expect(u?.emailVerified).toBe(true); // the code proves the address
    expect(u?.plan).toBe("free");
    expect(u?.referralCode).toBeTruthy();
    expect(u?.aupAcceptedAt).toBeNull(); // accepted on /accept-terms, enforced server-side at run creation

    // bootstrap may run again later; the grant still happens once
    await bootstrapAccount(u!.id);
    expect((await grants(u!.id)).filter((x) => x.reason === "grant")).toHaveLength(1);
    expect(await balanceOf(u!.id)).toBe(PLANS.free.monthlyCredits);
  });

  it("a later sign-in returns to the same account: no new user, no second grant", async () => {
    const email = unique("again");
    const first = await signInWithCode(email);
    const second = await signInWithCode(email);
    expect(second.status).toBe(200);
    expect(second.json?.user?.id).toBe(first.json?.user?.id);
    expect(await userByEmail(email)).toHaveLength(1);
    expect((await grants(first.json!.user!.id)).filter((x) => x.reason === "grant")).toHaveLength(1);
  });

  it("is case-insensitive on the address", async () => {
    const lower = unique("case");
    const first = await signInWithCode(lower);
    const second = await signInWithCode(lower.toUpperCase());
    expect(second.json?.user?.id).toBe(first.json?.user?.id);
  });

  it("a wrong code fails, and five wrong attempts burn the code", async () => {
    const email = unique("wrong");
    expect((await requestCode(email)).status).toBe(200);
    const otp = lastSignInCode(email)!;
    const wrong = otp === "000000" ? "111111" : "000000";
    expect((await authPost("/sign-in/email-otp", { email, otp: wrong })).status).toBe(400);
    for (let i = 0; i < 4; i++) await authPost("/sign-in/email-otp", { email, otp: wrong });
    // after the allowed attempts the real code no longer works either
    expect((await authPost("/sign-in/email-otp", { email, otp })).status).not.toBe(200);
    expect(await userByEmail(email)).toHaveLength(0);
  });

  it("only sign-in codes can be requested (no password reset, no email change)", async () => {
    const email = unique("type");
    for (const type of ["forget-password", "email-verification", "change-email"]) {
      const r = await authPost("/email-otp/send-verification-otp", { email, type });
      expect(r.status, type).toBe(400);
    }
    expect(lastSignInCode(email)).toBeUndefined();
  });

  it("password and magic-link sign-in are refused and create nothing", async () => {
    const email = unique("gone");
    for (const [path, body] of [
      ["/sign-up/email", { name: "X", email, password: "a long password" }],
      ["/sign-in/email", { email, password: "a long password" }],
      ["/sign-in/magic-link", { email }],
      ["/request-password-reset", { email }],
    ] as const) {
      const r = await authPost(path, body);
      expect([400, 404], path).toContain(r.status); // disabled (400) or not mounted (404), never a session
    }
    expect(await userByEmail(email)).toHaveLength(0);
  });

  it("rejects a credentialed request from an untrusted origin", async () => {
    const email = unique("evil");
    const r = await requestCode(email, {
      origin: "https://evil.example",
      cookie: "better-auth.session_token=x",
    });
    expect(r.status).toBe(403); // origin checks guard requests that carry ambient credentials
    expect(lastSignInCode(email)).toBeUndefined();
  });

  it("stores the consented first-touch sent with the first sign-in, and ignores junk", async () => {
    const email = unique("ft");
    const firstTouch = {
      utm: { utm_source: "hn" },
      ref: "news.ycombinator.com",
      landing: "/",
      at: "2026-10-12T00:00:00Z",
    };
    expect((await signInWithCode(email, { firstTouch })).status).toBe(200);
    expect((await userByEmail(email))[0]?.firstTouch).toMatchObject({
      utm: { utm_source: "hn" },
      ref: "news.ycombinator.com",
    });
    const email2 = unique("ft2");
    expect((await signInWithCode(email2, { firstTouch: "x" })).status).toBe(200);
    expect((await userByEmail(email2))[0]?.firstTouch).toBeNull();
  });

  it("bootstrap alone (hook missed) grants once, then is a no-op", async () => {
    const u = await makeUser({ credits: 0, plan: "free" });
    await bootstrapAccount(u.id);
    await bootstrapAccount(u.id);
    const rows = (await grants(u.id)).filter((x) => x.reason === "grant");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe(PLANS.free.monthlyCredits);
  });

  it("no run starts before the Acceptable Use Policy is accepted, or with an unverified email", async () => {
    const noAup = await makeUser({ credits: 100, aupAccepted: false });
    await expect(startInvestigation(noAup, { query: "lockbit", depth: "quick" })).rejects.toMatchObject({
      code: "aup_required",
    });
    expect(await balanceOf(noAup.id)).toBe(100);

    const unverified = await makeUser({ emailVerified: false, credits: 100 });
    await expect(startInvestigation(unverified, { query: "lockbit", depth: "quick" })).rejects.toMatchObject({
      code: "unverified_email",
    });
    expect(await balanceOf(unverified.id)).toBe(100);
  });
});
