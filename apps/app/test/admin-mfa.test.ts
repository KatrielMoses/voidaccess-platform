import { renderToStaticMarkup } from "react-dom/server";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditLog, credentialVault, OPAQUE_MASK } from "@voidaccess/db";
import {
  base32Decode,
  base32Encode,
  groupSecret,
  hotp,
  matchTotp,
  newTotpSecret,
  otpauthUri,
  stepAt,
  totpAt,
} from "@/lib/admin/totp";
import { sessionHash, signStepUp, STEP_UP_COOKIE, STEP_UP_SECONDS, verifyStepUp } from "@/lib/admin/stepup";
import {
  isEnrolled,
  MFA_MAX_FAILS,
  pendingEnrolment,
  TOTP_KIND,
  TOTP_PENDING_KIND,
  verifyAdminCode,
} from "@/lib/admin/mfa";
import { resetAdminMfa } from "@/lib/admin/mfa-reset";
import { safeAdminNext } from "@/lib/admin/path";
import { asUser, db } from "./helpers";
import { audits, makeAdmin, SAME_ORIGIN } from "./admin-helpers";
import { clearCookies, makeOwner, setCookie, stepUp, TEST_BASE } from "./admin-owner";
import { ownerUrl } from "./urls";

vi.mock("next/headers", async () => (await import("./admin-owner")).nextHeadersMock);

const sys = <T>(fn: Parameters<ReturnType<typeof db>["withSystem"]>[1]) =>
  db().withSystem("t", fn as never, { audit: false }) as Promise<T>;
const vaultRows = (userId: string) =>
  sys<Array<typeof credentialVault.$inferSelect>>((tx) =>
    tx.select().from(credentialVault).where(eq(credentialVault.userId, userId)),
  );
const userAudits = (userId: string) =>
  sys<Array<typeof auditLog.$inferSelect>>((tx) =>
    tx.select().from(auditLog).where(eq(auditLog.actor, userId)),
  );

afterEach(() => {
  clearCookies();
  asUser(null);
});

