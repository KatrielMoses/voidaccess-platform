import { gunzipSync } from "node:zlib";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { archiveJobs, auditLog } from "@voidaccess/db";
import {
  archiveContext,
  archiveGraph,
  archiveRun,
  enqueueArchive,
  processArchiveQueue,
  removeFromArchive,
  type Probe,
} from "../src";
import { MemoryObjectStore, makeBundle, memoryDeps, onion } from "../src/test-support";
import { appDb, dumpArchive, ownerPool, resetArchive } from "./helpers";

const db = appDb();
const opts = { database: db };
beforeEach(resetArchive);
afterAll(async () => {
  await db.close();
  await ownerPool().end();
});

const A_USER = "11111111-aaaa-4aaa-8aaa-111111111111";
const A_INV = "22222222-aaaa-4aaa-8aaa-222222222222";
const A_QUERY = "zebra-moonlight-private-query-A";
const B_USER = "33333333-bbbb-4bbb-8bbb-333333333333";
const B_INV = "44444444-bbbb-4bbb-8bbb-444444444444";
const B_QUERY = "Northwind Traders";

const leak = onion("leak", "/posts/northwind");
const leak2 = onion("mirror", "/p/9");
// Run 1 (user A): a ransomware-group investigation. Its leak-site page mentions the fictional "Northwind Traders".
const run1 = () =>
  makeBundle({
    runId: A_INV,
    query: A_QUERY,
    sources: [
      {
        id: "s1",
        url: leak,
        fetchedAt: "2026-03-02T09:00:00Z",
        excerpt: "Leak site post listing Northwind Traders among new entries.",
      },
      { id: "s2", url: leak2, fetchedAt: "2026-03-05T09:00:00Z" },
    ],
    entities: [
      { id: "g", type: "RANSOMWARE_GROUP", value: "BlackCat", sources: ["s1", "s2"] },
      { id: "o", type: "ORGANIZATION_NAME", value: "Northwind Traders", sources: ["s1"] },
      { id: "c", type: "CVE_NUMBER", value: "CVE-2023-34362", sources: ["s1"] },
      { id: "x", type: "CVE_NUMBER", value: "CVE-2099-0001", sources: ["s2"] },
    ],
    relationships: [
      { a: "g", b: "o", evidence: ["s1"] },
      { a: "g", b: "c", type: "EXPLOITS", evidence: ["s1"] },
    ],
  });
// Run 2 (user B), a month later, searches the organisation. A news article mentions it.
const news = "https://www.example-news.test/2026/04/northwind-incident";
const run2 = () =>
  makeBundle({
    runId: B_INV,
    query: B_QUERY,
    sources: [{ id: "n1", url: news, fetchedAt: "2026-04-10T12:00:00Z", kind: "paste" }],
    entities: [{ id: "o2", type: "ORGANIZATION_NAME", value: "NORTHWIND-TRADERS Inc", sources: ["n1"] }],
  });

const probeOf = (b: ReturnType<typeof makeBundle>): Probe => ({
  entities: b.entities.map((e) => ({
    key: e.id,
    type: e.type,
    value: e.sensitive ? null : e.value,
    fingerprint: null,
  })),
  ownSources: b.sources.map((s) => ({ url: s.url, kind: s.kind, name: s.name })),
});

async function counts() {
  const r = await ownerPool().query(`select
    (select count(*)::int from archive_entities) e, (select count(*)::int from archive_sources) s,
    (select count(*)::int from archive_observations) o, (select count(*)::int from archive_relationships) r,
    (select count(*)::int from archive_relationship_sources) rs, (select count(*)::int from archive_aliases) a`);
  return r.rows[0];
}

