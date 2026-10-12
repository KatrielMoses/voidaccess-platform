import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { archiveRun, enqueueArchive, processArchiveQueue } from "@voidaccess/archive";
import { makeBundle, memoryDeps, onion } from "@voidaccess/archive/test-support";
import { GET as archiveGET } from "@/app/api/investigations/[id]/archive/route";
import { GET as graphGET } from "@/app/api/investigations/[id]/archive/graph/route";
import { GET as entitiesGET } from "@/app/api/investigations/[id]/entities/route";
import { POST as cronPOST } from "@/app/api/cron/archive/route";
import { MockLauncher, setLauncher } from "@/lib/launcher";
import { archiveDepsFor } from "@/lib/archive/deps";
import { resetIngest } from "@/lib/runs/ingest";
import { startInvestigation } from "@/lib/runs/service";
import {
  asUser,
  balanceOf,
  db,
  ledgerOf,
  makeUser as makeSessionUser,
  routeFetch,
  runRow,
  waitTerminal,
} from "./helpers";
import { appDb, makeUser as makeRawUser, ownerPool, seedInvestigation } from "./results-helpers";

beforeAll(async () => {
  await ownerPool().query(
    "truncate archive_observations, archive_relationship_sources, archive_relationships, archive_aliases, archive_entities, archive_sources, archive_removed_pages, archive_jobs cascade",
  );
});

const A_QUERY = "zebra-moonlight-private-query-A";
const leak = onion("leak", "/posts/northwind");
// run 1 (user A): a ransomware-group investigation whose leak-site page mentions the fictional Northwind Traders
const run1 = () =>
  makeBundle({
    runId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
    query: A_QUERY,
    sources: [
      {
        id: "s1",
        url: leak,
        fetchedAt: "2026-03-02T09:00:00Z",
        excerpt: "Leak site post listing Northwind Traders.",
      },
    ],
    entities: [
      { id: "g", type: "RANSOMWARE_GROUP", value: "BlackCat", sources: ["s1"] },
      { id: "o", type: "ORGANIZATION_NAME", value: "Northwind Traders", sources: ["s1"] },
    ],
    relationships: [{ a: "g", b: "o", evidence: ["s1"] }],
  });
// run 2 (user B), later: the organisation, from a news article
const run2 = () =>
  makeBundle({
    runId: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
    query: "Northwind Traders",
    sources: [
      {
        id: "n1",
        url: "https://www.example-news.test/northwind",
        fetchedAt: "2026-04-10T12:00:00Z",
        kind: "paste",
      },
    ],
    entities: [
      { id: "o2", type: "ORGANIZATION_NAME", value: "Northwind Traders Inc", sources: ["n1"] },
      { id: "z", type: "ORGANIZATION_NAME", value: "Fabrikam", sources: ["n1"] },
    ],
    relationships: [{ a: "o2", b: "z", evidence: ["n1"] }],
  });

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (path: string) => new Request(`http://localhost${path}`);

describe("archive enrichment through the real routes", () => {
  it("user B's search of the organisation shows the group as a lead from user A's earlier run, and none of A's private data; A's id is a 404 for B", async () => {
    const a = await makeRawUser("pro");
    const b = await makeRawUser("pro");
    const invA = await seedInvestigation(a, run1());
    const invB = await seedInvestigation(b, run2());
    await archiveRun(invA, memoryDeps(run1(), null), { database: appDb() });
    await archiveRun(invB, memoryDeps(run2(), null), { database: appDb() });

    asUser({
      id: b,
      email: "b@test.local",
      name: "B",
      emailVerified: true,
      role: "user",
      plan: "pro",
      status: "active",
      aupAcceptedAt: new Date(),
    });
    const res = await archiveGET(get(`/api/investigations/${invB}/archive`), ctx(invB));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.seen.o2).toMatchObject({
      display: "Northwind Traders",
      independentSources: 1,
      tier: "unconfirmed",
      firstSeen: "2026-03-02T09:00:00.000Z",
    });
    expect(body.seen.z).toBeUndefined(); // only B's own run ever saw Fabrikam
    expect(body.totals).toMatchObject({ entities: 2, seenBefore: 1, newToArchive: 1 });
    const group = body.neighbours.find((n: { display: string }) => n.display === "ALPHV");
    expect(group.relationship).toMatchObject({ type: "CO_APPEARED_ON", evidence: 1, tier: "unconfirmed" });
    const raw = JSON.stringify(body);
    for (const privateThing of [a, invA, A_QUERY, "zebra-moonlight", "aaaaaaaa-1111"])
      expect(raw).not.toContain(privateThing);

    const g = await (
      await graphGET(get(`/api/investigations/${invB}/archive/graph?hops=1`), ctx(invB))
    ).json();
    expect(g.nodes.map((n: { label: string }) => n.label)).toContain("ALPHV");
    expect(JSON.stringify(g)).not.toContain(a);

    // the entities filter: only what the archive has not seen from elsewhere / only what it has
    const only = async (q: string) =>
      (
        (await (
          await entitiesGET(get(`/api/investigations/${invB}/entities?archive=${q}`), ctx(invB))
        ).json()) as { rows: { displayValue: string }[] }
      ).rows.map((r) => r.displayValue);
    expect(await only("seen")).toEqual(["Northwind Traders Inc"]);
    expect(await only("new")).toEqual(["Fabrikam"]);

    // B cannot ask about A's investigation, on any archive route
    for (const [fn, path] of [
      [archiveGET, `/api/investigations/${invA}/archive`],
      [graphGET, `/api/investigations/${invA}/archive/graph`],
      [entitiesGET, `/api/investigations/${invA}/entities?archive=new`],
    ] as const) {
      expect((await fn(get(path), ctx(invA))).status, path).toBe(404);
    }
    asUser(null);
    expect((await archiveGET(get(`/api/investigations/${invB}/archive`), ctx(invB))).status).toBe(401);
  });

  it("A's own view of run 1 doesn't count its own sources as 'seen before'", async () => {
    await ownerPool().query(
      "truncate archive_observations, archive_relationship_sources, archive_relationships, archive_aliases, archive_entities, archive_sources, archive_removed_pages, archive_jobs cascade",
    );
    const a = await makeRawUser("pro");
    const inv = await seedInvestigation(a, run1());
    await archiveRun(inv, memoryDeps(run1(), null), { database: appDb() }); // already filed, as the worker would
    asUser({
      id: a,
      email: "a@test.local",
      name: "A",
      emailVerified: true,
      role: "user",
      plan: "pro",
      status: "active",
      aupAcceptedAt: new Date(),
    });
    const body = await (await archiveGET(get(`/api/investigations/${inv}/archive`), ctx(inv))).json();
    expect(body.totals.seenBefore).toBe(0);
    expect(body.neighbours).toEqual([]);
    asUser(null);
  });
});