describe("TOTP (RFC 4226 / RFC 6238, node:crypto only)", () => {
  it("matches the RFC 4226 HOTP test vectors", () => {
    const key = Buffer.from("12345678901234567890");
    const want = [
      "755224",
      "287082",
      "359152",
      "969429",
      "338314",
      "254676",
      "287922",
      "162583",
      "399871",
      "520489",
    ];
    want.forEach((c, i) => expect(hotp(key, i)).toBe(c));
  });

  it("matches the RFC 6238 TOTP test vectors (8 digits; SHA-1, SHA-256, SHA-512)", () => {
    const keys = {
      sha1: Buffer.from("12345678901234567890"),
      sha256: Buffer.from("12345678901234567890123456789012"),
      sha512: Buffer.from("1234567890".repeat(6) + "1234"),
    } as const;
    const table: Array<[number, string, string, string]> = [
      [59, "94287082", "46119246", "90693936"],
      [1111111109, "07081804", "68084774", "25091201"],
      [1111111111, "14050471", "67062674", "99943326"],
      [1234567890, "89005924", "91819424", "93441116"],
      [2000000000, "69279037", "90698825", "38618901"],
      [20000000000, "65353130", "77737706", "47863826"],
    ];
    for (const [t, s1, s256, s512] of table) {
      const step = stepAt(t * 1000);
      expect(hotp(keys.sha1, step, 8, "sha1"), `sha1 ${t}`).toBe(s1);
      expect(hotp(keys.sha256, step, 8, "sha256"), `sha256 ${t}`).toBe(s256);
      expect(hotp(keys.sha512, step, 8, "sha512"), `sha512 ${t}`).toBe(s512);
    }
    // the 6-digit form an authenticator shows is the low 6 digits
    const b32 = base32Encode(keys.sha1);
    expect(totpAt(b32, 59_000)).toBe("287082");
  });

  it("base32 round-trips and decodes the classic example; new secrets are 20 random bytes", () => {
    expect(base32Decode("JBSWY3DPEHPK3PXP").toString("latin1")).toBe("Hello!\xde\xad\xbe\xef");
    expect(base32Encode(Buffer.from("Hello!\xde\xad\xbe\xef", "latin1"))).toBe("JBSWY3DPEHPK3PXP");
    const s = newTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(s)).toHaveLength(20);
    expect(newTotpSecret()).not.toBe(s);
    expect(groupSecret("ABCDEFGHIJKL")).toBe("ABCD EFGH IJKL");
    const uri = new URL(otpauthUri(s, "owner@example.com"));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.host).toBe("totp");
    expect(decodeURIComponent(uri.pathname)).toBe("/VoidAccess:owner@example.com");
    expect(uri.searchParams.get("secret")).toBe(s);
    expect(uri.searchParams.get("issuer")).toBe("VoidAccess");
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(uri.searchParams.get("period")).toBe("30");
    expect(uri.searchParams.get("algorithm")).toBe("SHA1");
  });

  it("accepts the current step and one either side, nothing further; rejects junk", () => {
    const s = newTotpSecret();
    const now = 1_800_000_000_000;
    const step = stepAt(now);
    expect(matchTotp(s, totpAt(s, now), now)).toBe(step);
    expect(matchTotp(s, totpAt(s, now - 30_000), now)).toBe(step - 1);
    expect(matchTotp(s, totpAt(s, now + 30_000), now)).toBe(step + 1);
    const far = [totpAt(s, now - 60_000), totpAt(s, now + 60_000)];
    for (const c of far)
      if (![-1, 0, 1].some((d) => totpAt(s, now + d * 30_000) === c)) expect(matchTotp(s, c, now)).toBeNull();
    for (const junk of ["", "12345", "1234567", "abcdef", "12 34 5x"])
      expect(matchTotp(s, junk, now)).toBeNull();
    expect(matchTotp(s, ` ${totpAt(s, now).slice(0, 3)} ${totpAt(s, now).slice(3)} `, now)).toBe(step);
  });

  it("refuses a step at or before the last accepted one (replay)", () => {
    const s = newTotpSecret();
    const now = 1_800_000_000_000;
    const step = stepAt(now);
    const code = totpAt(s, now);
    expect(matchTotp(s, code, now, step - 1)).toBe(step);
    expect(matchTotp(s, code, now, step)).toBeNull();
    expect(matchTotp(s, totpAt(s, now - 30_000), now, step - 1)).toBeNull();
  });
});

describe("step-up cookie", () => {
  const now = 1_800_000_000_000;
  it("is valid for exactly one hour for the same user and session", () => {
    const v = signStepUp("u1", "sess-1", now);
    expect(verifyStepUp(v, "u1", "sess-1", now)).toBe(true);
    expect(verifyStepUp(v, "u1", "sess-1", now + STEP_UP_SECONDS * 1000 - 1)).toBe(true);
    expect(verifyStepUp(v, "u1", "sess-1", now + STEP_UP_SECONDS * 1000)).toBe(false);
    expect(STEP_UP_SECONDS).toBe(3600);
  });

  it("rejects another session (sign-out/in), another user, a tampered value and a forged long validity", () => {
    const v = signStepUp("u1", "sess-1", now);
    expect(verifyStepUp(v, "u1", "sess-2", now)).toBe(false);
    expect(verifyStepUp(v, "u2", "sess-1", now)).toBe(false);
    const [payload, mac] = v.split(".");
    const flipped = mac!.slice(0, -1) + (mac!.endsWith("A") ? "B" : "A");
    expect(verifyStepUp(`${payload}.${flipped}`, "u1", "sess-1", now)).toBe(false);
    const forged = Buffer.from(
      JSON.stringify({ u: "u1", s: sessionHash("sess-1"), e: now + 10 * 3600_000 }),
    ).toString("base64url");
    expect(verifyStepUp(`${forged}.${mac}`, "u1", "sess-1", now)).toBe(false);
    for (const junk of ["", ".", "x.y", `${payload}`, `${payload}.`, "a".repeat(600)])
      expect(verifyStepUp(junk, "u1", "sess-1", now)).toBe(false);
    expect(v).not.toContain("sess-1");
  });

  it("is keyed from BETTER_AUTH_SECRET with its own label", () => {
    const v = signStepUp("u1", "sess-1", now);
    const saved = process.env.BETTER_AUTH_SECRET;
    process.env.BETTER_AUTH_SECRET = "another-secret-another-secret-another-secret";
    try {
      expect(verifyStepUp(v, "u1", "sess-1", now)).toBe(false);
    } finally {
      if (saved === undefined) delete process.env.BETTER_AUTH_SECRET;
      else process.env.BETTER_AUTH_SECRET = saved;
    }
  });
});

