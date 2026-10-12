import { unzipSync, strFromU8 } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fixtureBundle, rawSensitiveList } from "@voidaccess/ingest/test-support";
import { appDb, makeUser, ownerPool, seedInvestigation } from "./helpers";

// The only thing mocked is the session: routes must take the user from here and nowhere else.
let current: string | null = null;
vi.mock("@/lib/dev-session", () => ({ getSessionUserId: async () => current }));
// Route handlers read the Database singleton; point it at the test database (va_app role, RLS applies).
vi.mock("@voidaccess/db", async (orig) => {
  const mod = await orig<typeof import("@voidaccess/db")>();
  return { ...mod, getDatabase: () => appDb() };
});

import { GET as entitiesGET } from "@/app/api/investigations/[id]/entities/route";
import { GET as entityGET } from "@/app/api/investigations/[id]/entities/[bundleId]/route";
import { GET as graphGET } from "@/app/api/investigations/[id]/graph/route";
import { GET as exportGET } from "@/app/api/investigations/[id]/exports/[format]/route";
import { ALL_FORMATS } from "@/lib/results/exports";
import { getActors, getInvestigation, getSources, loadSnapshot, searchEntities } from "@/lib/results/queries";

const bundle = fixtureBundle("blackcat-standard-onion", true);
let A: string, B: string, FREE: string;
let invA: string, invFree: string;

beforeAll(async () => {
  A = await makeUser("pro");
  B = await makeUser("pro");
  FREE = await makeUser("free");
  invA = await seedInvestigation(A, bundle);
  invFree = await seedInvestigation(FREE, bundle);
});
afterAll(async () => {
  await appDb().close();
  await ownerPool().end();
});

const req = (path = "") => new Request(`http://localhost/x${path}`);
const idp = (id: string, extra: { format?: string; bundleId?: string } = {}) =>
  ({ params: Promise.resolve({ id, format: "", bundleId: "", ...extra }) }) as {
    params: Promise<{ id: string; format: string; bundleId: string }>;
  };
const asUser = (u: string | null) => void (current = u);

async function bodyText(res: Response): Promise<string> {
  const buf = new Uint8Array(await res.arrayBuffer());
  if (res.headers.get("content-type")?.includes("zip")) {
    return Object.entries(unzipSync(buf))
      .map(([n, d]) => `${n}\n${strFromU8(d)}`)
      .join("\n");
  }
  return strFromU8(buf);
}

describe("isolation: another user's investigation id is a 404 everywhere (guarantee 1)", () => {
  it("user A can read their own results", async () => {
    asUser(A);
    expect((await entitiesGET(req(), idp(invA))).status).toBe(200);
    expect((await graphGET(req(), idp(invA))).status).toBe(200);
    expect((await exportGET(req(), idp(invA, { format: "csv" }))).status).toBe(200);
    expect(await getInvestigation(A, invA, { database: appDb() })).not.toBeNull();
  });

  it("user B gets 404 for results, entity detail, graph, search and every export format", async () => {
    asUser(B);
    const first = await ownerPool().query(
      `select bundle_id from inv_entities where investigation_id=$1 limit 1`,
      [invA],
    );
    const statuses = [
      (await entitiesGET(req("?q=a"), idp(invA))).status,
      (await entityGET(req(), idp(invA, { bundleId: first.rows[0].bundle_id }))).status,
      (await graphGET(req(), idp(invA))).status,
      ...(await Promise.all(
        ALL_FORMATS.map(async (f) => (await exportGET(req(), idp(invA, { format: f }))).status),
      )),
    ];
    expect(statuses.every((s) => s === 404)).toBe(true);
    const ctx = { database: appDb() };
    expect(await getInvestigation(B, invA, ctx)).toBeNull();
    expect(await searchEntities(B, invA, {}, ctx)).toBeNull();
    expect(await getSources(B, invA, ctx)).toBeNull();
    expect(await getActors(B, invA, ctx)).toBeNull();
    expect(await loadSnapshot(B, invA, ctx)).toBeNull();
  });

  it("no session is a 401, a malformed id is a 404, and a client-supplied user id is ignored", async () => {
    asUser(null);
    expect((await entitiesGET(req(), idp(invA))).status).toBe(401);
    asUser(B);
    expect((await entitiesGET(req(), idp("not-a-uuid"))).status).toBe(404);
    expect((await entitiesGET(req(`?user_id=${A}&userId=${A}`), idp(invA))).status).toBe(404);
  });
});