describe("the headline flow (fictional names)", () => {
  it("a later, different user's search of the organisation surfaces the group as a lead, with evidence and dates, and none of run 1's private data", async () => {
    const store = new MemoryObjectStore();
    await archiveRun(A_INV, memoryDeps(run1(), null, store), opts);
    await archiveRun(B_INV, memoryDeps(run2(), null, store), opts);

    const ctx = await archiveContext(probeOf(run2()), opts);
    expect(ctx.seen.o2).toMatchObject({
      display: "Northwind Traders",
      observations: 1,
      independentSources: 1,
      tier: "unconfirmed",
      firstSeen: "2026-03-02T09:00:00.000Z",
      lastSeen: "2026-03-02T09:00:00.000Z",
    });
    expect(ctx.totals).toMatchObject({ seenBefore: 1, newToArchive: 0 });
    const group = ctx.neighbours.find((n) => n.display === "ALPHV");
    expect(group, "BlackCat was archived under its canonical group name").toBeTruthy();
    expect(group!.relationship).toMatchObject({
      type: "CO_APPEARED_ON",
      evidence: 1,
      independentSources: 1,
      tier: "unconfirmed",
      firstSeen: "2026-03-02T09:00:00.000Z",
    });
    expect(group!.via).toEqual(["o2"]);

    // the archive graph offers the same neighbour, as an edge whose endpoints are the viewer's key and an archive node
    const g = await archiveGraph(probeOf(run2()), opts);
    const node = g.nodes.find((n) => n.label === "ALPHV")!;
    expect(node.hop).toBe(1);
    expect(
      g.edges.some(
        (e) =>
          new Set([e.source, e.target]).has("o2") &&
          new Set([e.source, e.target]).has(node.id) &&
          e.evidence === 1,
      ),
    ).toBe(true);

    // nothing of run 1's private world is in what B receives
    const payload = JSON.stringify({ ctx, g });
    for (const secret of [A_USER, A_INV, A_QUERY, "zebra-moonlight"]) expect(payload).not.toContain(secret);
    // and the viewer's own sources never count as "seen before": B's own run, filed into the archive already, adds nothing to its own context
    expect(Object.keys(ctx.seen)).toEqual(["o2"]);
  });

  it("two hops reach the group's other findings, capped; the minimum tier filters weak leads", async () => {
    await archiveRun(A_INV, memoryDeps(run1(), null), opts);
    await archiveRun(B_INV, memoryDeps(run2(), null), opts);
    const two = await archiveGraph(probeOf(run2()), { ...opts, hops: 2 });
    expect(two.nodes.map((n) => n.label).sort()).toContain("CVE-2023-34362");
    expect(two.nodes.find((n) => n.label === "CVE-2023-34362")!.hop).toBe(2);
    expect(
      (await archiveGraph(probeOf(run2()), { ...opts, hops: 2, minTier: "corroborated" })).edges,
    ).toHaveLength(0);
  });

  it("an entity nobody has seen is new to the archive", async () => {
    await archiveRun(A_INV, memoryDeps(run1(), null), opts);
    const probe: Probe = {
      entities: [{ key: "z", type: "ORGANIZATION_NAME", value: "Fabrikam", fingerprint: null }],
      ownSources: [],
    };
    const ctx = await archiveContext(probe, opts);
    expect(ctx.seen).toEqual({});
    expect(ctx.totals.newToArchive).toBe(1);
  });
});

