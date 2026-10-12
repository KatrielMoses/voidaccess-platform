import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { APIError } from "better-auth/api";
import { PLANS } from "@voidaccess/config";
import { creditLedger, users } from "@voidaccess/db/schema";
import { bootstrapAccount } from "@/lib/auth/bootstrap";
import { getAuth } from "@/lib/auth/auth";
import { startInvestigation } from "@/lib/runs/service";
import { db, makeUser, balanceOf } from "./helpers";

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

let n = 0;
const ip = () => `10.1.${Math.floor(++n / 250)}.${n % 250}`;
const SITE_ORIGIN = "http://va.localhost:3700"; // a trusted origin outside production

/** The request the site's sign-up form makes: POST /api/auth/sign-up/email from the site origin. */
async function signUp(body: Record<string, unknown>, origin = SITE_ORIGIN, cookie?: string) {
  const res = await getAuth().handler(
    new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        "x-forwarded-for": ip(),
        ...(cookie ? { cookie } : {}),
      }, // fresh IP: the rate limiter is per IP
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json().catch(() => null)) as { message?: string } | null };
}

describe("sign-up", () => {
  it("requires the AUP checkbox: no user is created without it", async () => {
    const email = `noaup-${Date.now()}@test.local`;
    const r = await signUp({ name: "No Aup", email, password: "a long password" });
    expect(r.status).toBe(400);
    expect(r.json?.message).toMatch(/Acceptable Use/);
    for (const aupAccepted of [false, "true", "on", 1, null]) {
      const x = await signUp({ name: "No Aup", email, password: "a long password", aupAccepted });
      expect(x.status).toBe(400);
    }
    expect(await userByEmail(email)).toHaveLength(0);
  });

  it("rejects a credentialed sign-up from an untrusted origin", async () => {
    const email = `evil-${Date.now()}@test.local`;
    const r = await signUp(
      { name: "Evil", email, password: "a long password", aupAccepted: true },
      "https://evil.example",
      "better-auth.session_token=x",
    );
    expect(r.status).toBe(403); // origin checks guard requests that carry ambient credentials
    expect(await userByEmail(email)).toHaveLength(0);
  });

  it("stores the consented first-touch with the sign-up, and ignores junk", async () => {
    const email = `ft-${Date.now()}@test.local`;
    const firstTouch = {
      utm: { utm_source: "hn" },
      ref: "news.ycombinator.com",
      landing: "/",
      at: "2026-10-12T00:00:00Z",
    };
    const r = await signUp({ name: "Ft", email, password: "a long password", aupAccepted: true, firstTouch });
    expect(r.status).toBe(200);
    const [u] = await userByEmail(email);
    expect(u?.firstTouch).toMatchObject({ utm: { utm_source: "hn" }, ref: "news.ycombinator.com" });
    const email2 = `ft2-${Date.now()}@test.local`;
    expect(
      (
        await signUp({
          name: "Ft",
          email: email2,
          password: "a long password",
          aupAccepted: true,
          firstTouch: "x",
        })
      ).status,
    ).toBe(200);
    expect((await userByEmail(email2))[0]?.firstTouch).toBeNull();
  });

  it("stores the AUP timestamp and grants the free credits exactly once", async () => {
    const email = `signup-${Date.now()}@test.local`;
    const r = await signUp({ name: "Sign Up", email, password: "a long password", aupAccepted: true });
    expect(r.status).toBe(200);
    const [u] = await userByEmail(email);
    expect(u?.aupAcceptedAt).toBeInstanceOf(Date);
    expect(u?.emailVerified).toBe(false);
    expect(u?.plan).toBe("free");
    expect(u?.referralCode).toBeTruthy();

    // the create hook and the bootstrap both ran; calling bootstrap again must not grant again
    await bootstrapAccount(u!.id);
    await bootstrapAccount(u!.id);
    const rows = await grants(u!.id);
    expect(rows.filter((x) => x.reason === "grant")).toHaveLength(1);
    expect(await balanceOf(u!.id)).toBe(PLANS.free.monthlyCredits);
  });

  it("bootstrap alone (hook missed) grants once, then is a no-op", async () => {
    const u = await makeUser({ credits: 0, plan: "free" });
    await bootstrapAccount(u.id);
    await bootstrapAccount(u.id);
    const rows = (await grants(u.id)).filter((x) => x.reason === "grant");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBe(PLANS.free.monthlyCredits);
  });

  it("unverified users cannot sign in and cannot start a run", async () => {
    const email = `unv-${Date.now()}@test.local`;
    await signUp({ name: "Unv", email, password: "a long password", aupAccepted: true });
    await expect(
      getAuth().api.signInEmail({ body: { email, password: "a long password" } }),
    ).rejects.toBeInstanceOf(APIError);

    const unverified = await makeUser({ emailVerified: false, credits: 100 });
    const before = await balanceOf(unverified.id);
    await expect(startInvestigation(unverified, { query: "lockbit", depth: "quick" })).rejects.toMatchObject({
      code: "unverified_email",
    });
    expect(await balanceOf(unverified.id)).toBe(before);
  });
});
