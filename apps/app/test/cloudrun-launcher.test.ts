import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { investigations } from "@voidaccess/db";
import { setLauncher } from "@/lib/launcher";
import { CloudRunLauncher, LaunchError } from "@/lib/launcher/cloudrun";
import { startInvestigation } from "@/lib/runs/service";
import { balanceOf, db, makeUser } from "./helpers";

const EXEC = "projects/voidaccess-cloud/locations/us-central1/jobs/va-runner/executions/va-runner-x7k2p";
const API = "https://run.googleapis.com/v2";
const req = {
  runId: "0b7a6e5c-1f2d-4a3b-8c9d-0e1f2a3b4c5d",
  specUrl: "https://app.example.test/api/engine/runs/0b7a6e5c/spec?t=SINGLE-USE-TOKEN",
  deadlineAt: "2026-10-12T12:30:00.000Z",
};

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeApi(responder: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    return responder(call);
  };
  return { calls, fetchImpl };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const launcher = (fetchImpl: typeof fetch) =>
  new CloudRunLauncher({ fetchImpl, tokenProvider: async () => "tok-abc" });

describe("CloudRunLauncher.launch (jobs.run)", () => {
  it("POSTs the run request with only SPEC_URL, RUN_ID and DEADLINE_AT, and returns the execution name", async () => {
    const api = fakeApi(() =>
      ok({ name: "projects/p/locations/l/operations/op1", metadata: { name: EXEC } }),
    );
    const out = await launcher(api.fetchImpl).launch(req);
    expect(out).toEqual({ executionId: EXEC });
    const [c] = api.calls;
    expect(c!.url).toBe(`${API}/projects/voidaccess-cloud/locations/us-central1/jobs/va-runner:run`);
    expect(c!.method).toBe("POST");
    expect(c!.headers.authorization).toBe("Bearer tok-abc");
    expect(c!.body).toEqual({
      overrides: {
        taskCount: 1,
        containerOverrides: [
          {
            env: [
              { name: "SPEC_URL", value: req.specUrl },
              { name: "RUN_ID", value: req.runId },
              { name: "DEADLINE_AT", value: req.deadlineAt },
            ],
          },
        ],
      },
    });
  });

  it("maps API failures to a LaunchError that carries the status but never the spec URL", async () => {
    const denied = fakeApi(
      () =>
        new Response(
          JSON.stringify({
            error: { code: 403, status: "PERMISSION_DENIED", message: `denied for ${req.specUrl}` },
          }),
          { status: 403 },
        ),
    );
    const e = await launcher(denied.fetchImpl)
      .launch(req)
      .catch((x) => x);
    expect(e).toBeInstanceOf(LaunchError);
    expect(e).toMatchObject({ httpStatus: 403, code: "PERMISSION_DENIED" });
    expect(e.message).toContain("403 PERMISSION_DENIED");
    expect(e.message).not.toContain("SINGLE-USE-TOKEN");

    const down = fakeApi(() => {
      throw new TypeError("fetch failed");
    });
    await expect(launcher(down.fetchImpl).launch(req)).rejects.toThrow(/unreachable/);

    const errOp = fakeApi(() => ok({ done: true, error: { status: "RESOURCE_EXHAUSTED" } }));
    await expect(launcher(errOp.fetchImpl).launch(req)).rejects.toThrow(/RESOURCE_EXHAUSTED/);

    const noName = fakeApi(() => ok({ name: "op" }));
    await expect(launcher(noName.fetchImpl).launch(req)).rejects.toThrow(/no execution name/);
  });

  it("a failed launch through the service is a clean failure with a full refund, and the query never reaches the API", async () => {
    const QUERY = "unique secret query about Cl0p";
    const api = fakeApi(
      () => new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), { status: 503 }),
    );
    setLauncher(launcher(api.fetchImpl));
    try {
      const u = await makeUser({ credits: 100 });
      const r = await startInvestigation(u, { query: QUERY, depth: "standard" });
      expect(r.status).toBe("failed");
      expect(await balanceOf(u.id)).toBe(100);
      const [row] = await db().withSystem(
        "t",
        (tx) => tx.select().from(investigations).where(eq(investigations.id, r.id)),
        { audit: false },
      );
      expect(row!.failureReason).toBe("launcher_failure");
      expect(JSON.stringify(api.calls)).not.toContain("secret query");
    } finally {
      setLauncher(null);
    }
  });

  it("a successful launch through the service stores the execution id and sends no query", async () => {
    const QUERY = "another unique secret query";
    const api = fakeApi(() => ok({ metadata: { name: EXEC } }));
    setLauncher(launcher(api.fetchImpl));
    try {
      const u = await makeUser({ credits: 100 });
      const r = await startInvestigation(u, { query: QUERY, depth: "quick" });
      expect(r.status).toBe("launching");
      const [row] = await db().withSystem(
        "t",
        (tx) => tx.select().from(investigations).where(eq(investigations.id, r.id)),
        { audit: false },
      );
      expect(row!.executionId).toBe(EXEC);
      const sent = JSON.stringify(api.calls);
      expect(sent).not.toContain("unique secret query");
      expect(Object.keys(api.calls[0]!.body as object)).toEqual(["overrides"]);
    } finally {
      setLauncher(null);
    }
  });
});

describe("CloudRunLauncher.cancel (executions.cancel)", () => {
  it("POSTs to the execution's :cancel", async () => {
    const api = fakeApi(() => ok({ name: "op" }));
    await launcher(api.fetchImpl).cancel(EXEC);
    expect(api.calls[0]).toMatchObject({ url: `${API}/${EXEC}:cancel`, method: "POST" });
    expect(api.calls[0]!.headers.authorization).toBe("Bearer tok-abc");
  });

  it("treats an execution that is already gone or finished as cancelled", async () => {
    const gone = fakeApi(
      () => new Response(JSON.stringify({ error: { status: "NOT_FOUND" } }), { status: 404 }),
    );
    await expect(launcher(gone.fetchImpl).cancel(EXEC)).resolves.toBeUndefined();
    const done = fakeApi(
      () => new Response(JSON.stringify({ error: { status: "FAILED_PRECONDITION" } }), { status: 400 }),
    );
    await expect(launcher(done.fetchImpl).cancel(EXEC)).resolves.toBeUndefined();
  });

  it("surfaces other errors and refuses names that are not executions", async () => {
    const denied = fakeApi(
      () => new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED" } }), { status: 403 }),
    );
    await expect(launcher(denied.fetchImpl).cancel(EXEC)).rejects.toThrow(/403/);
    await expect(launcher(denied.fetchImpl).cancel("mock-123")).rejects.toThrow(/not a Cloud Run execution/);
    await expect(launcher(denied.fetchImpl).cancel("projects/x/../../evil")).rejects.toThrow();
    expect(denied.calls).toHaveLength(1);
  });
});