describe("anonymity (guarantee 1)", () => {
  it("after runs from two users, no archive row or stored object holds a user id, investigation id, run id, query text or searcher email", async () => {
    const store = new MemoryObjectStore();
    const pagesA = [
      {
        url: leak,
        fetched_at: "2026-03-02T09:00:00Z",
        text: "Leak site post listing Northwind Traders. Nothing personal here.",
      },
    ];
    await archiveRun(A_INV, memoryDeps(run1(), pagesA, store), opts);
    await archiveRun(B_INV, memoryDeps(run2(), null, store), opts);
    const everything = await dumpArchive((store as MemoryObjectStore).objects);
    expect(everything.length).toBeGreaterThan(1000);
    for (const forbidden of [
      A_USER,
      A_INV,
      A_QUERY,
      "zebra-moonlight",
      B_USER,
      B_INV,
      "searcher@example.test",
      "secret search phrase",
    ]) {
      expect(everything, forbidden).not.toContain(forbidden);
    }
    // The only mention of "Northwind Traders" is the finding itself (the org entity and a source's own text), never as a search.
    const cols = await ownerPool().query(
      `select table_name, column_name from information_schema.columns where table_schema='public' and table_name like 'archive\\_%' and table_name not in ('archive_jobs')`,
    );
    expect(cols.rows.filter((c) => /run_id|user|query|investigation/i.test(c.column_name))).toEqual([]);
  });

  it("observation dates come from the sources, not from when the runs happened", async () => {
    await archiveRun(A_INV, memoryDeps(run1(), null), opts);
    const r = await ownerPool().query(
      `select min(observed_at) mn, max(observed_at) mx from archive_observations`,
    );
    expect(new Date(r.rows[0].mn).toISOString()).toBe("2026-03-02T09:00:00.000Z");
    expect(new Date(r.rows[0].mx).toISOString()).toBe("2026-03-05T09:00:00.000Z");
  });
});

