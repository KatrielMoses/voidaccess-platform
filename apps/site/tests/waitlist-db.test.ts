import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/waitlist/crypto";
import { MemoryRateLimiter } from "@/lib/waitlist/ratelimit";
import { confirmWaitlist, joinWaitlist, type JoinDeps } from "@/lib/waitlist/service";
import { drizzleStore } from "@/lib/waitlist/store";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@voidaccess/db/schema";

const url = process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/voidaccess_site_test";
const pool = new pg.Pool({ connectionString: url, max: 2 });
let up = false;

beforeAll(async () => {
  try {
    await pool.query("select 1 from waitlist limit 1");
    await pool.query("delete from waitlist");
    up = true;
  } catch {
    console.warn("waitlist DB tests skipped: voidaccess_site_test not reachable or not migrated");
  }
});
afterAll(() => pool.end());

describe("waitlist against Postgres", () => {
  it("creates one row, confirms it, and treats a duplicate identically", async (ctx) => {
    if (!up) return ctx.skip();
    const sent: string[] = [];
    const deps: JoinDeps = {
      store: drizzleStore(drizzle(pool, { schema }) as never),
      mailer: { kind: "log", send: async (m) => void sent.push(m.text) },
      limiter: new MemoryRateLimiter(),
      verifyTurnstile: async () => true,
      ipSalt: "s",
      siteUrl: "http://t",
      confirmationMail: (l) => ({ subject: "s", text: l }),
    };
    const run = async (email: string) => {
      const r = await joinWaitlist({ email, turnstileToken: "t", wantsFounding: true, firstTouch: { utm_source: "hn", junk: "x" } }, { ip: "9.9.9.9" }, deps);
      if (r.status === 200) await r.background();
      return { status: r.status, body: r.body };
    };
    const a = await run("Person@Example.com");
    const b = await run("person@example.com");
    expect(b).toEqual(a);
    const { rows } = await pool.query("select * from waitlist");
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe("person@example.com");
    expect(rows[0].first_touch).toEqual({ utm_source: "hn" });
    expect(rows[0].confirmed_at).toBeNull();
    const token = decodeURIComponent(sent.at(-1)!.match(/token=([^\s]+)/)![1]!);
    expect(rows[0].confirm_token_hash).not.toBe(await sha256Hex("wrong"));
    expect(await confirmWaitlist(token, deps.store)).toBe("confirmed");
    const after = await pool.query("select confirmed_at from waitlist");
    expect(after.rows[0].confirmed_at).not.toBeNull();
  });
});
