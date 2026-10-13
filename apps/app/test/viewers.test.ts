import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { investigations } from "@voidaccess/db";
import { createLocalDatabase } from "@voidaccess/db/local";
import { finishIngest } from "@/lib/runs/complete";
import { resetIngest, useNoopIngest } from "@/lib/runs/ingest";
import { openEventStream } from "@/lib/runs/sse";
import { markViewed, viewedRecently } from "@/lib/runs/viewers";
import { db, makeUser } from "./helpers";
import { appUrl, ownerUrl } from "./urls";

const sent = vi.hoisted(() => [] as { template: string; to: string }[]);
vi.mock("@voidaccess/emails", async (orig) => ({
  ...(await orig<typeof import("@voidaccess/emails")>()),
  sendEmail: vi.fn(async (template: string, to: string) => void sent.push({ template, to })),
}));

// "instance A" is a second, independent Database (own pools), like another Cloud Run instance would be;
// "instance B" is the module singleton the code under test uses.
const instanceA = createLocalDatabase(appUrl, { max: 2 });
afterAll(() => instanceA.close());
beforeEach(() => {
  sent.length = 0;
  useNoopIngest();
});

async function makeRun(userId: string, status: "running" | "ingesting" = "ingesting") {
  const id = randomUUID();
  await db().withSystem(
    "test.viewers.run",
    (tx) => tx.insert(investigations).values({ id, userId, query: "viewer test", depth: "quick", status }),
    { audit: false },
  );
  return id;
}
async function lastViewed(id: string): Promise<Date | null> {
  const pg = await import("pg");
  const c = new pg.default.Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    return (await c.query(`select last_viewed_at from investigations where id=$1`, [id])).rows[0]
      .last_viewed_at;
  } finally {
    await c.end();
  }
}
async function setLastViewed(id: string, sqlExpr: string) {
  const pg = await import("pg");
  const c = new pg.default.Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    await c.query(`update investigations set last_viewed_at = ${sqlExpr} where id=$1`, [id]);
  } finally {
    await c.end();
  }
}
const resultsEmails = () => sent.filter((e) => e.template === "resultsReady");

describe("H1-6: the viewer marker lives in the database", () => {
  it("the SSE stream records a view when it opens and at most every 30 s afterwards", async () => {
    const u = await makeUser();
    const id = await makeRun(u.id, "running");
    expect(await lastViewed(id)).toBeNull();
    const ctl = new AbortController();
    const res = await openEventStream(u.id, id, ctl.signal, -1);
    const reader = res.body!.getReader();
    await reader.read(); // retry hint
    await new Promise((r) => setTimeout(r, 400));
    const first = await lastViewed(id);
    expect(first).not.toBeNull();
    // two more poll ticks (1.5 s each) later it has NOT been rewritten: the throttle is 30 s
    await new Promise((r) => setTimeout(r, 3500));
    expect((await lastViewed(id))!.getTime()).toBe(first!.getTime());
    ctl.abort();
    await reader.cancel().catch(() => {});
  });

  it("a stream of someone else's run records nothing (404 before any write)", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const id = await makeRun(owner.id, "running");
    await expect(openEventStream(other.id, id, new AbortController().signal, -1)).rejects.toThrow();
    expect(await lastViewed(id)).toBeNull();
  });

  it("a view recorded by instance A is seen by instance B, and neither can rewrite it inside the throttle window", async () => {
    const u = await makeUser();
    const id = await makeRun(u.id);
    expect(await viewedRecently(id)).toBe(false);
    await markViewed(id, instanceA);
    expect(await viewedRecently(id)).toBe(true); // B sees A's view
    const t = await lastViewed(id);
    await markViewed(id); // B within 30 s: no write
    await markViewed(id, instanceA);
    expect((await lastViewed(id))!.getTime()).toBe(t!.getTime());
    await setLastViewed(id, `now() - interval '31 seconds'`);
    await markViewed(id); // past the throttle: refreshed
    expect((await lastViewed(id))!.getTime()).toBeGreaterThan(Date.now() - 5000);
  });

  it("results-ready email: skipped when another instance's viewer is active, sent after 60 s of silence or when nobody ever looked", async () => {
    // viewer on instance A just now -> instance B completes the run -> no email
    const u1 = await makeUser();
    const watched = await makeRun(u1.id);
    await markViewed(watched, instanceA);
    await finishIngest(watched);
    expect(resultsEmails()).toEqual([]);

    // the viewer left 90 s ago -> email
    const u2 = await makeUser();
    const left = await makeRun(u2.id);
    await setLastViewed(left, `now() - interval '90 seconds'`);
    await finishIngest(left);
    expect(resultsEmails()).toEqual([{ template: "resultsReady", to: u2.email }]);

    // boundary: 59 s ago still counts as watching, 61 s does not
    sent.length = 0;
    const u3 = await makeUser();
    const near = await makeRun(u3.id);
    await setLastViewed(near, `now() - interval '59 seconds'`);
    await finishIngest(near);
    expect(resultsEmails()).toEqual([]);
    const u4 = await makeUser();
    const far = await makeRun(u4.id);
    await setLastViewed(far, `now() - interval '61 seconds'`);
    await finishIngest(far);
    expect(resultsEmails()).toEqual([{ template: "resultsReady", to: u4.email }]);

    // never viewed -> email; and a viewer of a different run does not suppress it
    sent.length = 0;
    const u5 = await makeUser();
    const quiet = await makeRun(u5.id);
    await markViewed(await makeRun(u5.id), instanceA);
    await finishIngest(quiet);
    expect(resultsEmails()).toEqual([{ template: "resultsReady", to: u5.email }]);
  });
});

afterAll(() => resetIngest());