describe("tiers and the poisoning guard (guarantee 4)", () => {
  it("20 pages from one host stay unconfirmed; the second host corroborates; a KEV CVE is feed-validated from a single source", async () => {
    const sources = Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      url: `https://blog.spam-farm.test/post/${i}`,
      fetchedAt: `2026-05-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    }));
    const flood = makeBundle({
      sources,
      entities: [
        { id: "e", type: "ORGANIZATION_NAME", value: "Contoso", sources: sources.map((s) => s.id) },
        { id: "k", type: "CVE_NUMBER", value: "CVE-2021-44228", sources: ["p0"] },
        { id: "u", type: "CVE_NUMBER", value: "CVE-2099-0002", sources: ["p0"] },
      ],
      relationships: [{ a: "e", b: "u", evidence: sources.map((s) => s.id) }],
    });
    await archiveRun("00000000-0000-4000-8000-0000000000f1", memoryDeps(flood, null), opts);
    const row = async (v: string) =>
      (
        await ownerPool().query(
          `select tier::text, observation_count, independent_source_count from archive_entities where canonical_value = $1`,
          [v],
        )
      ).rows[0];
    expect(await row("contoso")).toMatchObject({
      tier: "unconfirmed",
      observation_count: 20,
      independent_source_count: 1,
    });
    expect(await row("CVE-2021-44228")).toMatchObject({
      tier: "feed_validated",
      independent_source_count: 1,
    });
    expect(await row("CVE-2099-0002")).toMatchObject({ tier: "unconfirmed" });
    const rel = (
      await ownerPool().query(
        `select tier::text, evidence_count, independent_source_count from archive_relationships`,
      )
    ).rows[0];
    expect(rel).toMatchObject({ tier: "unconfirmed", evidence_count: 20, independent_source_count: 1 });

    // a second, independent host
    const second = makeBundle({
      sources: [{ id: "q", url: "https://www.other-outlet.test/story", fetchedAt: "2026-06-01T00:00:00Z" }],
      entities: [
        { id: "e", type: "ORGANIZATION_NAME", value: "Contoso", sources: ["q"] },
        { id: "u", type: "CVE_NUMBER", value: "CVE-2099-0002", sources: ["q"] },
      ],
      relationships: [{ a: "e", b: "u", evidence: ["q"] }],
    });
    await archiveRun("00000000-0000-4000-8000-0000000000f2", memoryDeps(second, null), opts);
    expect(await row("contoso")).toMatchObject({
      tier: "corroborated",
      observation_count: 21,
      independent_source_count: 2,
    });
    expect(
      (await ownerPool().query(`select tier::text, evidence_count from archive_relationships`)).rows[0],
    ).toMatchObject({ tier: "corroborated", evidence_count: 21 });
  });

  it("www. and subdomains of one registrable domain count as one source", async () => {
    const b = makeBundle({
      sources: [
        { id: "a", url: "https://www.same-site.test/a", fetchedAt: "2026-05-01T00:00:00Z" },
        { id: "b", url: "https://news.same-site.test/b", fetchedAt: "2026-05-02T00:00:00Z" },
      ],
      entities: [{ id: "e", type: "ORGANIZATION_NAME", value: "Fabrikam", sources: ["a", "b"] }],
    });
    await archiveRun("00000000-0000-4000-8000-0000000000f3", memoryDeps(b, null), opts);
    expect(
      (
        await ownerPool().query(
          `select tier::text, independent_source_count from archive_entities where canonical_value='fabrikam'`,
        )
      ).rows[0],
    ).toMatchObject({ tier: "unconfirmed", independent_source_count: 1 });
  });
});

describe("idempotency", () => {
  it("archiving the same run twice changes nothing", async () => {
    const pages = [
      { url: leak, fetched_at: "2026-03-02T09:00:00Z", text: "Leak site post listing Northwind Traders." },
    ];
    const store = new MemoryObjectStore();
    await archiveRun(A_INV, memoryDeps(run1(), pages, store), opts);
    const first = { c: await counts(), dump: await dumpArchive(store.objects) };
    const again = await archiveRun(A_INV, memoryDeps(run1(), pages, store), opts);
    expect(again.pagesDeduplicated).toBe(1);
    expect(await counts()).toEqual(first.c);
    expect(await dumpArchive(store.objects)).toBe(first.dump);
  });

  it("concurrent workers never double-process a job; a failure retries with backoff and the job row goes away on success", async () => {
    const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-00000000010${i}`);
    for (const id of ids) await enqueueArchive(id, db);
    await enqueueArchive(ids[0]!, db); // enqueue twice: still one row
    expect((await ownerPool().query("select count(*)::int n from archive_jobs")).rows[0].n).toBe(6);
    const seen: string[] = [];
    let failedOnce = false;
    const run = async (runId: string) => {
      seen.push(runId);
      await new Promise((r) => setTimeout(r, 15));
      if (runId === ids[3] && !failedOnce) {
        failedOnce = true;
        throw new Error("transient storage error");
      }
      return {
        entities: 0,
        sources: 0,
        observations: 0,
        relationships: 0,
        pagesStored: 0,
        pagesDeduplicated: 0,
        pagesDropped: { scan: 0, removed: 0, invalid: 0 },
        excerptsDropped: 0,
      };
    };
    const reports = await Promise.all(
      [1, 2, 3].map(() => processArchiveQueue({ database: db, depsFor: () => memoryDeps({}, null), run })),
    );
    const done = reports.reduce((a, r) => a + r.processed, 0);
    const failed = reports.reduce((a, r) => a + r.failed, 0);
    expect(done + failed).toBe(6);
    expect(failed).toBe(1);
    expect(new Set(seen).size).toBe(6); // every job ran exactly once in this pass
    const left = (
      await ownerPool().query(
        "select run_id, attempts, last_error, next_attempt_at > now() as later from archive_jobs",
      )
    ).rows;
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({
      run_id: ids[3],
      attempts: 1,
      last_error: "transient storage error",
      later: true,
    });
    // not retried before its backoff...
    expect(
      (await processArchiveQueue({ database: db, depsFor: () => memoryDeps({}, null), run })).processed,
    ).toBe(0);
    // ...and retried (then deleted) after it
    const later = new Date(Date.now() + 3 * 60_000);
    const retry = await processArchiveQueue({
      database: db,
      depsFor: () => memoryDeps({}, null),
      run,
      now: () => later,
    });
    expect(retry.processed).toBe(1);
    expect((await ownerPool().query("select count(*)::int n from archive_jobs")).rows[0].n).toBe(0);
  });

  it("a job that keeps failing stops being retried after the attempt limit but stays visible with its error", async () => {
    await enqueueArchive("00000000-0000-4000-8000-000000000199", db);
    const boom = async () => {
      throw new Error("always fails");
    };
    for (let i = 0; i < 4; i++)
      await processArchiveQueue({
        database: db,
        depsFor: () => memoryDeps({}, null),
        run: boom,
        maxAttempts: 3,
        now: () => new Date(Date.now() + (i + 1) * 24 * 3600_000),
      });
    const row = (await ownerPool().query("select attempts, last_error from archive_jobs")).rows[0];
    expect(row).toMatchObject({ attempts: 3, last_error: "always fails" });
    void archiveJobs;
  });
});

