import { afterAll, describe, expect, it } from "vitest";
import { decryptCredential } from "@voidaccess/db";
import { IngestError, ingestBundle, transformBundle } from "../src";
import {
  RAW_SENSITIVE,
  bundleDeps,
  fixtureBundle,
  generateBundle,
  rawSensitiveList,
} from "../src/test-support";
import { appDb, counts, dumpSnapshot, makeInvestigation, makeUser, ownerPool } from "./helpers";

const database = appDb();
const ingest = (runId: string, deps: ReturnType<typeof bundleDeps>) =>
  ingestBundle(runId, deps, { database });

afterAll(async () => {
  await database.close();
  await ownerPool().end();
});

describe("ingestBundle: happy path", () => {
  it("writes every snapshot table for the investigation's own user, and copies artifacts", async () => {
    const user = await makeUser();
    const { id, runId } = await makeInvestigation(user);
    const bundle = fixtureBundle("dprk-deep-typed", false);
    await ingest(runId, bundleDeps(bundle, { stix: '{"type":"bundle"}', sigma: "title: x" }));
    const c = await counts(id);
    const t = transformBundle(bundle, { fingerprintKey: "k" });
    expect(c.inv_entities).toBe(t.entities.length); // within-run dedupe may merge identical (type, value) pairs
    expect(t.entities.length).toBeGreaterThan(bundle.entities.length * 0.9);
    expect(c.inv_relationships).toBe(t.relationships.length);
    expect(c.inv_actors).toBe(bundle.actors.length);
    expect(c.inv_sources).toBe(bundle.sources.length);
    expect(c.inv_summary).toBe(1);
    expect(c.inv_exports).toBe(2);
    const { rows } = await ownerPool().query(
      `select distinct user_id from inv_entities where investigation_id=$1`,
      [id],
    );
    expect(rows).toEqual([{ user_id: user }]);
    const s = await ownerPool().query(
      `select entity_counts, stats from inv_summary where investigation_id=$1`,
      [id],
    );
    expect(s.rows[0].stats.entities).toBe(t.entities.length);
    expect(Object.values(s.rows[0].entity_counts as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(
      t.entities.length,
    );
    const deg = await ownerPool().query(
      `select max(degree)::int m, count(community)::int c from inv_entities where investigation_id=$1`,
      [id],
    );
    expect(deg.rows[0].m).toBeGreaterThan(0);
    expect(deg.rows[0].c).toBeGreaterThan(0);
    const inv = await ownerPool().query(`select status from investigations where id=$1`, [id]);
    expect(inv.rows[0].status).toBe("ingesting"); // ingest never changes status
  });

  it("also finds the investigation by its own id", async () => {
    const user = await makeUser();
    const { id } = await makeInvestigation(user);
    await ingest(id, bundleDeps(fixtureBundle("lockbit-deep", false)));
    expect((await counts(id)).inv_summary).toBe(1);
  });

  it("dedupes identical (type, value) entities within a run and remaps relationships", async () => {
    const user = await makeUser();
    const { id, runId } = await makeInvestigation(user);
    const b = fixtureBundle("lockbit-deep", false);
    const first = b.entities[0]!;
    b.entities.push({ ...first, id: "dup-1", confidence: 0.99, tags: [...first.tags, "extra"] });
    b.relationships.push({
      source: "dup-1",
      target: b.entities[1]!.id,
      type: "CO_APPEARED_ON",
      weight: 0.4,
      evidence_source_ids: [],
    });
    await ingest(runId, bundleDeps(b));
    const e = await ownerPool().query(
      `select count(*)::int n, max(confidence) c from inv_entities where investigation_id=$1 and bundle_id in ($2,'dup-1')`,
      [id, first.id],
    );
    expect(e.rows[0].n).toBe(1);
    expect(e.rows[0].c).toBe(0.99);
    const r = await ownerPool().query(
      `select count(*)::int n from inv_relationships where investigation_id=$1 and (source_bundle_id='dup-1' or target_bundle_id='dup-1')`,
      [id],
    );
    expect(r.rows[0].n).toBe(0);
  });
});

describe("H1-5: summary_kind at ingest", () => {
  const kindOf = async (id: string) =>
    (await ownerPool().query(`select summary_kind from investigations where id=$1`, [id])).rows[0]
      .summary_kind;

  it.each([
    ["llm", "llm"],
    ["fallback", "fallback"],
    ["none", "none"],
    [undefined, "none"], // bundle without the field: default none
    ["something-else", "none"],
  ])("bundle summary_kind %s is stored as %s, in the ingest transaction", async (given, stored) => {
    const user = await makeUser();
    const { id, runId } = await makeInvestigation(user);
    expect(await kindOf(id)).toBeNull();
    const bundle = fixtureBundle("lockbit-deep", false);
    bundle.summary.summary_kind = given;
    await ingest(runId, bundleDeps(bundle));
    expect(await kindOf(id)).toBe(stored);
  });

  it("a failed ingest leaves summary_kind untouched (same transaction), and a repeat does not overwrite it", async () => {
    const user = await makeUser();
    const { id, runId } = await makeInvestigation(user);
    const bad = fixtureBundle("lockbit-deep", false);
    bad.summary.summary_kind = "llm";
    bad.relationships = [{ ...bad.relationships[0]!, source: "missing-id" } as never];
    await expect(ingest(runId, bundleDeps(bad))).rejects.toThrow();
    expect(await kindOf(id)).toBeNull();
    const good = fixtureBundle("lockbit-deep", false);
    good.summary.summary_kind = "fallback";
    await ingest(runId, bundleDeps(good));
    good.summary.summary_kind = "llm";
    await ingest(runId, bundleDeps(good));
    expect(await kindOf(id)).toBe("fallback");
  });
});

describe("ingestBundle: failures", () => {
  it("rejects a bundle that fails the schema and writes nothing", async () => {
    const user = await makeUser();
    const { id, runId } = await makeInvestigation(user);
    const bad = { ...fixtureBundle("lockbit-deep", false), schema_version: 2 };
    const err = await ingest(runId, bundleDeps(bad)).catch((e) => e);
    expect(err).toBeInstanceOf(IngestError);
    expect(err.reason).toBe("invalid_bundle");
    expect(Object.values(await counts(id)).every((n) => n === 0)).toBe(true);
  });

  it("rejects dangling ids as an integrity failure", async () => {
    const user = await makeUser();
    const { id, runId } = await makeInvestigation(user);
    const b = fixtureBundle("lockbit-deep", false);
    b.relationships.push({
      source: "ghost",
      target: b.entities[0]!.id,
      type: "X",
      weight: 1,
      evidence_source_ids: [],
    });
    const err = await ingest(runId, bundleDeps(b)).catch((e) => e);
    expect(err).toMatchObject({ name: "IngestError", reason: "integrity" });
    expect((await counts(id)).inv_summary).toBe(0);
  });

  it("not_found for an unknown run; bundle_unreadable when the bundle can't be read", async () => {
    expect(await ingest("nope", bundleDeps({})).catch((e) => e)).toMatchObject({ reason: "not_found" });
    const user = await makeUser();
    const { runId } = await makeInvestigation(user);
    const deps = { ...bundleDeps({}), readBundle: async () => Promise.reject(new Error("gone")), reads: 0 };
    expect(await ingest(runId, deps).catch((e) => e)).toMatchObject({ reason: "bundle_unreadable" });
  });

  it("is atomic: a failure after partial writes (and vault writes) leaves nothing", async () => {
    const user = await makeUser();
    const { id, runId } = await makeInvestigation(user);
    const b = fixtureBundle("dprk-deep-typed", true); // contains a raw secret -> vault write happens first
    b.actors.push({ ...b.actors[0]! }); // duplicate actor id: violates inv_actors unique index mid-transaction
    const err = await ingest(runId, bundleDeps(b)).catch((e) => e);
    expect(err).toMatchObject({ name: "IngestError", reason: "write_failed" });
    const c = await counts(id);
    expect(Object.values(c).every((n) => n === 0)).toBe(true);
    // and a clean retry afterwards works
    await ingest(runId, bundleDeps(fixtureBundle("dprk-deep-typed", true)));
    expect((await counts(id)).inv_summary).toBe(1);
  });
});

describe("ingestBundle: idempotency", () => {
  it("a second call changes nothing and doesn't even read the bundle", async () => {
    const user = await makeUser();
    const { id, runId } = await makeInvestigation(user);
    const deps = bundleDeps(fixtureBundle("dprk-deep-typed", true), { stix: "{}" });
    await ingest(runId, deps);
    const before = await dumpSnapshot(id);
    const vaultBefore = (await counts(id)).credential_vault;
    await ingest(runId, deps);
    await ingest(runId, deps);
    expect(deps.reads).toBe(1);
    expect(await dumpSnapshot(id)).toBe(before);
    expect((await counts(id)).credential_vault).toBe(vaultBefore);
  });

  it("concurrent ingests of the same run write exactly one snapshot", async () => {
    const user = await makeUser();
    const { id, runId } = await makeInvestigation(user);
    const b = fixtureBundle("lockbit-deep", true);
    await Promise.allSettled([1, 2, 3, 4].map(() => ingest(runId, bundleDeps(b))));
    const c = await counts(id);
    expect(c.inv_summary).toBe(1);
    expect(c.inv_entities).toBe(transformBundle(b, { fingerprintKey: "k" }).entities.length);
  });
});

describe("masking (guarantee 2)", () => {
  it("no raw sensitive value appears in any inv_* column or stored artifact; raw values live only in the vault", async () => {
    const user = await makeUser();
    const { id, runId } = await makeInvestigation(user);
    const leaky = `{"email":"${RAW_SENSITIVE.email}","key":"${RAW_SENSITIVE.apiKey}"}`;
    await ingest(
      runId,
      bundleDeps(fixtureBundle("blackcat-standard-onion", true), { stix: leaky, misp: leaky }),
    );
    const dump = await dumpSnapshot(id);
    for (const raw of rawSensitiveList()) expect(dump, `leaked ${raw.slice(0, 6)}…`).not.toContain(raw);
    const ents = await ownerPool().query(
      `select type, value, display_value, fingerprint, sensitive from inv_entities where investigation_id=$1 and sensitive`,
      [id],
    );
    expect(ents.rows.length).toBe(6);
    for (const r of ents.rows) {
      expect(r.value).toBeNull();
      expect(r.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
    const display = Object.fromEntries(ents.rows.map((r) => [r.type, r.display_value]));
    expect(display.EMAIL_ADDRESS).toMatch(/^[a-z]\*\*\*@darkmail-test\.example$/);
    expect(display.API_KEY).toBe(`len:${RAW_SENSITIVE.apiKey.length}`);
    expect(display.COMBO_LIST_ENTRY).toBe("len:14");
    const vault = await ownerPool().query(
      `select id, kind, masked_value from credential_vault where investigation_id=$1 order by kind`,
      [id],
    );
    expect(vault.rows.length).toBe(5); // 2 emails, phone, person, raw api key (the pre-redacted token has nothing to vault)
    const email = vault.rows.find((r) => r.kind === "EMAIL_ADDRESS")!;
    expect(await decryptCredential(email.id, { actor: "test", reason: "verify" }, { database })).toMatch(
      /@darkmail-test\.example$/,
    );
    const audited = await ownerPool().query(
      `select count(*)::int n from audit_log where action='credential.decrypt'`,
    );
    expect(audited.rows[0].n).toBeGreaterThan(0);
  });

  it("the same raw value gives the same fingerprint, different values differ", async () => {
    const user = await makeUser();
    const a = await makeInvestigation(user);
    const b = await makeInvestigation(user);
    const bundle = fixtureBundle("lockbit-deep", true);
    await ingest(a.runId, bundleDeps(bundle));
    await ingest(b.runId, bundleDeps(bundle));
    const fp = async (inv: string) =>
      (
        await ownerPool().query(
          `select bundle_id, fingerprint from inv_entities where investigation_id=$1 and sensitive order by bundle_id`,
          [inv],
        )
      ).rows;
    expect(await fp(a.id)).toEqual(await fp(b.id));
    const rows = await fp(a.id);
    expect(new Set(rows.map((r) => r.fingerprint)).size).toBe(rows.length);
  });
});

describe("scale", () => {
  it("ingests a 5,000-entity / 15,000-relationship bundle in a few seconds", async () => {
    const user = await makeUser();
    const { id, runId } = await makeInvestigation(user);
    const bundle = generateBundle();
    expect(bundle.entities.length).toBe(5000);
    const t0 = performance.now();
    await ingest(runId, bundleDeps(bundle));
    const ms = Math.round(performance.now() - t0);
    console.log(`ingest of 5000 entities / ${bundle.relationships.length} relationships: ${ms} ms`);
    const c = await counts(id);
    expect(c.inv_entities).toBe(5000);
    expect(c.inv_relationships).toBeGreaterThan(14000);
    expect(ms).toBeLessThan(10_000);
  });
});
