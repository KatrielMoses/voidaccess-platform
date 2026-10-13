import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { LocalFsObjectStore } from "@voidaccess/archive";
import {
  abuseFlags,
  archiveEntities,
  archiveRemovedPages,
  blockedEmailDomains,
  creditLedger,
  invEntities,
  invSummary,
  reserve,
} from "@voidaccess/db";
import { setUserRole } from "@/lib/admin/role";
import {
  addBlockedDomain,
  grantCredits,
  markAbuseReviewed,
  normaliseDomain,
  openForAbuseReview,
  refundInvestigation,
  removeArchiveItem,
  removeBlockedDomain,
  revokeSessions,
  setUserStatus,
} from "@/lib/admin/actions";
import { getUserDetail } from "@/lib/admin/queries";
import { AdminError } from "@/lib/admin/errors";
import { asUser, balanceOf, db, makeUser } from "./helpers";
import {
  addInvestigation,
  addSession,
  audits,
  makeAdmin,
  SAME_ORIGIN,
  sessionCount,
  userRow,
} from "./admin-helpers";
import { ownerUrl } from "./urls";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const REASON = "abuse review: test reason";
const rejects = async (p: Promise<unknown>, status: number) => {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(AdminError);
  expect((e as AdminError).status).toBe(status);
};