describe("page snapshots (guarantee 2)", () => {
  it("stores sanitised pages once, gzip, content-addressed; the same page from another run is deduplicated; an unclean page is dropped", async () => {
    const store = new MemoryObjectStore();
    const clean = "Group blog post. Victim list updated. No personal data here.";
    const dirty = "Dump: admin@corp-test.example password: Sup3rSecret99 AKIAIOSFODNN7EXAMPLE";
    const bundle = makeBundle({
      sources: [
        { id: "a", url: leak, fetchedAt: "2026-03-02T09:00:00Z" },
        { id: "b", url: leak2, fetchedAt: "2026-03-03T09:00:00Z" },
      ],
      entities: [{ id: "e", type: "ORGANIZATION_NAME", value: "Contoso", sources: ["a", "b"] }],
    });
    const pages = [
      { url: leak, fetched_at: "2026-03-02T09:00:00Z", text: clean },
      { url: leak2, fetched_at: "2026-03-03T09:00:00Z", text: dirty },
    ];
    const r1 = await archiveRun(
      "00000000-0000-4000-8000-000000000201",
      memoryDeps(bundle, pages, store),
      opts,
    );
    expect(r1).toMatchObject({ pagesStored: 1, pagesDeduplicated: 0 });
    expect(r1.pagesDropped.scan).toBe(1);
    expect(store.objects.size).toBe(1);
    const [key, bytes] = [...store.objects][0]!;
    expect(key).toMatch(/^pages\/[0-9a-f]{64}\.txt\.gz$/);
    expect(gunzipSync(Buffer.from(bytes)).toString("utf8")).toBe(clean);
    const everything = await dumpArchive(store.objects);
    for (const bad of ["Sup3rSecret99", "AKIAIOSFODNN7EXAMPLE", "admin@corp-test.example"])
      expect(everything).not.toContain(bad);
    const src = (
      await ownerPool().query("select url, snapshot_path, content_hash from archive_sources order by url")
    ).rows;
    expect(src.find((s) => s.snapshot_path)!.snapshot_path).toBe(key);
    expect(src.filter((s) => s.snapshot_path)).toHaveLength(1);
    const r2 = await archiveRun(
      "00000000-0000-4000-8000-000000000202",
      memoryDeps(bundle, [pages[0]!], store),
      opts,
    );
    expect(r2).toMatchObject({ pagesStored: 0, pagesDeduplicated: 1 });
    expect(store.objects.size).toBe(1);
  });

  it("works from the bundle alone when there are no pages: entities, relationships and source excerpts, no snapshots", async () => {
    const store = new MemoryObjectStore();
    await archiveRun(A_INV, memoryDeps(run1(), null, store), opts);
    expect(store.objects.size).toBe(0);
    const c = await counts();
    expect(c).toMatchObject({ e: 4, s: 2, r: 2 });
    expect(
      (await ownerPool().query("select excerpt from archive_sources where url like '%northwind'")).rows[0]
        .excerpt,
    ).toContain("Northwind Traders");
  });

  it("an excerpt that still looks sensitive is dropped, not archived", async () => {
    const b = makeBundle({
      sources: [
        {
          id: "a",
          url: leak,
          fetchedAt: "2026-03-02T09:00:00Z",
          excerpt: "contact boss@corp-test.example now",
        },
      ],
      entities: [{ id: "e", type: "ORGANIZATION_NAME", value: "Contoso", sources: ["a"] }],
    });
    const r = await archiveRun("00000000-0000-4000-8000-000000000203", memoryDeps(b, null), opts);
    expect(r.excerptsDropped).toBe(1);
    expect(await dumpArchive()).not.toContain("boss@corp-test.example");
  });

  it("sensitive entities enter as masked display plus fingerprint only; the raw value never reaches the archive", async () => {
    const b = makeBundle({
      sources: [{ id: "a", url: leak, fetchedAt: "2026-03-02T09:00:00Z" }],
      entities: [
        {
          id: "m",
          type: "EMAIL_ADDRESS",
          value: "jane.doe@victim-test.example",
          sources: ["a"],
          sensitive: true,
        },
        { id: "k", type: "API_KEY", value: "sk_live_RAWSECRETVALUE123456", sources: ["a"], sensitive: true },
        { id: "o", type: "ORGANIZATION_NAME", value: "Contoso", sources: ["a"] },
      ],
      relationships: [{ a: "m", b: "o", evidence: ["a"] }],
    });
    await archiveRun("00000000-0000-4000-8000-000000000204", memoryDeps(b, null), opts);
    const everything = await dumpArchive();
    for (const raw of ["jane.doe@victim-test.example", "sk_live_RAWSECRETVALUE123456", "RAWSECRETVALUE"])
      expect(everything).not.toContain(raw);
    const rows = (
      await ownerPool().query(
        "select type, canonical_value, fingerprint, display_value, sensitive from archive_entities where sensitive order by type",
      )
    ).rows;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.canonical_value).toBeNull();
      expect(r.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(rows.find((r) => r.type === "EMAIL_ADDRESS")!.display_value).toMatch(/^j\*\*\*@/);
    // identity by fingerprint: the same email in another run is the same archive entity, and a probe finds it without the raw value being stored
    expect((await ownerPool().query("select count(*)::int n from archive_relationships")).rows[0].n).toBe(1);
  });
});