describe("the code screen's return address", () => {
  it("only returns inside the console", () => {
    expect(safeAdminNext(`${TEST_BASE}/users?q=a`, TEST_BASE)).toBe(`${TEST_BASE}/users?q=a`);
    expect(safeAdminNext(TEST_BASE, TEST_BASE)).toBe(TEST_BASE);
    for (const bad of [
      "https://evil.example/",
      "//evil.example",
      "/investigations",
      `${TEST_BASE}x/users`,
      `${TEST_BASE}/../api/x`,
      `${TEST_BASE}/%2e%2e/api`,
      `${TEST_BASE}\\x`,
      `${TEST_BASE}/unlock`,
      undefined,
      "",
    ])
      expect(safeAdminNext(bad, TEST_BASE), String(bad)).toBe(TEST_BASE);
  });
});

describe("enrolment and verification (vault storage, replay, rate limit, audit)", () => {
  it("enrols end to end: a pending secret in the vault, confirmed only by a correct code, never readable", async () => {
    const owner = await makeAdmin();
    expect(await isEnrolled(owner.id)).toBe(false);
    const p1 = await pendingEnrolment(owner.id);
    const p2 = await pendingEnrolment(owner.id);
    expect(p2.secret).toBe(p1.secret); // a reload shows the same QR
    expect(p1.expiresAt.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    let rows = await vaultRows(owner.id);
    expect(rows.map((r) => r.kind)).toEqual([TOTP_PENDING_KIND]);
    expect(rows[0]!.maskedValue).toBe(OPAQUE_MASK);

    const now = new Date();
    const wrong = totpAt(p1.secret, now.getTime() + 10 * 60_000);
    expect(await verifyAdminCode(owner.id, wrong, { now })).toEqual({ ok: false, error: "invalid_code" });
    expect(await isEnrolled(owner.id)).toBe(false);

    const code = totpAt(p1.secret, now.getTime());
    const ok = await verifyAdminCode(owner.id, code, { now });
    expect(ok).toMatchObject({ ok: true, enrolled: true, step: stepAt(now.getTime()) });
    expect(await isEnrolled(owner.id)).toBe(true);
    rows = await vaultRows(owner.id);
    expect(rows.map((r) => r.kind)).toEqual([TOTP_KIND]); // the pending row is gone
    expect(rows[0]!.maskedValue).toBe(OPAQUE_MASK);
    expect(JSON.stringify(rows)).not.toContain(p1.secret);

    // the same code again is a replay
    expect(await verifyAdminCode(owner.id, code, { now })).toEqual({ ok: false, error: "invalid_code" });
    // the next step's code works (verify, not enrol)
    const later = new Date(now.getTime() + 30_000);
    expect(await verifyAdminCode(owner.id, totpAt(p1.secret, later.getTime()), { now: later })).toMatchObject(
      {
        ok: true,
        enrolled: false,
      },
    );
    // ... and an earlier step is a replay even inside the window
    expect(await verifyAdminCode(owner.id, code, { now: later })).toEqual({
      ok: false,
      error: "invalid_code",
    });
    // enrolment can't be restarted from the app
    await expect(pendingEnrolment(owner.id)).rejects.toThrow(/already enrolled/);

    const a = await userAudits(owner.id);
    const actions = a.map((r) => r.action);
    expect(actions).toContain("admin.mfa.enrol_started");
    expect(actions).toContain("admin.mfa.enrolled");
    expect(actions.filter((x) => x === "admin.mfa.verified")).toHaveLength(2);
    expect(a.filter((r) => r.action === "admin.mfa.failed").map((r) => r.meta.reason)).toEqual(
      expect.arrayContaining(["wrong_code", "replay"]),
    );
    expect(a.find((r) => r.action === "admin.mfa.verified")!.meta).toHaveProperty("step");
    // every decrypt is audited
    expect(actions.filter((x) => x === "credential.decrypt").length).toBeGreaterThanOrEqual(3);
    // no code and no secret anywhere in the audit trail
    const dump = JSON.stringify(a);
    expect(dump).not.toContain(p1.secret);
    expect(dump).not.toContain(code);
    expect(dump).not.toContain(wrong);
  });

  it("a pending enrolment expires after 15 minutes and is replaced", async () => {
    const owner = await makeAdmin();
    const p = await pendingEnrolment(owner.id);
    await sys((tx) =>
      tx
        .update(credentialVault)
        .set({ createdAt: new Date(Date.now() - 16 * 60_000) })
        .where(and(eq(credentialVault.userId, owner.id), eq(credentialVault.kind, TOTP_PENDING_KIND))),
    );
    expect(await verifyAdminCode(owner.id, totpAt(p.secret, Date.now()))).toEqual({
      ok: false,
      error: "enrolment_expired",
    });
    expect(await isEnrolled(owner.id)).toBe(false);
    const fresh = await pendingEnrolment(owner.id);
    expect(fresh.secret).not.toBe(p.secret);
    expect((await vaultRows(owner.id)).filter((r) => r.kind === TOTP_PENDING_KIND)).toHaveLength(1);
  });

  it(`allows at most ${MFA_MAX_FAILS} wrong codes per 10 minutes, then refuses even a correct one`, async () => {
    const owner = await makeAdmin();
    const p = await pendingEnrolment(owner.id);
    const now = new Date();
    const wrong = totpAt(p.secret, now.getTime() + 3600_000);
    for (let i = 0; i < MFA_MAX_FAILS; i++)
      expect(await verifyAdminCode(owner.id, wrong, { now }), `attempt ${i + 1}`).toEqual({
        ok: false,
        error: "invalid_code",
      });
    expect(await verifyAdminCode(owner.id, totpAt(p.secret, now.getTime()), { now })).toEqual({
      ok: false,
      error: "too_many_attempts",
    });
    expect(await isEnrolled(owner.id)).toBe(false);
    const reasons = (await userAudits(owner.id))
      .filter((r) => r.action === "admin.mfa.failed")
      .map((r) => r.meta.reason);
    expect(reasons.filter((r) => r === "wrong_code")).toHaveLength(MFA_MAX_FAILS);
    expect(reasons).toContain("rate_limited");
  });

  it("a success clears the counter", async () => {
    const owner = await makeAdmin();
    const p = await pendingEnrolment(owner.id);
    const now = new Date();
    const wrong = totpAt(p.secret, now.getTime() + 3600_000);
    for (let i = 0; i < MFA_MAX_FAILS - 1; i++) await verifyAdminCode(owner.id, wrong, { now });
    expect((await verifyAdminCode(owner.id, totpAt(p.secret, now.getTime()), { now })).ok).toBe(true);
    for (let i = 0; i < MFA_MAX_FAILS - 1; i++)
      expect((await verifyAdminCode(owner.id, wrong, { now })).ok).toBe(false);
    const later = new Date(now.getTime() + 30_000);
    expect((await verifyAdminCode(owner.id, totpAt(p.secret, later.getTime()), { now: later })).ok).toBe(
      true,
    );
  });

  it("the ops reset (owner DB URL) removes the authenticator so the next visit enrols again, audited", async () => {
    const owner = await makeAdmin();
    const p = await pendingEnrolment(owner.id);
    expect((await verifyAdminCode(owner.id, totpAt(p.secret, Date.now()))).ok).toBe(true);
    expect(await isEnrolled(owner.id)).toBe(true);
    const r = await resetAdminMfa(ownerUrl, { email: owner.email, reason: "lost the phone", actor: "test" });
    expect(r).toEqual({ userId: owner.id, deleted: 1 });
    expect(await isEnrolled(owner.id)).toBe(false);
    expect(await audits("admin.mfa.reset", owner.id)).toHaveLength(1);
    const again = await pendingEnrolment(owner.id);
    expect(again.secret).not.toBe(p.secret);
  });
});

describe("the console's MFA screens and routes", () => {
  const cookieOf = (res: Response) => res.headers.get("set-cookie") ?? "";
  const verify = async (code: string, headers: Record<string, string> = SAME_ORIGIN) => {
    const { POST } = await import("@/app/api/admin/mfa/verify/route");
    return POST(
      new Request("http://localhost:3000/api/admin/mfa/verify", {
        method: "POST",
        headers,
        body: JSON.stringify({ code }),
      }),
    );
  };
  const render = async (next?: string) => {
    const mod = (await import("@/app/(admin)/admin/unlock/page")) as {
      default: (p: unknown) => Promise<React.ReactElement>;
    };
    return mod.default({ searchParams: Promise.resolve(next ? { next } : {}) });
  };

  it("first visit: the enrolment screen; the code confirms it and sets the one-hour step-up cookie; then the code screen", async () => {
    const owner = await makeOwner();
    asUser(owner);
    const html = renderToStaticMarkup(await render(`${TEST_BASE}/costs`));
    expect(html).toContain('data-testid="mfa-enrol-screen"');
    expect(html).toContain("<svg"); // the QR
    const { secret } = await pendingEnrolment(owner.id);
    expect(html).toContain(groupSecret(secret));
    expect(html).toContain(owner.email);
    expect(html).not.toContain('data-testid="stat-'); // nothing from the console

    expect((await verify("000000", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    const bad = await verify(totpAt(secret, Date.now() + 3600_000));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_code" });
    expect(cookieOf(bad)).toBe("");

    const res = await verify(totpAt(secret, Date.now()));
    expect(res.status).toBe(200);
    const c = cookieOf(res);
    expect(c).toContain(`${STEP_UP_COOKIE}=`);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/Secure/i);
    expect(c).toMatch(/SameSite=Strict/i);
    expect(c).toMatch(/Path=\//);
    expect(c).toMatch(/Max-Age=3600/);
    const value = /va_admin_stepup=([^;]+)/.exec(c)![1]!;
    expect(verifyStepUp(value, owner.id, `test-session-${owner.id}`)).toBe(true);

    // with the cookie the code screen sends the owner where they were going
    setCookie(STEP_UP_COOKIE, value);
    const e = await render(`${TEST_BASE}/costs`).then(
      () => null,
      (x: unknown) => x,
    );
    expect(String((e as { digest?: string }).digest)).toContain(`;${TEST_BASE}/costs;`);

    // locked again (Lock now), the code screen, not the enrolment
    const { POST: lock } = await import("@/app/api/admin/mfa/lock/route");
    const l = await lock(
      new Request("http://localhost:3000/api/admin/mfa/lock", { method: "POST", headers: SAME_ORIGIN }),
    );
    expect(l.status).toBe(200);
    expect(cookieOf(l)).toMatch(/va_admin_stepup=;.*Max-Age=0/i);
    clearCookies();
    const html2 = renderToStaticMarkup(await render());
    expect(html2).toContain('data-testid="mfa-code-screen"');
    expect(html2).not.toContain(groupSecret(secret));
    expect(html2).not.toContain("<svg");
    expect(await audits("admin.mfa.locked", owner.id)).toHaveLength(1);
  });

  it("too many wrong codes: 429 too_many_attempts", async () => {
    const owner = await makeOwner();
    asUser(owner);
    const { secret } = await pendingEnrolment(owner.id);
    for (let i = 0; i < MFA_MAX_FAILS; i++)
      expect((await verify(totpAt(secret, Date.now() + 3600_000))).status).toBe(400);
    const r = await verify(totpAt(secret, Date.now()));
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "too_many_attempts" });
  });

  it("an owner with a valid step-up for the overview sees it; a stale cookie (expired) is the code screen again", async () => {
    const owner = await makeOwner();
    asUser(owner);
    stepUp(owner, undefined, Date.now() - STEP_UP_SECONDS * 1000 - 1000);
    const overview = (await import("@/app/(admin)/admin/page")) as { default: () => Promise<unknown> };
    const e = await overview.default().then(
      () => null,
      (x: unknown) => x,
    );
    expect(String((e as { digest?: string }).digest)).toContain(`${TEST_BASE}/unlock`);
    stepUp(owner);
    expect(await overview.default()).toBeTruthy();
  });
});
