import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { blockedEmailDomains, users, verifications } from "@voidaccess/db/schema";
import { getAuth } from "@/lib/auth/auth";
import { SIGN_UP_REFUSED_MESSAGE, emailDomainCandidates } from "@/lib/auth/blocked-domains";
import { db } from "./helpers";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));
const sent = vi.hoisted(() => [] as { template: string; to: string }[]);
vi.mock("@voidaccess/emails", async (orig) => ({
  ...(await orig<typeof import("@voidaccess/emails")>()),
  sendEmail: vi.fn(async (template: string, to: string) => void sent.push({ template, to })),
}));

const SITE_ORIGIN = "http://va.localhost:3700";
const tag = randomUUID().slice(0, 8);
const BLOCKED = `blocked-${tag}.example`;
let n = 0;
const ip = () => `10.88.${Math.floor(++n / 250)}.${n % 250}`; // fresh IP per call: the limiter is per IP

const post = (path: string, body: Record<string, unknown>) =>
  getAuth().handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: SITE_ORIGIN, "x-forwarded-for": ip() },
      body: JSON.stringify(body),
    }),
  );
const signUp = async (email: string) => {
  const res = await post("/sign-up/email", {
    name: "B",
    email,
    password: "a long password",
    aupAccepted: true,
  });
  return { status: res.status, body: await res.text() };
};
const userByEmail = (email: string) =>
  db().withSystem("test.user", (tx) => tx.select().from(users).where(eq(users.email, email)), {
    audit: false,
  });

beforeAll(async () => {
  await db().withSystem("test.block", (tx) =>
    tx.insert(blockedEmailDomains).values({ domain: BLOCKED, reason: "test", createdBy: null }),
  );
});
afterAll(async () => {
  await db().withSystem("test.unblock", (tx) =>
    tx.delete(blockedEmailDomains).where(eq(blockedEmailDomains.domain, BLOCKED)),
  );
});

describe("H1-3: blocked e-mail domains", () => {
  it("candidates: the domain and every parent, lower-cased, no trailing dot, IDN as punycode", () => {
    expect(emailDomainCandidates("A@Mail.Example.COM.")).toEqual(["mail.example.com", "example.com", "com"]);
    expect(emailDomainCandidates("x@bücher.example")).toEqual(["xn--bcher-kva.example", "example"]);
    expect(emailDomainCandidates("no-at-sign")).toEqual([]);
    expect(emailDomainCandidates("a@")).toEqual([]);
  });

  it("email sign-up from a blocked domain, or any subdomain of it, gets one generic error and creates nothing", async () => {
    const emails = [
      `a-${tag}@${BLOCKED}`,
      `b-${tag}@mail.${BLOCKED}`,
      `c-${tag}@EU.Deep.${BLOCKED.toUpperCase()}`,
    ];
    const results = [];
    for (const e of emails) results.push(await signUp(e));
    for (const r of results) {
      expect(r.status).toBe(400);
      expect(JSON.parse(r.body).message).toBe(SIGN_UP_REFUSED_MESSAGE);
    }
    expect(new Set(results.map((r) => r.body)).size).toBe(1); // identical bodies: no hint which rule matched
    for (const e of emails) expect(await userByEmail(e.toLowerCase())).toHaveLength(0);
  });

  it("lookalike domains are not blocked (it is a domain-boundary match, not a suffix match)", async () => {
    const ok = await signUp(`ok-${tag}@not-${BLOCKED}`); // "not-blocked-xxxx.example" is a different domain
    expect(ok.status).toBe(200);
    const ok2 = await signUp(`ok2-${tag}@x${BLOCKED}`);
    expect(ok2.status).toBe(200);
    const ok3 = await signUp(`ok3-${tag}@fine-${tag}.example`);
    expect(ok3.status).toBe(200);
  });

  it("magic-link sign-up: a new address on a blocked domain gets the same generic error; nothing is stored or sent", async () => {
    sent.length = 0;
    const email = `ml-${tag}@sub.${BLOCKED}`;
    const res = await post("/sign-in/magic-link", { email });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toBe(SIGN_UP_REFUSED_MESSAGE);
    expect(sent).toEqual([]);
    const rows = await db().withSystem("test.v", (tx) => tx.select().from(verifications), { audit: false });
    expect(rows.some((v) => v.identifier.includes(email))).toBe(false);
  });

  it("magic link for an unblocked new address still works, and an existing account on a since-blocked domain can still sign in", async () => {
    sent.length = 0;
    const fine = await post("/sign-in/magic-link", { email: `ml-ok-${tag}@fine-${tag}.example` });
    expect(fine.status).toBe(200);
    expect(sent.map((e) => e.template)).toEqual(["magicLink"]);

    const existing = `old-${tag}@${BLOCKED}`;
    await db().withSystem("test.old", (tx) =>
      tx.insert(users).values({ id: randomUUID(), name: "Old", email: existing, emailVerified: true }),
    );
    sent.length = 0;
    const res = await post("/sign-in/magic-link", { email: existing });
    expect(res.status).toBe(200);
    expect(sent).toEqual([{ template: "magicLink", to: existing }]);
  });

  it("the user-creation hook is a last line of defence for every path (e.g. GitHub, magic-link verification)", async () => {
    const ctx = await getAuth().$context;
    const email = `hook-${tag}@${BLOCKED}`;
    await expect(
      ctx.internalAdapter.createUser({ email, name: "Hook", emailVerified: true }, undefined as never),
    ).rejects.toMatchObject({ message: SIGN_UP_REFUSED_MESSAGE });
    expect(await userByEmail(email)).toHaveLength(0);
  });
});