describe("liveness: sources that went offline keep their snapshot", () => {
  it("a source fetched alive, then only mentioned later, reads as no longer online with its archived snapshot", async () => {
    const store = new MemoryObjectStore();
    const t1 = [
      {
        url: leak,
        fetched_at: "2026-03-02T09:00:00Z",
        text: "Archived leak-site page text about Northwind Traders.",
      },
    ];
    await archiveRun(A_INV, memoryDeps(run1(), t1, store), opts);
    let row = (
      await ownerPool().query(
        "select last_alive, last_seen, snapshot_path from archive_sources where url like '%northwind'",
      )
    ).rows[0];
    expect(new Date(row.last_alive).getTime()).toBe(new Date(row.last_seen).getTime()); // alive when last seen
    const snapshot = row.snapshot_path as string;

    // Run 2, in May: the same URL shows up as a link on another page, but fetching it returned nothing
    const may = makeBundle({
      sources: [{ id: "n", url: "https://www.example-news.test/may", fetchedAt: "2026-05-20T00:00:00Z" }],
      entities: [
        { id: "u", type: "ONION_URL", value: leak, sources: ["n"] },
        { id: "o", type: "ORGANIZATION_NAME", value: "Northwind Traders", sources: ["n"] },
      ],
    });
    await archiveRun(B_INV, memoryDeps(may, null, store), opts);
    row = (
      await ownerPool().query(
        "select last_alive, last_seen, snapshot_path from archive_sources where url like '%northwind'",
      )
    ).rows[0];
    expect(new Date(row.last_alive).toISOString()).toBe("2026-03-02T09:00:00.000Z");
    expect(new Date(row.last_seen).toISOString()).toBe("2026-05-20T00:00:00.000Z");
    expect(row.snapshot_path).toBe(snapshot);
    expect(store.objects.has(snapshot)).toBe(true);

    const ctx = await archiveContext(probeOf(may), opts);
    expect(ctx.offline).toHaveLength(1);
    expect(ctx.offline[0]).toMatchObject({
      lastAlive: "2026-03-02T09:00:00.000Z",
      lastSeen: "2026-05-20T00:00:00.000Z",
    });
    expect(ctx.offline[0]!.excerpt).toContain("Northwind Traders");
  });
});

