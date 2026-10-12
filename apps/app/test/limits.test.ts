import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DEPTHS } from "@voidaccess/config";
import { investigations } from "@voidaccess/db";
import { DAILY_RUN_CAP, MAX_CONCURRENT_RUNS } from "@/lib/limits";
import { setLauncher } from "@/lib/launcher";
import { RunError } from "@/lib/runs/errors";
import { startInvestigation } from "@/lib/runs/service";
import { StubLauncher, balanceOf, db, makeUser, postEvent } from "./helpers";

const stub = new StubLauncher();
setLauncher(stub);

const fail = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof RunError) return e;
    throw e;
  }
  throw new Error("expected a RunError");
};
const countRuns = async (userId: string) =>
  (
    await db().withSystem(
      "t",
      (tx) => tx.select().from(investigations).where(eq(investigations.userId, userId)),
      { audit: false },
    )
  ).length;

describe("reserve under concurrency", () => {
  it("20 parallel starts on a balance covering exactly 2 runs create exactly 2 runs and never go negative", async () => {
    const u = await makeUser({ plan: "pro_plus", credits: 80 }); // 2 x standard (40)
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        startInvestigation(u, { query: `parallel query ${i}`, depth: "standard" }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(2);
    expect(rejected).toHaveLength(18);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(RunError);
      expect((r.reason as RunError).code).toBe("insufficient_credits");
      expect((r.reason as RunError).details).toMatchObject({ needed: 40, balance: 0 });
    }
    expect(await balanceOf(u.id)).toBe(0);
    expect(await countRuns(u.id)).toBe(2); // the rejected ones rolled back with their transaction: no orphan rows
    expect(
      stub.launches.filter((l) =>
        ok.some((o) => (o as PromiseFulfilledResult<{ id: string }>).value.id === l.runId),
      ),
    ).toHaveLength(2);
  });

  it("the price charged is exactly DEPTHS[depth].credits; a too-low balance gives a clear typed error", async () => {
    const u = await makeUser({ credits: 30 });
    const e = await fail(startInvestigation(u, { query: "needs forty credits", depth: "standard" }));
    expect(e.code).toBe("insufficient_credits");
    expect(e.status).toBe(402);
    expect(e.details).toEqual({ balance: 30, needed: DEPTHS.standard.credits });
    expect(await balanceOf(u.id)).toBe(30);
    const q = await startInvestigation(u, { query: "needs twenty credits", depth: "quick" });
    expect(q.creditsCharged).toBe(DEPTHS.quick.credits);
    expect(await balanceOf(u.id)).toBe(10);
  });
});

describe("rate limits and gates", () => {
  it(`allows ${MAX_CONCURRENT_RUNS} concurrent runs and blocks the next; a finished run frees a slot`, async () => {
    const u = await makeUser({ credits: 2000 });
    const ids: string[] = [];
    for (let i = 0; i < MAX_CONCURRENT_RUNS; i++)
      ids.push((await startInvestigation(u, { query: `concurrent ${i}`, depth: "quick" })).id);
    const before = await balanceOf(u.id);
    const e = await fail(startInvestigation(u, { query: "one too many", depth: "quick" }));
    expect(e.code).toBe("rate_limited_concurrent");
    expect(e.status).toBe(429);
    expect(await balanceOf(u.id)).toBe(before); // nothing reserved
    await postEvent(ids[0]!, 1, { type: "failed", reason: "error", stages_completed: [] });
    expect((await startInvestigation(u, { query: "now there is room", depth: "quick" })).status).toBe(
      "launching",
    );
  });

  it("enforces the per-plan daily cap over a rolling 24 hours", async () => {
    const u = await makeUser({ plan: "free", credits: 500 });
    const cap = DAILY_RUN_CAP.free;
    await db().withSystem("t", (tx) =>
      tx.insert(investigations).values(
        Array.from({ length: cap }, (_, i) => ({
          userId: u.id,
          query: `old ${i}`,
          depth: "quick" as const,
          status: "completed" as const,
          createdAt: new Date(Date.now() - (i === 0 ? 25 * 3_600_000 : 3_600_000)),
        })),
      ),
    );
    // one of the `cap` rows is older than 24h, so one slot is free
    expect((await startInvestigation(u, { query: "last allowed run", depth: "quick" })).status).toBe(
      "launching",
    );
    await postEvent(
      (
        await db().withSystem(
          "t",
          (tx) =>
            tx
              .select()
              .from(investigations)
              .where(eq(investigations.userId, u.id))
              .orderBy(investigations.createdAt),
          { audit: false },
        )
      ).at(-1)!.id,
      1,
      { type: "failed", reason: "error", stages_completed: [] },
    );
    const e = await fail(startInvestigation(u, { query: "over the cap", depth: "quick" }));
    expect(e.code).toBe("rate_limited_daily");
    expect(e.details).toEqual({ limit: cap });
  });

  it("blocks unverified emails before anything is written (session flag and the database row)", async () => {
    const u = await makeUser({ emailVerified: false, credits: 100 });
    const e = await fail(startInvestigation(u, { query: "unverified user query", depth: "quick" }));
    expect(e.code).toBe("unverified_email");
    expect(await countRuns(u.id)).toBe(0);
    expect(await balanceOf(u.id)).toBe(100);
    // a stale session claiming verified is not enough: the database row is authoritative
    const stale = await fail(
      startInvestigation({ ...u, emailVerified: true }, { query: "stale session query", depth: "quick" }),
    );
    expect(stale.code).toBe("unverified_email");
    expect(await countRuns(u.id)).toBe(0);
  });

  it("validates the query and the depth", async () => {
    const u = await makeUser();
    expect((await fail(startInvestigation(u, { query: "  ab  ", depth: "quick" }))).code).toBe(
      "invalid_query",
    );
    expect((await fail(startInvestigation(u, { query: "x".repeat(501), depth: "quick" }))).code).toBe(
      "invalid_query",
    );
    expect((await fail(startInvestigation(u, { query: 42, depth: "quick" }))).code).toBe("invalid_query");
    expect((await fail(startInvestigation(u, { query: "valid query", depth: "deep" }))).code).toBe(
      "depth_unavailable",
    );
    expect((await fail(startInvestigation(u, { query: "valid query", depth: "bogus" }))).code).toBe(
      "depth_unavailable",
    );
    expect((await fail(startInvestigation(u, { query: "valid query", depth: "__proto__" }))).code).toBe(
      "depth_unavailable",
    );
    const trimmed = await startInvestigation(u, { query: "   padded query   ", depth: "quick" });
    expect(trimmed.status).toBe("launching");
    expect(await countRuns(u.id)).toBe(1);
    expect(
      (await fail(startInvestigation({ ...u, status: "banned" }, { query: "valid query", depth: "quick" })))
        .code,
    ).toBe("account_inactive");
  });

  it("a launcher failure marks the run failed and refunds in full", async () => {
    const boom = {
      launch: async () => {
        throw new Error("cloud run unavailable");
      },
      cancel: async () => {},
    };
    setLauncher(boom);
    try {
      const u = await makeUser({ credits: 100 });
      const r = await startInvestigation(u, { query: "launcher will fail", depth: "standard" });
      expect(r.status).toBe("failed");
      expect(await balanceOf(u.id)).toBe(100);
      const row = (
        await db().withSystem(
          "t",
          (tx) => tx.select().from(investigations).where(eq(investigations.id, r.id)),
          { audit: false },
        )
      )[0]!;
      expect(row.failureReason).toBe("launcher_failure");
      expect(row.creditsCharged).toBe(0);
    } finally {
      setLauncher(stub);
    }
  });
});
