/**
 * S4 acceptance proof for the preview lock: a synthetic completed run carries a unique canary token in every field
 * (summary tail, findings, entity values / tags / reasons, source hosts / URLs / titles / excerpts, actor handles and
 * profiles, graph and community labels, refined queries, trace events, artifacts). As a Free (preview) user, every
 * route and every results/replay/live server component is called and NO locked token may appear in any byte; as a
 * paid user every token must be present somewhere. Covers the top-up-credit entitlement and "upgrade unlocks the
 * past report". Server components are checked by serialising the element tree they return (every prop passed to a
 * client component, i.e. what the RSC payload would carry, plus every server-rendered string).
 */
import { randomUUID } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { archiveRun } from "@voidaccess/archive";
import { memoryDeps } from "@voidaccess/archive/test-support";
import { runEvents } from "@voidaccess/db";
import { canaryRun, leaks, type CanaryRun } from "./preview-fixture";
import {
  appDb,
  makeUser,
  ownerPool,
  seedInvestigation,
  seedTopupPaidInvestigation,
  setPlan,
} from "./results-helpers";
import { setSessionUser } from "./session-state";

let current: string | null = null;
vi.mock("@/lib/dev-session", () => ({ getSessionUserId: async () => current }));
vi.mock("@voidaccess/db", async (orig) => {
  const mod = await orig<typeof import("@voidaccess/db")>();
  return { ...mod, getDatabase: () => appDb() };
});
vi.mock("@/lib/page-user", () => ({
  pageUser: async () => ({ id: current, status: "active", aupAcceptedAt: new Date() }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

import { GET as statusGET } from "@/app/api/investigations/[id]/route";
import { GET as listGET } from "@/app/api/investigations/route";
import { GET as entitiesGET } from "@/app/api/investigations/[id]/entities/route";
import { GET as entityGET } from "@/app/api/investigations/[id]/entities/[bundleId]/route";
import { GET as eventsGET } from "@/app/api/investigations/[id]/events/route";
import { GET as exportGET } from "@/app/api/investigations/[id]/exports/[format]/route";
import { GET as graphGET } from "@/app/api/investigations/[id]/graph/route";
import { GET as replayGET } from "@/app/api/investigations/[id]/replay/route";
import { GET as archiveGET } from "@/app/api/investigations/[id]/archive/route";
import { GET as archiveGraphGET } from "@/app/api/investigations/[id]/archive/graph/route";
import InvestigationPage from "@/app/(app)/investigations/[id]/page";
import ResultsLayout from "@/app/(app)/investigations/[id]/results/layout";
import SummaryPage from "@/app/(app)/investigations/[id]/results/summary/page";
import EntitiesPage from "@/app/(app)/investigations/[id]/results/entities/page";
import SourcesPage from "@/app/(app)/investigations/[id]/results/sources/page";
import ActorsPage from "@/app/(app)/investigations/[id]/results/actors/page";
import GraphPage from "@/app/(app)/investigations/[id]/results/graph/page";
import ExportsPage from "@/app/(app)/investigations/[id]/results/exports/page";
import ReplayPage from "@/app/(app)/investigations/[id]/replay/page";
import { exportAccountData } from "@/lib/account/export";
import { ALL_FORMATS } from "@/lib/results/formats";
import { getReportAccess } from "@/lib/access";

const CR: CanaryRun = canaryRun();
let FREE: string, PRO: string, TOPUP: string, ADMIN_GRANT: string, OTHER: string;
let invFree: string, invPro: string, invTopup: string, invAdminLot: string;

async function storeTraces(userId: string, runId: string) {
  await appDb().withSystem("test.traces", (tx) =>
    tx.insert(runEvents).values([
      { runId, userId, seq: 1, type: "stage", stage: "refine", status: "start", at: new Date() },
      ...CR.traces.map((t, i) => ({
        runId,
        userId,
        seq: 2 + i,
        type: "trace",
        stage: t.stage,
        kind: t.kind,
        data: t.data,
        at: new Date(),
      })),
      {
        runId,
        userId,
        seq: 100,
        type: "counts",
        stage: "summarize",
        counts: { entities: 9, sources: 6 },
        at: new Date(),
      },
    ]),
  );
}

async function seedCanary(userId: string, paid: "none" | "topup" | "admin_lot" = "none") {
  const id =
    paid === "none"
      ? await seedInvestigation(userId, CR.bundle, CR.artifacts)
      : await seedTopupPaidInvestigation(userId, CR.bundle, {
          artifacts: CR.artifacts,
          adminLot: paid === "admin_lot",
        });
  await storeTraces(userId, id);
  return id;
}

beforeAll(async () => {
  await ownerPool().query(
    "truncate archive_observations, archive_relationship_sources, archive_relationships, archive_aliases, archive_entities, archive_sources, archive_removed_pages, archive_jobs cascade",
  );
  [FREE, PRO, TOPUP, ADMIN_GRANT, OTHER] = await Promise.all([
    makeUser("free"),
    makeUser("pro"),
    makeUser("free"),
    makeUser("free"),
    makeUser("pro"),
  ]);
  invFree = await seedCanary(FREE);
  invPro = await seedCanary(PRO);
  invTopup = await seedCanary(TOPUP, "topup");
  invAdminLot = await seedCanary(ADMIN_GRANT, "admin_lot");
  // another user's earlier run of the same findings, filed in the archive: the overlay now has "seen before" data
  // (its sources are other pages: "seen before" means seen from somewhere other than the viewer's own sources)
  const otherBundle = structuredClone(CR.bundle);
  otherBundle.sources = otherBundle.sources.map((src, i) => ({
    ...src,
    url: `http://elsewhere-${i}.example.org/page`,
  }));
  const invOther = await seedInvestigation(OTHER, otherBundle, {});
  await archiveRun(invOther, memoryDeps(otherBundle, null), { database: appDb() });
});
afterAll(async () => {
  await appDb().close();
  await ownerPool().end();
});

const asUser = (id: string) => {
  current = id;
  setSessionUser({
    id,
    email: `${id}@test.local`,
    name: "T",
    emailVerified: true,
    role: "user",
    plan: "free",
    status: "active",
    aupAcceptedAt: new Date(),
  });
};
const req = (path = "") => new Request(`http://localhost:3000/x${path}`);
const params = (id: string, extra: Record<string, string> = {}) =>
  ({ params: Promise.resolve({ id, format: "", bundleId: "", ...extra }) }) as never;

async function bodyText(res: Response): Promise<string> {
  const buf = new Uint8Array(await res.arrayBuffer());
  if (res.headers.get("content-type")?.includes("zip"))
    return Object.entries(unzipSync(buf))
      .map(([n, d]) => `${n}\n${strFromU8(d)}`)
      .join("\n");
  return strFromU8(buf);
}

/** Serialise a server component's element tree: every prop (data passed to client components) and every string. */
function dumpTree(node: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(node, (k, v) => {
    if (k === "_owner" || k === "_debugStack" || k === "_debugTask" || k === "_store") return undefined;
    if (typeof v === "function") return `[fn ${v.name}]`;
    if (typeof v === "bigint") return String(v);
    if (v && typeof v === "object") {
      if (seen.has(v)) return "[circular]";
      seen.add(v);
    }
    return v;
  });
}

/** Every response and server component a viewer of `inv` can reach, as text (status codes included). */
async function everything(userId: string, inv: string): Promise<Record<string, string>> {
  asUser(userId);
  const out: Record<string, string> = {};
  const call = async (name: string, p: Promise<Response>) => {
    const res = await p;
    out[name] = `${res.status} ${await bodyText(res)}`;
  };
  await call("GET /api/investigations/[id]", statusGET(req(), params(inv)));
  await call("GET /api/investigations", listGET(req("?limit=100")));
  await call("entities", entitiesGET(req(), params(inv)));
  await call("entities ?q=qzx&sort=value", entitiesGET(req("?q=qzx&sort=value&limit=500"), params(inv)));
  await call("entities ?offset=2", entitiesGET(req("?offset=2"), params(inv)));
  await call("entities ?archive=seen", entitiesGET(req("?archive=seen"), params(inv)));
  await call("entities ?archive=new", entitiesGET(req("?archive=new"), params(inv)));
  await call("graph", graphGET(req(), params(inv)));
  await call("replay", replayGET(req(), params(inv)));
  await call("events", eventsGET(req(), params(inv)));
  await call("events (resume)", eventsGET(req("?lastEventId=3"), params(inv)));
  await call("archive", archiveGET(req(), params(inv)));
  await call("archive ?lite=1", archiveGET(req("?lite=1"), params(inv)));
  await call("archive graph", archiveGraphGET(req("?hops=2"), params(inv)));
  for (const f of ALL_FORMATS) await call(`export ${f}`, exportGET(req(), params(inv, { format: f })));
  // entity detail for every real bundle id (the visible rows included) and a placeholder id
  const ids = await ownerPool().query<{ bundle_id: string }>(
    "select bundle_id from inv_entities where investigation_id=$1",
    [inv],
  );
  for (const { bundle_id } of ids.rows)
    await call(`entity ${bundle_id}`, entityGET(req(), params(inv, { bundleId: bundle_id })));
  await call("entity locked-3", entityGET(req(), params(inv, { bundleId: "locked-3" })));
  // archive overlay for one entity (the drawer)
  await call("archive ?entity", archiveGET(req(`?entity=${ids.rows[0]!.bundle_id}`), params(inv)));

  const p = { params: Promise.resolve({ id: inv }) };
  const pages: [string, () => Promise<unknown>][] = [
    ["page: live", () => InvestigationPage(p)],
    ["page: results layout", () => ResultsLayout({ children: null, params: p.params })],
    ["page: summary", () => SummaryPage(p)],
    ["page: entities", () => EntitiesPage(p)],
    ["page: sources", () => SourcesPage(p)],
    ["page: actors", () => ActorsPage(p)],
    ["page: graph", () => GraphPage(p)],
    ["page: exports", () => ExportsPage(p)],
    ["page: replay", () => ReplayPage(p)],
  ];
  for (const [name, render] of pages) out[name] = dumpTree((await render()) as ReactElement);
  out["account data export"] = JSON.stringify(await exportAccountData(userId));
  return out;
}

function leaksIn(all: Record<string, string>): string[] {
  return Object.entries(all).flatMap(([where, text]) => leaks(text, CR.locked).map((l) => `${where}: ${l}`));
}
const missing = (all: Record<string, string>, tokens: Map<string, string>) => {
  const text = Object.values(all).join("\n").toLowerCase();
  return [...tokens].filter(([t]) => !text.includes(t)).map(([t, label]) => `${label} (${t})`);
};

describe("preview lock: no locked value reaches a Free user's client (S4)", () => {
  it("the fixture is meaningful: tokens are in the database", async () => {
    const r = await ownerPool().query("select count(*)::int n from inv_entities where investigation_id=$1", [
      invFree,
    ]);
    expect(r.rows[0].n).toBe(CR.bundle.entities.length);
    expect(CR.locked.size).toBeGreaterThan(40);
  });

  it("Free user: no locked canary in any route, stream, export, server component or data export", async () => {
    expect(await getReportAccess(FREE, invFree, { database: appDb() })).toBe("preview");
    const all = await everything(FREE, invFree);
    expect(leaksIn(all)).toEqual([]);
    // the visible part is really there (the preview is not just empty)
    expect(missing(all, CR.visible)).toEqual([]);
    // locked resources are 402, never 200
    for (const f of ALL_FORMATS) expect(all[`export ${f}`]!.slice(0, 3), f).toBe("402");
    for (const [k, v] of Object.entries(all))
      if (k.startsWith("entity ") && k !== "entity locked-3") expect(v.slice(0, 3), k).toBe("402");
    expect(all["entities"]).toContain('"level":"preview"');
    // the archive overlay really had "seen before" data to hide: counts stay, entries go
    const arc = JSON.parse(all["archive"]!.slice(4));
    expect(arc.totals.seenBefore).toBeGreaterThan(0);
    expect(arc.seen).toEqual({});
    expect(all["graph"]).toContain('"level":"preview"');
  });

  it("an admin-granted (unpaid) top-up lot does not unlock the report", async () => {
    expect(await getReportAccess(ADMIN_GRANT, invAdminLot, { database: appDb() })).toBe("preview");
    expect(leaksIn(await everything(ADMIN_GRANT, invAdminLot))).toEqual([]);
  });

  it("Pro user: every canary is present somewhere (the lock really removed data)", async () => {
    const all = await everything(PRO, invPro);
    expect(missing(all, CR.locked)).toEqual([]);
    expect(all["entities"]).toContain('"access":{"level":"full"}');
    expect(Object.keys(JSON.parse(all["archive"]!.slice(4)).seen).length).toBeGreaterThan(0);
  });

  it("Free user whose run was paid with purchased top-up credits sees the full report", async () => {
    expect(await getReportAccess(TOPUP, invTopup, { database: appDb() })).toBe("full");
    const all = await everything(TOPUP, invTopup);
    // gated formats stay plan-gated (403) on Free, so the artifacts are not expected; everything else is full
    const text = Object.entries(all)
      .filter(([k]) => !k.startsWith("export ") || k === "export csv" || k === "export json")
      .map(([, v]) => v)
      .join("\n")
      .toLowerCase();
    const absent = [...CR.locked].filter(([t, label]) => !text.includes(t) && !/artifact/.test(label));
    expect(absent).toEqual([]);
  });

  it("upgrade unlocks the past report at once; a downgrade locks it again", async () => {
    const u = await makeUser("free");
    const inv = await seedCanary(u);
    expect(leaksIn(await everything(u, inv))).toEqual([]);
    await setPlan(u, "pro");
    expect(missing(await everything(u, inv), CR.locked)).toEqual([]);
    await setPlan(u, "free");
    expect(leaksIn(await everything(u, inv))).toEqual([]);
  });

  it("another user's run is still a 404 for a Free user (402 never reveals that a run exists)", async () => {
    const stranger = await makeUser("free");
    asUser(stranger);
    expect((await exportGET(req(), params(invPro, { format: "csv" }))).status).toBe(404);
    const id = (
      await ownerPool().query("select bundle_id from inv_entities where investigation_id=$1", [invPro])
    ).rows[0].bundle_id;
    expect((await entityGET(req(), params(invPro, { bundleId: id }))).status).toBe(404);
    expect((await entityGET(req(), params(randomUUID(), { bundleId: id }))).status).toBe(404);
  });
});