describe("masking reaches no API response or export (guarantee 2)", () => {
  it("scans every API response and every export for raw sensitive values", async () => {
    asUser(A);
    const first = await ownerPool().query(
      `select bundle_id from inv_entities where investigation_id=$1 and sensitive limit 1`,
      [invA],
    );
    const texts: string[] = [];
    texts.push(await bodyText(await entitiesGET(req("?limit=500&sensitive=1"), idp(invA))));
    texts.push(await bodyText(await entitiesGET(req("?limit=500"), idp(invA))));
    texts.push(await bodyText(await entityGET(req(), idp(invA, { bundleId: first.rows[0].bundle_id }))));
    texts.push(await bodyText(await graphGET(req(), idp(invA))));
    for (const f of ["csv", "json", "markdown", "ioc", "stix", "sigma"]) {
      const res = await exportGET(req(), idp(invA, { format: f }));
      expect(res.status, f).toBe(200);
      texts.push(await bodyText(res));
    }
    const all = texts.join("\n");
    expect(all.length).toBeGreaterThan(10_000);
    for (const raw of rawSensitiveList()) expect(all, `leaked ${raw.slice(0, 6)}…`).not.toContain(raw);
    // and the masked forms are what's there
    expect(all).toContain("***@darkmail-test.example");
  });

  it("searching for a raw sensitive value finds nothing (search text is masked too)", async () => {
    const ctx = { database: appDb() };
    expect((await searchEntities(A, invA, { q: "alice.operator" }, ctx))!.total).toBe(0);
    expect((await searchEntities(A, invA, { q: "darkmail-test" }, ctx))!.total).toBeGreaterThan(0);
  });
});

describe("plan gating comes from config (guarantee 5)", () => {
  it("free: CSV and JSON yes; Markdown, IOC and every artifact are 403 upgrade_required", async () => {
    asUser(FREE);
    for (const f of ["csv", "json"])
      expect((await exportGET(req(), idp(invFree, { format: f }))).status).toBe(200);
    for (const f of ["markdown", "ioc", "stix", "misp", "sigma", "yara", "snort", "suricata"]) {
      const res = await exportGET(req(), idp(invFree, { format: f }));
      expect(res.status, f).toBe(403);
      expect(await res.json()).toMatchObject({ error: "upgrade_required" });
    }
  });

  it("pro: everything generated works; artifacts present are served, absent ones are 404", async () => {
    asUser(A);
    for (const f of ["markdown", "ioc", "stix", "sigma"])
      expect((await exportGET(req(), idp(invA, { format: f }))).status, f).toBe(200);
    for (const f of ["misp", "yara", "snort", "suricata"])
      expect((await exportGET(req(), idp(invA, { format: f }))).status, f).toBe(404);
    expect((await exportGET(req(), idp(invA, { format: "nope" }))).status).toBe(404);
  });
});

describe("entity search", () => {
  const ctx = { database: appDb() };
  it("filters by type, confidence, sensitivity and text; sorts and pages deterministically", async () => {
    const all = (await searchEntities(A, invA, { limit: 500 }, ctx))!;
    expect(all.total).toBeGreaterThan(300);
    const onion = (await searchEntities(A, invA, { types: ["ONION_URL"], limit: 500 }, ctx))!;
    expect(onion.rows.every((r) => r.type === "ONION_URL")).toBe(true);
    const sens = (await searchEntities(A, invA, { sensitiveOnly: true }, ctx))!;
    expect(sens.total).toBe(6);
    const hi = (await searchEntities(A, invA, { minConfidence: 0.95 }, ctx))!;
    expect(hi.rows.every((r) => r.confidence >= 0.95)).toBe(true);
    const sorted = (await searchEntities(A, invA, { sort: "confidence", dir: "asc", limit: 50 }, ctx))!;
    expect(sorted.rows.map((r) => r.confidence)).toEqual(
      [...sorted.rows.map((r) => r.confidence)].sort((a, b) => a - b),
    );
    const p1 = (await searchEntities(A, invA, { limit: 20, offset: 0 }, ctx))!;
    const p2 = (await searchEntities(A, invA, { limit: 20, offset: 20 }, ctx))!;
    expect(new Set([...p1.rows, ...p2.rows].map((r) => r.bundleId)).size).toBe(40);
    const lit = (await searchEntities(A, invA, { q: "100%_" }, ctx))!; // LIKE metacharacters are escaped
    expect(lit.total).toBe(0);
  });
});