describe("admin actions: each change writes its audit row (actor, action, target, reason, time)", () => {
  it("suspend, unsuspend and ban change status, and ban revokes sessions", async () => {
    const admin = await makeAdmin();
    const u = await makeUser({ credits: 0 });
    await addSession(u.id);
    await addSession(u.id);

    await setUserStatus(admin, u.id, "suspend", REASON);
    expect((await userRow(u.id)).status).toBe("suspended");
    expect(await sessionCount(u.id)).toBe(2); // suspension is enforced per request; sessions stay until banned or revoked
    const [s] = await audits("admin.user.suspend", u.id);
    expect(s).toMatchObject({ actor: admin.id, action: "admin.user.suspend", target: u.id });
    expect(s!.meta).toMatchObject({ reason: REASON, from: "active", to: "suspended" });
    expect(s!.at).toBeInstanceOf(Date);

    await setUserStatus(admin, u.id, "unsuspend", REASON);
    expect((await userRow(u.id)).status).toBe("active");
    expect(await audits("admin.user.unsuspend", u.id)).toHaveLength(1);

    const r = await setUserStatus(admin, u.id, "ban", REASON);
    expect(r.sessionsRevoked).toBe(2);
    expect((await userRow(u.id)).status).toBe("banned");
    expect(await sessionCount(u.id)).toBe(0);
    const [b] = await audits("admin.user.ban", u.id);
    expect(b!.meta).toMatchObject({ reason: REASON, sessionsRevoked: 2 });
  });

  it("revoke sessions deletes them and writes a row", async () => {
    const admin = await makeAdmin();
    const u = await makeUser({ credits: 0 });
    await addSession(u.id);
    expect((await revokeSessions(admin, u.id, REASON)).sessionsRevoked).toBe(1);
    expect(await sessionCount(u.id)).toBe(0);
    const [a] = await audits("admin.user.revoke_sessions", u.id);
    expect(a).toMatchObject({ actor: admin.id });
    expect(a!.meta).toMatchObject({ reason: REASON, sessionsRevoked: 1 });
  });

  it("a reason is required, and without one nothing changes and nothing is audited", async () => {
    const admin = await makeAdmin();
    const u = await makeUser({ credits: 0 });
    for (const bad of [undefined, "", "   ", "short", "x".repeat(1001)])
      await rejects(setUserStatus(admin, u.id, "suspend", bad), 400);
    await rejects(grantCredits(admin, u.id, 10, "", "k-reason-0001"), 400);
    await rejects(refundInvestigation(admin, await addInvestigation(u.id), ""), 400);
    expect((await userRow(u.id)).status).toBe("active");
    expect(await audits("admin.user.suspend", u.id)).toHaveLength(0);
    expect(await audits("admin.credits.grant", u.id)).toHaveLength(0);
  });

  it("an admin can't change their own status, and unknown users are 404", async () => {
    const admin = await makeAdmin();
    await rejects(setUserStatus(admin, admin.id, "suspend", REASON), 409);
    await rejects(setUserStatus(admin, "00000000-0000-4000-8000-000000000000", "suspend", REASON), 404);
    await rejects(setUserStatus(admin, "not-a-uuid", "suspend", REASON), 400);
    expect((await userRow(admin.id)).status).toBe("active");
  });

  it("grant credits updates the balance, is idempotent per request id, and is audited once", async () => {
    const admin = await makeAdmin();
    const u = await makeUser({ credits: 0 });
    await grantCredits(admin, u.id, 250, REASON, "grant-req-0001");
    expect(await balanceOf(u.id)).toBe(250);
    const again = await grantCredits(admin, u.id, 250, REASON, "grant-req-0001");
    expect(again.duplicate).toBe(true);
    expect(await balanceOf(u.id)).toBe(250);
    const rows = await audits("admin.credits.grant", u.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: admin.id });
    expect(rows[0]!.meta).toMatchObject({ reason: REASON, credits: 250 });
    for (const bad of [0, -5, 1.5, 50_001, "10", null])
      await rejects(grantCredits(admin, u.id, bad, REASON, "k-bad-00001"), 400);
    const ledger = await db().withSystem(
      "t",
      (tx) => tx.select().from(creditLedger).where(eq(creditLedger.userId, u.id)),
      { audit: false },
    );
    expect(ledger.find((l) => l.reason === "admin")?.actorId).toBe(admin.id);
  });

  it("refund returns the charge once, and a second refund changes nothing", async () => {
    const admin = await makeAdmin();
    const u = await makeUser({ credits: 500 });
    const inv = await addInvestigation(u.id, { status: "failed" });
    await db().withUser(u.id, async (tx) => {
      await reserve(u.id, inv, "standard", { tx });
    });
    const before = await balanceOf(u.id);
    const r = await refundInvestigation(admin, inv, REASON, { expectUserId: u.id });
    expect(r.refunded).toBeGreaterThan(0);
    expect(await balanceOf(u.id)).toBe(before + r.refunded);
    const [a] = await audits("admin.credits.refund", u.id);
    expect(a!.meta).toMatchObject({ reason: REASON, investigationId: inv, refunded: r.refunded });
    const second = await refundInvestigation(admin, inv, REASON);
    expect(second.alreadyRefunded).toBe(true);
    expect(await balanceOf(u.id)).toBe(before + r.refunded);
    // an investigation under another user's page is "not found"
    const other = await makeUser({ credits: 0 });
    await rejects(refundInvestigation(admin, inv, REASON, { expectUserId: other.id }), 404);
  });

  it("mark reviewed works for flags, blocked runs and repeat users, each audited and each recorded as a reviewed flag", async () => {
    const admin = await makeAdmin();
    const u = await makeUser({ credits: 0 });
    const [flag] = await db().withSystem(
      "t",
      (tx) =>
        tx.insert(abuseFlags).values({ userId: u.id, kind: "dispute" }).returning({ id: abuseFlags.id }),
      { audit: false },
    );
    await markAbuseReviewed(admin, { kind: "flag", id: flag!.id }, "reviewed", REASON);
    const [f] = await db().withSystem(
      "t",
      (tx) => tx.select().from(abuseFlags).where(eq(abuseFlags.id, flag!.id)),
      { audit: false },
    );
    expect(f).toMatchObject({ status: "reviewed", reviewedBy: admin.id });

    const run = await addInvestigation(u.id, { status: "failed", failureReason: "blocked_query" });
    await markAbuseReviewed(admin, { kind: "run", id: run }, "dismissed", REASON);
    await markAbuseReviewed(admin, { kind: "user", id: u.id }, "actioned", REASON);
    const rows = await audits("admin.abuse.review", u.id);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.actor === admin.id && (r.meta as { reason?: string }).reason === REASON)).toBe(
      true,
    );
    // a run that isn't a blocked_query one can't be "reviewed" through this path
    await rejects(
      markAbuseReviewed(admin, { kind: "run", id: await addInvestigation(u.id) }, "reviewed", REASON),
      404,
    );
  });

  it("open for abuse review is audited with a reason, and shows masked values only", async () => {
    const admin = await makeAdmin();
    const u = await makeUser({ credits: 0 });
    const inv = await addInvestigation(u.id, { query: "secret subject" });
    await db().withSystem(
      "t",
      async (tx) => {
        await tx
          .insert(invSummary)
          .values({ userId: u.id, investigationId: inv, markdown: "# Findings", confidence: "medium" });
        await tx.insert(invEntities).values([
          {
            userId: u.id,
            investigationId: inv,
            bundleId: "e1",
            type: "email",
            value: null,
            displayValue: "a***@example.test",
            sensitive: true,
            confidence: 0.9,
          },
          {
            userId: u.id,
            investigationId: inv,
            bundleId: "e2",
            type: "domain",
            value: "evil.example",
            displayValue: "evil.example",
            sensitive: false,
            confidence: 0.8,
          },
        ]);
      },
      { audit: false },
    );
    await rejects(openForAbuseReview(admin, inv, ""), 400);
    expect(await audits("admin.investigation.open_review")).not.toContainEqual(
      expect.objectContaining({ target: `investigation:${inv}` }),
    );
    const c = await openForAbuseReview(admin, inv, REASON);
    expect(c.investigation.query).toBe("secret subject");
    expect(c.summaryMarkdown).toBe("# Findings");
    expect(c.entities.map((e) => e.display).sort()).toEqual(["a***@example.test", "evil.example"]);
    expect(JSON.stringify(c)).not.toMatch(/"value"/); // raw value fields are not part of the shape
    const [a] = await audits("admin.investigation.open_review", `investigation:${inv}`);
    expect(a).toMatchObject({ actor: admin.id });
    expect(a!.meta).toMatchObject({ reason: REASON, targetUserId: u.id, investigationId: inv });
  });

  it("reading a user's detail (their queries) writes an audit row; a missing user writes none", async () => {
    const admin = await makeAdmin();
    const u = await makeUser({ credits: 0 });
    await addInvestigation(u.id, { query: "visible to admin" });
    const d = await getUserDetail(admin.id, u.id);
    expect(d.investigations[0]!.query).toBe("visible to admin");
    const rows = await audits("admin.user.view", u.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actor).toBe(admin.id);
    expect(d.trail.some((t) => t.action === "admin.user.view")).toBe(true);
    await rejects(getUserDetail(admin.id, "00000000-0000-4000-8000-000000000001"), 404);
  });

  it("archive removal tombstones through the archive package and is audited with the reason", async () => {
    const admin = await makeAdmin();
    const store = new LocalFsObjectStore(mkdtempSync(join(tmpdir(), "va-p6-arc-")));
    const [ent] = await db().withSystem(
      "t",
      (tx) =>
        tx
          .insert(archiveEntities)
          .values({
            type: "domain",
            canonicalValue: `p6-${Date.now()}.example`,
            firstSeen: new Date(),
            lastSeen: new Date(),
            displayValue: "x",
          })
          .returning({ id: archiveEntities.id }),
      { audit: false },
    );
    await rejects(removeArchiveItem(admin, { kind: "entity", key: ent!.id, reason: "" }, store), 400);
    await rejects(removeArchiveItem(admin, { kind: "nonsense", key: ent!.id, reason: REASON }, store), 400);
    const r = await removeArchiveItem(admin, { kind: "entity", key: ent!.id, reason: REASON }, store);
    expect(r.tombstoned).toBe(1);
    const [e] = await db().withSystem(
      "t",
      (tx) => tx.select().from(archiveEntities).where(eq(archiveEntities.id, ent!.id)),
      { audit: false },
    );
    expect(e!.tombstonedAt).not.toBeNull();
    const [a] = await audits("archive.remove", `entity:${ent!.id}`);
    expect(a).toMatchObject({ actor: admin.id });
    expect(a!.meta).toMatchObject({ reason: REASON });
    // a page removal records the hash so it can't come back
    const hash = "a".repeat(64);
    await removeArchiveItem(admin, { kind: "page", key: hash, reason: REASON }, store);
    const removed = await db().withSystem(
      "t",
      (tx) => tx.select().from(archiveRemovedPages).where(eq(archiveRemovedPages.contentHash, hash)),
      { audit: false },
    );
    expect(removed).toHaveLength(1);
    await rejects(removeArchiveItem(admin, { kind: "page", key: "not-a-hash", reason: REASON }, store), 400);
  });

  it("blocked domains: add and remove are audited, bad input and duplicates are rejected", async () => {
    const admin = await makeAdmin();
    const d = `p6-${Date.now()}.example`;
    expect(normaliseDomain(`@${d.toUpperCase()}`)).toBe(d);
    for (const bad of ["", "nodot", "has space.com", "a..b.com", "-x.com", 5])
      expect(() => normaliseDomain(bad)).toThrow(AdminError);
    await rejects(addBlockedDomain(admin, d, "no"), 400);
    await addBlockedDomain(admin, d, REASON);
    const [row] = await db().withSystem(
      "t",
      (tx) => tx.select().from(blockedEmailDomains).where(eq(blockedEmailDomains.domain, d)),
      { audit: false },
    );
    expect(row).toMatchObject({ reason: REASON, createdBy: admin.id });
    await rejects(addBlockedDomain(admin, d, REASON), 409);
    expect(await audits("admin.blocked_domain.add", `domain:${d}`)).toHaveLength(1);
    await removeBlockedDomain(admin, d, REASON);
    expect(await audits("admin.blocked_domain.remove", `domain:${d}`)).toHaveLength(1);
    await rejects(removeBlockedDomain(admin, d, REASON), 404);
  });
});