describe("the archive never puts a user's run at risk (guarantee 5)", () => {
  let mock: MockLauncher;
  beforeEach(() => {
    mock = new MockLauncher({ mode: "success", durationMs: 600, fetchImpl: routeFetch });
    setLauncher(mock);
  });
  afterEach(async () => {
    await mock?.whenIdle();
    setLauncher(null);
    resetIngest();
  });

  it("a completed run enqueues exactly one job; an archive failure leaves the run completed and the ledger untouched, and the job retries", async () => {
    const u = await makeSessionUser({ credits: 500 });
    const { id } = await startInvestigation(u, { query: "Cl0p MOVEit", depth: "quick" });
    const run = await waitTerminal(id);
    expect(run.status).toBe("completed");
    const jobs = async () =>
      (
        await ownerPool().query("select run_id, attempts, last_error from archive_jobs where run_id = $1", [
          id,
        ])
      ).rows;
    expect(await jobs()).toHaveLength(1);
    await enqueueArchive(id, appDb()); // a second enqueue is a no-op
    expect(await jobs()).toHaveLength(1);

    const ledgerBefore = JSON.stringify(await ledgerOf(id));
    const balanceBefore = await balanceOf(u.id);
    const r = await processArchiveQueue({
      database: db(),
      depsFor: () => {
        throw new Error("archive bucket unavailable");
      },
      batch: 50,
    });
    expect(r.failed).toBeGreaterThanOrEqual(1);
    const after = await runRow(id);
    expect(after!.status).toBe("completed");
    expect(after!.failureReason).toBeNull();
    expect(JSON.stringify(await ledgerOf(id))).toBe(ledgerBefore);
    expect(await balanceOf(u.id)).toBe(balanceBefore);
    expect((await jobs())[0]).toMatchObject({ attempts: 1, last_error: "archive bucket unavailable" });

    // once the dependency recovers, the retry (after its backoff) archives the run from the mock artifact store and deletes the job
    const later = new Date(Date.now() + 5 * 60_000);
    const ok = await processArchiveQueue({
      database: db(),
      depsFor: () => archiveDepsFor(),
      batch: 50,
      now: () => later,
    });
    expect(ok.processed).toBeGreaterThanOrEqual(1);
    expect(await jobs()).toHaveLength(0);
    expect(
      (await ownerPool().query("select count(*)::int n from archive_entities")).rows[0].n,
    ).toBeGreaterThan(100);
    expect((await runRow(id))!.status).toBe("completed");
  });

  it("the cron route authenticates like the others and processes the queue within bounds", async () => {
    const secret = process.env.CRON_SHARED_SECRET!;
    const req = (auth?: string) =>
      new Request("http://localhost/api/cron/archive", {
        method: "POST",
        headers: auth ? { authorization: auth } : {},
      });
    expect((await cronPOST(req())).status).toBe(401);
    expect((await cronPOST(req("Bearer wrong"))).status).toBe(401);
    const ok = await cronPOST(req(`Bearer ${secret}`));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ processed: expect.any(Number), failed: expect.any(Number) });
  });
});
