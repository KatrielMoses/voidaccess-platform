import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { PlanId } from "@voidaccess/config";
import { ProgressEvent, signCallback } from "@voidaccess/engine-client";
import { adminGrant, creditLedger, getDatabase, investigations, users } from "@voidaccess/db";
import * as specRoute from "@/app/api/engine/runs/[id]/spec/route";
import * as eventsRoute from "@/app/api/engine/runs/[id]/events/route";
import * as bundleRoute from "@/app/api/engine/runs/[id]/artifacts/bundle/route";
import type { LaunchRequest, RunLauncher } from "@/lib/launcher";
import { deriveCallbackSecret } from "@/lib/runs/secrets";
import { setSessionUser, type TestSessionUser } from "./session-state";

export const APP = "http://localhost:3000";
export const db = () => getDatabase();

export async function makeUser(
  o: {
    plan?: PlanId;
    credits?: number;
    emailVerified?: boolean;
    status?: "active" | "suspended" | "banned";
    /** false: the user has not accepted the Acceptable Use Policy yet. */
    aupAccepted?: boolean;
  } = {},
): Promise<TestSessionUser> {
  const id = randomUUID();
  const u: TestSessionUser = {
    id,
    email: `${id}@test.local`,
    name: "Test " + id.slice(0, 4),
    emailVerified: o.emailVerified ?? true,
    role: "user",
    plan: o.plan ?? "pro",
    status: o.status ?? "active",
    aupAcceptedAt: o.aupAccepted === false ? null : new Date(),
  };
  await db().withSystem("test.makeUser", (tx) =>
    tx.insert(users).values({
      id,
      name: u.name,
      email: u.email,
      emailVerified: u.emailVerified,
      plan: u.plan,
      status: u.status,
      aupAcceptedAt: u.aupAcceptedAt,
    }),
  );
  if ((o.credits ?? 1000) > 0) await adminGrant(id, o.credits ?? 1000, id, "t:" + id);
  return u;
}

export const asUser = (u: TestSessionUser | null, sessionId?: string) => setSessionUser(u, sessionId);

export async function ledgerOf(investigationId: string) {
  return db().withSystem(
    "test.ledger",
    (tx) => tx.select().from(creditLedger).where(eq(creditLedger.investigationId, investigationId)),
    { audit: false },
  );
}
export async function balanceOf(userId: string): Promise<number> {
  const rows = await db().withSystem(
    "test.balance",
    (tx) =>
      tx
        .select({ id: creditLedger.id, a: creditLedger.amount })
        .from(creditLedger)
        .where(eq(creditLedger.userId, userId)),
    { audit: false },
  );
  return rows.reduce((a, r) => a + r.a, 0);
}
export async function runRow(id: string) {
  const [r] = await db().withSystem(
    "test.run",
    (tx) => tx.select().from(investigations).where(eq(investigations.id, id)),
    { audit: false },
  );
  return r;
}
export async function patchRun(id: string, patch: Partial<typeof investigations.$inferInsert>) {
  await db().withSystem(
    "test.patch",
    (tx) => tx.update(investigations).set(patch).where(eq(investigations.id, id)),
    {
      audit: false,
    },
  );
}

export async function waitFor<T>(fn: () => Promise<T | undefined | false>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 40));
  }
}
export const waitTerminal = (id: string) =>
  waitFor(async () => {
    const r = await runRow(id);
    return r && ["completed", "failed", "cancelled"].includes(r.status) ? r : undefined;
  });

/** Records launches; starts nothing (the test plays the engine by hand). */
export class StubLauncher implements RunLauncher {
  launches: LaunchRequest[] = [];
  cancels: string[] = [];
  async launch(req: LaunchRequest) {
    this.launches.push(req);
    return { executionId: `stub-${req.runId}` };
  }
  async cancel(id: string) {
    this.cancels.push(id);
  }
}

type RouteCtx = { params: Promise<{ id: string }> };
const ctxFor = (id: string): RouteCtx => ({ params: Promise.resolve({ id }) });

/** The mock engine's whole network: routed straight into the Next route handlers. */
export const routeFetch: typeof fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
  );
  const m = /^\/api\/engine\/runs\/([^/]+)\/(spec|events|artifacts\/bundle)$/.exec(url.pathname);
  if (!m) return new Response("no route", { status: 404 });
  const req = new Request(url, init);
  const id = m[1]!;
  if (m[2] === "spec") return specRoute.GET(req, ctxFor(id));
  if (m[2] === "events") return eventsRoute.POST(req, ctxFor(id));
  return bundleRoute.PUT(req, ctxFor(id));
};

export async function postEvent(
  runId: string,
  seq: number,
  ev: Partial<ProgressEvent> & { type: ProgressEvent["type"] },
  o: { secret?: string; timestamp?: number; headerRun?: string } = {},
) {
  const event = { run_id: runId, seq, at: new Date().toISOString(), stage_total: 8, ...ev };
  const raw = JSON.stringify(event);
  const headers = signCallback({
    secret: o.secret ?? deriveCallbackSecret(runId),
    runId: o.headerRun ?? runId,
    seq,
    rawBody: raw,
    timestamp: o.timestamp,
  });
  const res = await eventsRoute.POST(
    new Request(`${APP}/api/engine/runs/${runId}/events`, { method: "POST", body: raw, headers }),
    ctxFor(runId),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

export const call = {
  spec: (id: string, t?: string) =>
    specRoute.GET(
      new Request(`${APP}/api/engine/runs/${id}/spec${t === undefined ? "" : `?t=${t}`}`),
      ctxFor(id),
    ),
};

export const sameOrigin = { "sec-fetch-site": "same-origin", "content-type": "application/json" };
export { ctxFor };