describe("the role script (owner connection only, audited)", () => {
  it("grants and revokes admin, writes audit rows with actor ops:<name> and the reason, and is idempotent", async () => {
    const u = await makeUser({ credits: 0 });
    const g = await setUserRole(ownerUrl, {
      email: u.email,
      role: "admin",
      reason: "founder access",
      actor: "tester",
    });
    expect(g).toMatchObject({ userId: u.id, from: "user", to: "admin", changed: true });
    expect((await userRow(u.id)).role).toBe("admin");
    const [a] = await audits("admin.role.grant", u.id);
    expect(a).toMatchObject({ actor: "ops:tester", target: u.id });
    expect(a!.meta).toMatchObject({ reason: "founder access", from: "user", to: "admin" });
    expect(
      (
        await setUserRole(ownerUrl, {
          email: u.email.toUpperCase(),
          role: "admin",
          reason: "founder access",
          actor: "tester",
        })
      ).changed,
    ).toBe(false);
    await setUserRole(ownerUrl, { email: u.email, role: "user", reason: "left the team", actor: "tester" });
    expect((await userRow(u.id)).role).toBe("user");
    expect(await audits("admin.role.revoke", u.id)).toHaveLength(1);
  });

  it("refuses a missing reason, an unknown email, and the app role's URL", async () => {
    const u = await makeUser({ credits: 0 });
    await expect(
      setUserRole(ownerUrl, { email: u.email, role: "admin", reason: "", actor: "t" }),
    ).rejects.toThrow(/reason/);
    await expect(
      setUserRole(ownerUrl, {
        email: "nobody@nowhere.test",
        role: "admin",
        reason: "no such user",
        actor: "t",
      }),
    ).rejects.toThrow(/no user/);
    const appUrl = new URL(ownerUrl);
    appUrl.username = "va_app";
    appUrl.password = process.env.VA_APP_LOCAL_PASSWORD ?? "va_app_local";
    await expect(
      setUserRole(appUrl.toString(), { email: u.email, role: "admin", reason: "should refuse", actor: "t" }),
    ).rejects.toThrow(/owner database URL/);
    expect((await userRow(u.id)).role).toBe("user");
  });

  it("there is no API or action that assigns the role: the app role can't update users.role", async () => {
    const u = await makeUser({ credits: 0 });
    const url = new URL(ownerUrl);
    url.username = "va_app";
    url.password = process.env.VA_APP_LOCAL_PASSWORD ?? "va_app_local";
    const c = new pg.Client({ connectionString: url.toString() });
    await c.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.user_id', $1, true)", [u.id]);
      await expect(c.query("update users set role = 'admin' where id = $1", [u.id])).rejects.toMatchObject({
        code: "42501",
      });
    } finally {
      await c.query("rollback").catch(() => {});
      await c.end();
    }
    expect((await userRow(u.id)).role).toBe("user");
  });
});

