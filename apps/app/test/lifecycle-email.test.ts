import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { PLANS } from "@voidaccess/config";
import { creditLedger, grantMonthly, investigations, lifecycleEmails, users, type Tx } from "@voidaccess/db";
import { LogTransport, sendEmail, setTransport } from "@voidaccess/emails";
import { sendDueAlerts } from "@/lib/billing/alerts";
import { runLifecycle } from "@/lib/lifecycle/cron";
import { sendLifecycle } from "@/lib/lifecycle/send";
import { setProductEmails } from "@/lib/ops/preferences";
import { signUnsubscribe, verifyUnsubscribe } from "@/lib/ops/unsubscribe";
import { POST as cronPOST } from "@/app/api/cron/lifecycle/route";
import { db, makeUser } from "./helpers";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const outbox = new LogTransport(undefined);
beforeAll(() => setTransport(outbox));
afterAll(() => setTransport(undefined));

const sys = <T>(fn: (tx: Tx) => Promise<T>) => db().withSystem("t", fn, { audit: false });
const mails = (to: string, template?: string) =>
  outbox.outbox.filter((m) => m.to === to && (!template || m.template === template));
const ledgerRows = async (userId: string) =>
  sys((tx) => tx.select().from(lifecycleEmails).where(eq(lifecycleEmails.userId, userId)));

