import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createLocalDatabase } from "@voidaccess/db/local";
import { createAuth } from "@/lib/auth/auth";
import { MAX_CONCURRENT_RUNS } from "@/lib/limits";
import { createAuthRateLimitStorage, hashIp, splitKey } from "@/lib/rate-limit";
import { setLauncher } from "@/lib/launcher";
import { startInvestigation } from "@/lib/runs/service";
import { StubLauncher, db, makeUser } from "./helpers";
import { appUrl, ownerUrl } from "./urls";

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

// Two independent Databases (own pools) stand in for two Cloud Run instances sharing one Postgres.
const dbA = createLocalDatabase(appUrl, { max: 5 });
const dbB = createLocalDatabase(appUrl, { max: 5 });
afterAll(async () => {
  await Promise.all([dbA.close(), dbB.close()]);
});
setLauncher(new StubLauncher());

async function owner<T extends object>(query: string, params: unknown[] = []): Promise<T[]> {
  const pg = await import("pg");
  const c = new pg.default.Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    return (await c.query(query, params)).rows as T[];
  } finally {
    await c.end();
  }
}

describe("H1-2: shared auth rate-limit storage", () => {
  it("counts per key in the window, refuses at max with a retry-after, and does not extend the window on refusal", async () => {
    const s = createAuthRateLimitStorage(() => dbA);
    const key = `203.0.113.${Math.floor(Math.random() * 250)}|/x-${randomUUID()}`;
    for (let i = 0; i < 3; i++)
      expect(await s.consume(key, { window: 60, max: 3 })).toEqual({ allowed: true, retryAfter: null });
    const refused = await s.consume(key, { window: 60, max: 3 });
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfter).toBeGreaterThanOrEqual(1);
    expect(refused.retryAfter).toBeLessThanOrEqual(60);
    const [row] = await owner<{ count: number }>(`select count from rate_limits where key = $1`, [key]);
    expect(row!.count).toBe(3); // the refused request was not counted
    // another key is independent
    expect((await s.consume(key + "-other", { window: 60, max: 3 })).allowed).toBe(true);
  });

  it("the window rolls: after it elapses the key is allowed again", async () => {
    const s = createAuthRateLimitStorage(() => dbA);
    const key = `198.51.100.7|/y-${randomUUID()}`;
    expect((await s.consume(key, { window: 1, max: 1 })).allowed).toBe(true);
    expect((await s.consume(key, { window: 1, max: 1 })).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 1200));
    expect((await s.consume(key, { window: 1, max: 1 })).allowed).toBe(true);
  });

  it("40 simultaneous requests split across two instances are admitted exactly `max` times", async () => {
    const a = createAuthRateLimitStorage(() => dbA);
    const b = createAuthRateLimitStorage(() => dbB);
    const key = `192.0.2.9|/z-${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => (i % 2 ? a : b).consume(key, { window: 60, max: 10 })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect(results.filter((r) => !r.allowed)).toHaveLength(30);
  });

  it("splitKey reads Better Auth's `<ip>|<path>` keys, including IPv6 and the no-trusted-ip bucket", () => {
    expect(splitKey("203.0.113.5|/sign-in/email")).toEqual({ ip: "203.0.113.5", path: "/sign-in/email" });
    expect(splitKey("2001:db8::1|/sign-up/email")).toEqual({ ip: "2001:db8::1", path: "/sign-up/email" });
    expect(splitKey("no-trusted-ip|/sign-up/email")).toEqual({ ip: null, path: "/sign-up/email" });
  });
});

describe("H1-2: auth limits hold across two auth instances sharing one database", () => {
  const SITE_ORIGIN = "http://va.localhost:3700";
  const authA = createAuth(dbA);
  const authB = createAuth(dbB);
  const signIn = (auth: typeof authA, ip: string) =>
    auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: SITE_ORIGIN, "x-forwarded-for": ip },
        body: JSON.stringify({ email: "nobody@test.local", password: "wrong password here" }),
      }),
    );

  it("/sign-in/email allows 10 a minute per IP in total, whichever instance serves them, then 429s on both", async () => {
    const ip = `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) statuses.push((await signIn(i % 2 ? authA : authB, ip)).status);
    expect(statuses.every((s) => s !== 429)).toBe(true); // wrong credentials, but not rate limited
    const a = await signIn(authA, ip);
    const b = await signIn(authB, ip);
    expect(a.status).toBe(429);
    expect(b.status).toBe(429);
    expect(a.headers.get("x-retry-after")).toMatch(/^\d+$/);
    // another address is unaffected
    expect((await signIn(authA, "10.78.1.1")).status).not.toBe(429);

    // each refusal is recorded; the row holds a hash of the address, never the address
    const ev = await owner<{ source: string; path: string; ip_hash: string; user_id: string | null }>(
      `select source, path, ip_hash, user_id from rate_limit_events where ip_hash = $1`,
      [hashIp(ip)],
    );
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ source: "auth", path: "/sign-in/email", user_id: null });
    expect(ev[0]!.ip_hash).toMatch(/^[0-9a-f]{32}$/);
    const leaked = await owner<{ n: number }>(
      `select count(*)::int n from rate_limit_events e where e::text like $1`,
      [`%${ip}%`],
    );
    expect(leaked[0]!.n).toBe(0);
  });

  it("/sign-up/email: 5 a minute per IP across instances", async () => {
    const ip = `10.79.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const signUp = (auth: typeof authA, n: number) =>
      auth.handler(
        new Request("http://localhost:3000/api/auth/sign-up/email", {
          method: "POST",
          headers: { "content-type": "application/json", origin: SITE_ORIGIN, "x-forwarded-for": ip },
          body: JSON.stringify({
            name: "R",
            email: `rl-${n}-${randomUUID()}@test.local`,
            password: "a long password",
            aupAccepted: true,
          }),
        }),
      );
    const first = [];
    for (let i = 0; i < 5; i++) first.push((await signUp(i % 2 ? authA : authB, i)).status);
    expect(first).toEqual([200, 200, 200, 200, 200]);
    expect((await signUp(authA, 6)).status).toBe(429);
    expect((await signUp(authB, 7)).status).toBe(429);
  });
});

describe("H1-2: run creation caps are DB-backed and refusals are recorded", () => {
  it("N+3 simultaneous starts admit exactly the concurrency cap; each refusal is an event with a hashed IP", async () => {
    const u = await makeUser({ plan: "pro", credits: 5000 });
    const ip = `172.16.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
    const results = await Promise.allSettled(
      Array.from({ length: MAX_CONCURRENT_RUNS + 3 }, () =>
        startInvestigation(u, { query: "rate limited run", depth: "quick" }, { ip }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(MAX_CONCURRENT_RUNS);
    const refused = results.filter((r) => r.status === "rejected");
    expect(refused).toHaveLength(3);
    for (const r of refused)
      expect((r as PromiseRejectedResult).reason).toMatchObject({ code: "rate_limited_concurrent" });
    const ev = await owner<{ source: string; path: string; user_id: string; ip_hash: string }>(
      `select source, path, user_id, ip_hash from rate_limit_events where user_id = $1`,
      [u.id],
    );
    expect(ev).toHaveLength(3);
    expect(
      ev.every(
        (e) => e.source === "run_create" && e.path === "rate_limited_concurrent" && e.ip_hash === hashIp(ip),
      ),
    ).toBe(true);
    const raw = await owner<{ n: number }>(
      `select count(*)::int n from rate_limit_events e where e::text like $1`,
      [`%${ip}%`],
    );
    expect(raw[0]!.n).toBe(0);
    void db;
  });
});