describe("admin API wiring: the same actions through the route handlers", () => {
  it("POST status and grant work for an admin (same-origin) and write audit rows", async () => {
    const admin = await makeAdmin();
    const u = await makeUser({ credits: 0 });
    asUser(admin);
    const { POST: status } = await import("@/app/api/admin/users/[id]/status/route");
    const { POST: grant } = await import("@/app/api/admin/users/[id]/grant/route");
    const ctx = { params: Promise.resolve({ id: u.id }) };
    const post = (path: string, body: unknown, headers: Record<string, string> = SAME_ORIGIN) =>
      new Request(`http://localhost:3000/api/admin/users/${u.id}/${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

    // cross-site posts are refused even for an admin
    expect(
      (
        await status(
          post("status", { action: "suspend", reason: REASON }, { "sec-fetch-site": "cross-site" }),
          ctx,
        )
      ).status,
    ).toBe(403);
    expect((await userRow(u.id)).status).toBe("active");

    expect((await status(post("status", { action: "suspend", reason: REASON }), ctx)).status).toBe(200);
    expect((await userRow(u.id)).status).toBe("suspended");
    expect((await status(post("status", { action: "suspend", reason: "" }), ctx)).status).toBe(400);

    const g = await grant(post("grant", { credits: 40, reason: REASON, requestId: "api-grant-0001" }), ctx);
    expect(g.status).toBe(200);
    expect(await balanceOf(u.id)).toBe(40);
    expect(await audits("admin.credits.grant", u.id)).toHaveLength(1);
    asUser(null);
  });
});