describe("lifecycle emails: once per user, consent-gated", () => {
  it("welcome goes out once, founder-signed, with the unsubscribe link and the List-Unsubscribe headers", async () => {
    const u = await makeUser({ credits: 0 });
    expect(await sendLifecycle("welcome", u.id)).toBe("sent");
    expect(await sendLifecycle("welcome", u.id)).toBe("duplicate");
    expect(await Promise.all([sendLifecycle("welcome", u.id), sendLifecycle("welcome", u.id)])).toEqual([
      "duplicate",
      "duplicate",
    ]);
    const m = mails(u.email, "welcome");
    expect(m).toHaveLength(1);
    expect(m[0]!.text).toContain("— Katriel");
    expect(m[0]!.text).toContain("LockBit ransomware group"); // three example queries
    expect(m[0]!.text).toContain(String(PLANS.free.monthlyCredits));
    expect(m[0]!.text).toContain("http://localhost:3000/investigations/new");
    const link = /http:\/\/localhost:3000\/unsubscribe\?u=([^&\s]+)&t=(\S+)/.exec(m[0]!.text)!;
    expect(link[1]).toBe(u.id);
    expect(verifyUnsubscribe(u.id, link[2]!)).toBe(true);
    expect(link[2]).toBe(signUnsubscribe(u.id));
    expect(m[0]!.headers!["List-Unsubscribe"]).toBe(
      `<http://localhost:3000/api/unsubscribe?u=${u.id}&t=${link[2]}>`,
    );
    expect(m[0]!.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect((await ledgerRows(u.id))[0]).toMatchObject({ kind: "welcome", status: "sent" });
  });

  it("with product email off it is suppressed, recorded, and never released by turning it back on", async () => {
    const u = await makeUser({ credits: 0 });
    await setProductEmails(u.id, false);
    expect(await sendLifecycle("welcome", u.id)).toBe("suppressed");
    expect(await sendLifecycle("first_investigation_nudge", u.id)).toBe("suppressed");
    expect(mails(u.email)).toHaveLength(0);
    expect((await ledgerRows(u.id)).map((r) => r.status)).toEqual(["suppressed", "suppressed"]);
    await setProductEmails(u.id, true);
    expect(await sendLifecycle("welcome", u.id)).toBe("duplicate");
    expect(mails(u.email)).toHaveLength(0);
    // a kind that was never attempted does go out once consent is back
    expect(await sendLifecycle("what_next", u.id)).toBe("sent");
    expect(mails(u.email, "whatNext")).toHaveLength(1);
  });

  it("is skipped for unverified, suspended and unknown users (no row, no email)", async () => {
    const unverified = await makeUser({ credits: 0, emailVerified: false });
    const suspended = await makeUser({ credits: 0, status: "suspended" });
    expect(await sendLifecycle("welcome", unverified.id)).toBe("skipped");
    expect(await sendLifecycle("welcome", suspended.id)).toBe("skipped");
    expect(await sendLifecycle("welcome", "00000000-0000-4000-8000-0000000000aa")).toBe("skipped");
    expect(mails(unverified.email)).toHaveLength(0);
    expect(await ledgerRows(unverified.id)).toHaveLength(0);
  });

  it("a failed send releases the claim so the next run retries, and sends exactly once overall", async () => {
    const u = await makeUser({ credits: 0 });
    let fail = true;
    setTransport({
      async send(msg) {
        if (fail) throw new Error("smtp down");
        await outbox.send(msg);
      },
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendLifecycle("welcome", u.id)).toBe("failed");
    expect(await ledgerRows(u.id)).toHaveLength(0);
    fail = false;
    expect(await sendLifecycle("welcome", u.id)).toBe("sent");
    expect(await sendLifecycle("welcome", u.id)).toBe("duplicate");
    expect(mails(u.email, "welcome")).toHaveLength(1);
    err.mockRestore();
    setTransport(outbox);
  });
});

describe("the hourly cron picks the right users, once", () => {
  const NOW = new Date("2035-01-10T12:00:00Z"); // far enough ahead that every other test's users are out of every window
  const h = (n: number) => new Date(NOW.getTime() - n * 3_600_000);
  const mk = async (
    createdAt: Date,
    o: { verified?: boolean; status?: "active" | "banned"; productEmails?: boolean } = {},
  ) => {
    const u = await makeUser({ credits: 0, emailVerified: o.verified ?? true, status: o.status ?? "active" });
    await sys((tx) =>
      tx
        .update(users)
        .set({ createdAt, productEmails: o.productEmails ?? true })
        .where(eq(users.id, u.id)),
    );
    return u;
  };
  const completed = (userId: string, at: Date) =>
    sys((tx) =>
      tx.insert(investigations).values({
        userId,
        query: "q",
        depth: "quick",
        status: "completed",
        createdAt: new Date(at.getTime() - 600_000),
        completedAt: at,
      }),
    );

  it("24-hour nudge: only verified, active, opted-in users with no investigation, 24 h to 7 days after sign-up", async () => {
    const due = await mk(h(25));
    const hasRun = await mk(h(26));
    await completed(hasRun.id, h(25));
    const tooEarly = await mk(h(10));
    const tooOld = await mk(h(24 * 10));
    const unverified = await mk(h(25), { verified: false });
    const banned = await mk(h(25), { status: "banned" });
    const optedOut = await mk(h(25), { productEmails: false });

    const first = await runLifecycle(NOW);
    expect(mails(due.email, "firstInvestigationNudge")).toHaveLength(1);
    for (const u of [hasRun, tooEarly, tooOld, unverified, banned])
      expect(mails(u.email, "firstInvestigationNudge"), u.email).toHaveLength(0);
    expect(mails(optedOut.email)).toHaveLength(0);
    expect(
      (await ledgerRows(optedOut.id)).find((r: { kind: string }) => r.kind === "first_investigation_nudge"),
    ).toMatchObject({ status: "suppressed" });
    expect(first.first_investigation_nudge.sent).toBeGreaterThanOrEqual(1);

    const second = await runLifecycle(NOW);
    expect(mails(due.email, "firstInvestigationNudge")).toHaveLength(1); // once
    expect(second.first_investigation_nudge.sent ?? 0).toBe(0);
  });

  it("what-next: after the first completed investigation (not within 30 minutes, not stale), once, separate from results-ready", async () => {
    const ready = await mk(h(30));
    await completed(ready.id, h(2));
    await completed(ready.id, h(1)); // a second run changes nothing
    const justNow = await mk(h(30));
    await completed(justNow.id, new Date(NOW.getTime() - 5 * 60_000));
    const stale = await mk(h(24 * 20));
    await completed(stale.id, h(24 * 15));

    await runLifecycle(NOW);
    await runLifecycle(NOW);
    const m = mails(ready.email, "whatNext");
    expect(m).toHaveLength(1);
    expect(m[0]!.text).toMatch(/graph/i);
    expect(m[0]!.text).toMatch(/export/i);
    expect(m[0]!.text).toMatch(/archive/i);
    expect(m[0]!.text).toMatch(/billing/); // the upgrade path
    expect(m[0]!.text).toContain("— Katriel");
    expect(mails(ready.email, "resultsReady")).toHaveLength(0);
    expect(mails(justNow.email, "whatNext")).toHaveLength(0);
    expect(mails(stale.email, "whatNext")).toHaveLength(0);
    // five minutes later the "just now" user is due
    await runLifecycle(new Date(NOW.getTime() + 30 * 60_000));
    expect(mails(justNow.email, "whatNext")).toHaveLength(1);
  });

  it("welcome backstop: a verified account from the last 48 hours that missed the verification hook", async () => {
    const recent = await mk(h(3));
    const old = await mk(h(24 * 3));
    await runLifecycle(NOW);
    expect(mails(recent.email, "welcome")).toHaveLength(1);
    expect(mails(old.email, "welcome")).toHaveLength(0);
    await sendLifecycle("welcome", recent.id);
    expect(mails(recent.email, "welcome")).toHaveLength(1);
  });

  it("the cron route needs the cron secret, and runs", async () => {
    const url = "http://localhost:3000/api/cron/lifecycle";
    expect((await cronPOST(new Request(url, { method: "POST" }))).status).toBe(401);
    expect(
      (await cronPOST(new Request(url, { method: "POST", headers: { authorization: "Bearer wrong" } })))
        .status,
    ).toBe(401);
    const ok = await cronPOST(
      new Request(url, {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.CRON_SHARED_SECRET}` },
      }),
    );
    expect(ok.status).toBe(200);
    expect(Object.keys(await ok.json()).sort()).toEqual([
      "first_investigation_nudge",
      "welcome",
      "what_next",
    ]);
  });
});

describe("transactional email ignores the preference", () => {
  it("usage alerts still arrive with product email off, and nothing transactional carries unsubscribe headers", async () => {
    const u = await makeUser({ credits: 0 });
    await setProductEmails(u.id, false);
    await grantMonthly(u.id, "free", new Date());
    await sys((tx) =>
      tx.insert(creditLedger).values({
        userId: u.id,
        bucket: "grant",
        amount: -80,
        reason: "reserve",
        idempotencyKey: `p6-spend-${u.id}`,
      }),
    );
    expect(await sendDueAlerts(u.id)).toEqual(["credits_80"]);
    const alert = mails(u.email, "creditAlert80");
    expect(alert).toHaveLength(1);
    expect(alert[0]!.headers).toBeUndefined();
    await sendEmail("resultsReady", u.email, {
      name: "A",
      query: "q",
      resultsUrl: "http://localhost:3000/r",
    });
    await sendEmail("paymentFailed", u.email, { name: "A", portalUrl: "http://localhost:3000/p" });
    expect(mails(u.email, "resultsReady")).toHaveLength(1);
    expect(mails(u.email, "paymentFailed")).toHaveLength(1);
    expect(mails(u.email).every((m) => m.headers === undefined)).toBe(true);
    expect(mails(u.email, "welcome")).toHaveLength(0); // while lifecycle stays off
  });
});
