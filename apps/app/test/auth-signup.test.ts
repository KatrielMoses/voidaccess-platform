import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { APIError } from "better-auth/api";
import { PLANS } from "@voidaccess/config";
import { creditLedger, users } from "@voidaccess/db/schema";
import { signUpAction } from "@/lib/auth/actions";
import { bootstrapAccount } from "@/lib/auth/bootstrap";
import { getAuth } from "@/lib/auth/auth";
import { startInvestigation } from "@/lib/runs/service";
import { db, makeUser, balanceOf } from "./helpers";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
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

async function signUp(f: FormData) {
  try {
    return await signUpAction({}, f);
  } catch (e) {
    return { redirect: (e as { digest?: string; message?: string }).digest ?? (e as Error).message };
  }
}

describe("sign-up", () => {
  it("requires the AUP checkbox: no user is created without it", async () => {
    const email = `noaup-${Date.now()}@test.local`;
    const r = await signUp(form({ name: "No Aup", email, password: "a long password" }));
    expect(r).toMatchObject({ error: expect.stringMatching(/Acceptable Use/) });
    expect(await userByEmail(email)).toHaveLength(0);
  });

  it("stores the AUP timestamp and grants the free credits exactly once", async () => {
    const email = `signup-${Date.now()}@test.local`;
    const r = await signUp(form({ name: "Sign Up", email, password: "a long password", aup: "on" }));
    expect(JSON.stringify(r)).toContain("/check-email");
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
    await signUp(form({ name: "Unv", email, password: "a long password", aup: "on" }));
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