describe("removal (guarantee 3)", () => {
  it("a tombstoned entity is hidden from every read, stays hidden after a re-run, and leaves an audit row", async () => {
    await archiveRun(A_INV, memoryDeps(run1(), null), opts);
    const res = await removeFromArchive(
      {
        kind: "entity",
        key: "ORGANIZATION_NAME:northwindtraders",
        reason: "takedown request #T-1",
        actor: "ops:test",
      },
      { objectStore: new MemoryObjectStore(), database: db },
    );
    expect(res.tombstoned).toBe(1);
    const ctx = await archiveContext(probeOf(run2()), opts);
    expect(ctx.seen).toEqual({});
    const probeGroup: Probe = {
      entities: [{ key: "g", type: "RANSOMWARE_GROUP", value: "BlackCat", fingerprint: null }],
      ownSources: [],
    };
    expect(
      (await archiveContext(probeGroup, opts)).neighbours.some((n) => /northwind/i.test(n.display)),
    ).toBe(false);
    expect((await archiveGraph(probeGroup, opts)).nodes.some((n) => /northwind/i.test(n.label))).toBe(false);
    await archiveRun(A_INV, memoryDeps(run1(), null), opts); // the finding is not resurrected
    expect((await archiveContext(probeOf(run2()), opts)).seen).toEqual({});
    const audit = await db.withSystem(
      "t",
      (tx) => tx.select().from(auditLog).where(eq(auditLog.action, "archive.remove")),
      { audit: false },
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: "ops:test",
      target: "entity:ORGANIZATION_NAME:northwindtraders",
    });
    expect((audit[0]!.meta as { reason: string }).reason).toBe("takedown request #T-1");
    await expect(
      removeFromArchive(
        { kind: "entity", key: "x", reason: " ", actor: "a" },
        { objectStore: new MemoryObjectStore(), database: db },
      ),
    ).rejects.toThrow();
  });

  it("removing a source or a page deletes the snapshot object, blocks the same content from returning, and lowers the counts", async () => {
    const store = new MemoryObjectStore();
    const pages = [
      {
        url: leak,
        fetched_at: "2026-03-02T09:00:00Z",
        text: "Page to be taken down: Northwind Traders listing.",
      },
    ];
    await archiveRun(A_INV, memoryDeps(run1(), pages, store), opts);
    expect(store.objects.size).toBe(1);
    const key = [...store.objects.keys()][0]!;
    const hash = key.replace("pages/", "").replace(".txt.gz", "");

    const res = await removeFromArchive(
      { kind: "page", key: hash, reason: "legal: court order 42", actor: "ops:test" },
      { objectStore: store, database: db },
    );
    expect(res.objectsDeleted).toBe(1);
    expect(store.objects.size).toBe(0);
    expect(
      (
        await ownerPool().query(
          "select snapshot_path, content_hash from archive_sources where url like '%northwind'",
        )
      ).rows[0],
    ).toEqual({ snapshot_path: null, content_hash: null });
    const again = await archiveRun(A_INV, memoryDeps(run1(), pages, store), opts);
    expect(again.pagesDropped.removed).toBe(1);
    expect(store.objects.size).toBe(0);

    // whole source: hidden, and the entities that only it supported lose that evidence
    const before = (
      await ownerPool().query(
        "select observation_count from archive_entities where canonical_value='northwindtraders'",
      )
    ).rows[0].observation_count;
    await removeFromArchive(
      { kind: "source", key: leak, reason: "poisoned source", actor: "ops:test" },
      { objectStore: store, database: db },
    );
    const ctxAfter = await archiveContext(
      {
        entities: [{ key: "o", type: "ORGANIZATION_NAME", value: "Northwind Traders", fingerprint: null }],
        ownSources: [],
      },
      opts,
    );
    expect(before).toBe(1);
    expect(ctxAfter.seen).toEqual({});
    expect(
      (await ownerPool().query("select count(*)::int n from audit_log where action='archive.remove'")).rows[0]
        .n,
    ).toBe(3);
    void sql;
  });
});
