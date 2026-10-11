import { beforeAll, describe, expect, it } from "vitest";
import * as collection from "@/app/api/investigations/route";
import * as item from "@/app/api/investigations/[id]/route";
import * as cancelRoute from "@/app/api/investigations/[id]/cancel/route";
import * as sseRoute from "@/app/api/investigations/[id]/events/route";
import { setLauncher } from "@/lib/launcher";
import { startInvestigation } from "@/lib/runs/service";
import { APP, StubLauncher, asUser, call, ctxFor, makeUser, postEvent, runRow, sameOrigin } from "./helpers";
import type { TestSessionUser } from "./session-state";

const stub = new StubLauncher();
let A: TestSessionUser;
let B: TestSessionUser;
let active: string; // A's running investigation
let finished: string; // A's failed investigation
let activeToken: string;

const req = (path: string, method: string, body?: unknown, headers = sameOrigin) =>
  new Request(`${APP}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  setLauncher(stub);
  A = await makeUser();
  B = await makeUser();
  active = (await startInvestigation(A, { query: "A private query", depth: "quick" })).id;
  activeToken = new URL(stub.launches.find((l) => l.runId === active)!.specUrl).searchParams.get("t")!;
  await postEvent(active, 1, { type: "stage", stage: "refine", status: "start" });
  finished = (await startInvestigation(A, { query: "A finished query", depth: "quick" })).id;
  await postEvent(finished, 1, { type: "failed", reason: "error", stages_completed: [] });
});

describe("isolation: user B sees nothing of user A", () => {
  it("snapshot JSON, SSE, cancel, rename and delete are all 404 for B (and A is unharmed)", async () => {
    asUser(B);
    for (const id of [active, finished]) {
      expect((await item.GET(req(`/api/investigations/${id}`, "GET"), ctxFor(id))).status).toBe(404);
      expect((await sseRoute.GET(req(`/api/investigations/${id}/events`, "GET"), ctxFor(id))).status).toBe(
        404,
      );
      expect(
        (await cancelRoute.POST(req(`/api/investigations/${id}/cancel`, "POST"), ctxFor(id))).status,
      ).toBe(404);
      expect(
        (await item.PATCH(req(`/api/investigations/${id}`, "PATCH", { title: "pwned" }), ctxFor(id))).status,
      ).toBe(404);
      expect((await item.DELETE(req(`/api/investigations/${id}`, "DELETE"), ctxFor(id))).status).toBe(404);
    }
    // same status and body as a run that does not exist at all: nothing distinguishes "not yours" from "not there"
    const ghost = "00000000-0000-4000-8000-0000000000aa";
    const a = await item.GET(req(`/api/investigations/${active}`, "GET"), ctxFor(active));
    const g = await item.GET(req(`/api/investigations/${ghost}`, "GET"), ctxFor(ghost));
    expect(await a.json()).toEqual(await g.json());

    const r = (await runRow(active))!;
    expect(r.cancelRequestedAt).toBeNull();
    expect(r.title).toBeNull();
    expect((await runRow(finished))!.status).toBe("failed"); // not deleted
  });

  it("B's list is empty of A's runs; A's list has them", async () => {
    asUser(B);
    const b = (await (await collection.GET(req("/api/investigations", "GET"))).json()) as {
      items: unknown[];
      total: number;
    };
    expect(b.total).toBe(0);
    asUser(A);
    const a = (await (await collection.GET(req("/api/investigations", "GET"))).json()) as {
      items: { id: string }[];
    };
    expect(a.items.map((i) => i.id)).toEqual(expect.arrayContaining([active, finished]));
  });

  it("the spec URL is a capability: without A's token it is 404 for everyone, and a client-supplied user_id changes nothing", async () => {
    asUser(B);
    expect((await call.spec(active)).status).toBe(404);
    expect((await call.spec(active, "guess")).status).toBe(404);
    // a body that tries to name another user is ignored; the run is created for the session user
    const res = await collection.POST(
      req("/api/investigations", "POST", {
        query: "B owns this",
        depth: "quick",
        user_id: A.id,
        userId: A.id,
      }),
    );
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect((await runRow(id))!.userId).toBe(B.id);
    expect((await call.spec(active, activeToken)).status).toBe(200); // the real holder still gets it
  });

  it("unauthenticated requests are 401, not data", async () => {
    asUser(null);
    expect((await item.GET(req(`/api/investigations/${active}`, "GET"), ctxFor(active))).status).toBe(401);
    expect(
      (await sseRoute.GET(req(`/api/investigations/${active}/events`, "GET"), ctxFor(active))).status,
    ).toBe(401);
    expect((await collection.GET(req("/api/investigations", "GET"))).status).toBe(401);
  });

  it("a suspended account is refused", async () => {
    const s = await makeUser({ status: "suspended" });
    asUser(s);
    expect(
      (await collection.POST(req("/api/investigations", "POST", { query: "hello world", depth: "quick" })))
        .status,
    ).toBe(403);
  });
});

describe("CSRF: mutating routes require a same-origin request", () => {
  it("rejects missing, cross-site and foreign-Origin requests; accepts same-origin and APP_URL Origin", async () => {
    asUser(A);
    const body = { query: "csrf check query", depth: "quick" };
    const attempt = (headers: Record<string, string>) =>
      collection.POST(
        new Request(`${APP}/api/investigations`, {
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
          body: JSON.stringify(body),
        }),
      );
    expect((await attempt({})).status).toBe(403);
    expect((await attempt({ "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await attempt({ "sec-fetch-site": "same-site" })).status).toBe(403);
    expect((await attempt({ origin: "https://evil.example" })).status).toBe(403);
    expect((await attempt({ origin: APP })).status).toBe(201);
    expect((await attempt({ "sec-fetch-site": "same-origin" })).status).toBe(201);
    // PATCH / DELETE / cancel are guarded the same way
    expect(
      (
        await item.PATCH(
          new Request(`${APP}/x`, {
            method: "PATCH",
            body: "{}",
            headers: { "sec-fetch-site": "cross-site" },
          }),
          ctxFor(active),
        )
      ).status,
    ).toBe(403);
    expect((await item.DELETE(new Request(`${APP}/x`, { method: "DELETE" }), ctxFor(active))).status).toBe(
      403,
    );
    expect((await cancelRoute.POST(new Request(`${APP}/x`, { method: "POST" }), ctxFor(active))).status).toBe(
      403,
    );
  });
});
