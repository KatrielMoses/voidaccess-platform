import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { fixtureBundle } from "@voidaccess/ingest/test-support";
import { events, getDatabase } from "@voidaccess/db";
import { FUNNEL_EVENTS } from "@/lib/analytics-events";
import { trackEvent, trackMonitorCreated } from "@/lib/analytics";
import { POST as authPOST } from "@/app/api/auth/[...all]/route";
import { GET as graphGET } from "@/app/api/investigations/[id]/graph/route";
import { GET as exportGET } from "@/app/api/investigations/[id]/exports/[format]/route";
import { appDb, makeUser, ownerPool, seedInvestigation } from "./results-helpers";

let current: string | null = null;
vi.mock("@/lib/dev-session", () => ({ getSessionUserId: async () => current }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined }),
}));

const ROOT = join(__dirname, "..");
/** PRD §7, verbatim order: site_visit → signup_started → … → cancelled. */
const PRD_EVENTS = [
  "site_visit",
  "signup_started",
  "signup_completed",
  "email_verified",
  "first_investigation_started",
  "first_investigation_completed",
  "graph_viewed",
  "export_used",
  "credits_80",
  "upgrade_viewed",
  "subscribed",
  "topup_purchased",
  "monitor_created",
  "cancelled",
];

const eventsFor = (userId: string, name: string) =>
  getDatabase().withSystem(
    "t",
    (tx) =>
      tx
        .select()
        .from(events)
        .where(and(eq(events.userId, userId), eq(events.name, name))),
    {
      audit: false,
    },
  );

afterAll(async () => {
  await appDb().close();
  await ownerPool().end();
});

describe("PRD §7 funnel coverage", () => {
  it("lists exactly the PRD events, in order", () => {
    expect(FUNNEL_EVENTS.map((e) => e.name)).toEqual(PRD_EVENTS);
  });

  it("every event has an emitter that really contains it, or an explicit not-yet / out-of-scope note", () => {
    for (const e of FUNNEL_EVENTS) {
      if (e.status === "emitted") {
        expect(e.emitters.length, e.name).toBeGreaterThan(0);
        for (const f of e.emitters) {
          expect(existsSync(join(ROOT, f)), `${e.name}: ${f} exists`).toBe(true);
          const src = readFileSync(join(ROOT, f), "utf8");
          expect(src, `${e.name} in ${f}`).toContain(`"${e.name}"`);
          expect(src, `${f} calls trackEvent`).toMatch(/trackEvent\(/);
        }
      } else {
        expect(e.emitters, e.name).toEqual([]);
        expect(e.note.length, `${e.name} needs a reason`).toBeGreaterThan(20);
      }
    }
    expect(FUNNEL_EVENTS.filter((e) => e.status === "out_of_scope").map((e) => e.name)).toEqual([
      "site_visit",
    ]);
    expect(FUNNEL_EVENTS.filter((e) => e.status === "not_yet_applicable").map((e) => e.name)).toEqual([
      "monitor_created",
    ]);
  });

  it("monitor_created is defined and records once per monitor when something calls it", async () => {
    const u = await makeUser();
    const m = randomUUID();
    await trackMonitorCreated(u, { monitorId: m, cadence: "daily" });
    await trackMonitorCreated(u, { monitorId: m, cadence: "daily" });
    expect(await eventsFor(u, "monitor_created")).toHaveLength(1);
  });
});

describe("first-party and private", () => {
  it("the events table has no IP address or user agent column", async () => {
    const { rows } = await ownerPool().query(
      `select column_name from information_schema.columns where table_name = 'events'`,
    );
    const cols = rows.map((r) => r.column_name as string);
    expect(cols.filter((c) => /(^|_)ip(_|$)|agent|address|useragent|fingerprint/i.test(c))).toEqual([]);
  });

  it("the app ships no third-party tracker", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        if (
          ["node_modules", ".next", "test", "e2e", "e2e-prod", "docs", "public"].includes(n) ||
          n.startsWith(".next")
        )
          continue;
        const f = join(dir, n);
        if (statSync(f).isDirectory()) walk(f);
        else if (/\.(tsx?|css|html)$/.test(n) && !/\.test\./.test(n)) {
          const src = readFileSync(f, "utf8");
          if (
            /googletagmanager|google-analytics|gtag\(|segment\.(com|io)|mixpanel|posthog|plausible|hotjar|fullstory|amplitude|clarity\.ms|datadoghq|sentry\.io/i.test(
              src,
            )
          )
            hits.push(f);
          if (/<script[^>]+src=["']https?:/i.test(src)) hits.push(f + " (external script)");
        }
      }
    };
    for (const d of ["app", "components", "lib"]) walk(join(ROOT, d));
    expect(hits).toEqual([]);
  });

  it("trackEvent stores only what it is given: no request data, first-touch from the user or the call", async () => {
    const u = await makeUser();
    await getDatabase().withSystem(
      "t",
      (tx) =>
        tx.execute(
          sql`update users set first_touch = ${JSON.stringify({ utm: { utm_source: "hn" }, ref: "AFF7" })}::jsonb where id = ${u}`,
        ),
      { audit: false },
    );
    await trackEvent("upgrade_viewed", { userId: u, props: { from: "x" } });
    const [row] = await eventsFor(u, "upgrade_viewed");
    expect(row).toMatchObject({ utm: { utm_source: "hn" }, ref: "AFF7", props: { from: "x" } });
    expect(Object.keys(row!).sort()).toEqual([
      "anonymousId",
      "at",
      "id",
      "name",
      "props",
      "ref",
      "userId",
      "utm",
    ]);
  });
});

describe("emitters fire server-side", () => {
  const bundle = fixtureBundle("blackcat-standard-onion", true);
  let A: string;
  let inv: string;
  beforeAll(async () => {
    A = await makeUser("pro");
    inv = await seedInvestigation(A, bundle);
  });
  const ctx = (id: string, format = "") =>
    ({ params: Promise.resolve({ id, format, bundleId: "" }) }) as never;

  it("signup_started is recorded when an email sign-in code is requested, with attribution and no user", async () => {
    const campaign = `p6-${randomUUID().slice(0, 8)}`;
    await authPOST(
      new Request("http://localhost:3000/api/auth/email-otp/send-verification-otp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://va.localhost:3700",
          "x-forwarded-for": "10.9.9.9",
        },
        body: JSON.stringify({
          email: `${campaign}@test.local`,
          type: "sign-in",
          firstTouch: { utm_campaign: campaign, ref: "AFF-P6" },
        }),
      }),
    );
    const rows = await getDatabase().withSystem(
      "t",
      (tx) =>
        tx
          .select()
          .from(events)
          .where(and(eq(events.name, "signup_started"), sql`${events.utm}->>'utm_campaign' = ${campaign}`)),
      { audit: false },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "signup_started",
      userId: null,
      ref: "AFF-P6",
      props: { method: "email_code" },
    });
    // other auth paths (entering the code) are not a sign-up start
    const before = await getDatabase().withSystem(
      "t",
      (tx) => tx.select().from(events).where(eq(events.name, "signup_started")),
      { audit: false },
    );
    await authPOST(
      new Request("http://localhost:3000/api/auth/sign-in/email-otp", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://va.localhost:3700" },
        body: "{}",
      }),
    );
    const after = await getDatabase().withSystem(
      "t",
      (tx) => tx.select().from(events).where(eq(events.name, "signup_started")),
      { audit: false },
    );
    expect(after).toHaveLength(before.length);
  });

  it("graph_viewed: the first load of an investigation's graph, once per investigation", async () => {
    current = A;
    expect((await graphGET(new Request("http://x/g"), ctx(inv))).status).toBe(200);
    expect((await graphGET(new Request("http://x/g"), ctx(inv))).status).toBe(200);
    const rows = await eventsFor(A, "graph_viewed");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.props).toMatchObject({ investigationId: inv });
    // a different investigation is its own first view
    const inv2 = await seedInvestigation(A, bundle);
    await graphGET(new Request("http://x/g"), ctx(inv2));
    expect(await eventsFor(A, "graph_viewed")).toHaveLength(2);
    // someone else's investigation is a 404 and records nothing for them
    const B = await makeUser("pro");
    current = B;
    expect((await graphGET(new Request("http://x/g"), ctx(inv))).status).toBe(404);
    expect(await eventsFor(B, "graph_viewed")).toHaveLength(0);
    current = null;
  });

  it("export_used: each successful export, with its format; a refused export records nothing", async () => {
    current = A;
    expect((await exportGET(new Request("http://x/e"), ctx(inv, "csv"))).status).toBe(200);
    expect((await exportGET(new Request("http://x/e"), ctx(inv, "json"))).status).toBe(200);
    expect((await exportGET(new Request("http://x/e"), ctx(inv, "stix"))).status).toBe(200);
    expect(
      (await eventsFor(A, "export_used")).map((r) => (r.props as { format: string }).format).sort(),
    ).toEqual(["csv", "json", "stix"]);
    expect((await exportGET(new Request("http://x/e"), ctx(inv, "nope"))).status).toBe(404);
    const free = await makeUser("free");
    const freeInv = await seedInvestigation(free, bundle);
    current = free;
    expect((await exportGET(new Request("http://x/e"), ctx(freeInv, "stix"))).status).toBe(403);
    expect(await eventsFor(free, "export_used")).toHaveLength(0);
    expect((await exportGET(new Request("http://x/e"), ctx(freeInv, "csv"))).status).toBe(200);
    expect(await eventsFor(free, "export_used")).toHaveLength(1);
    current = null;
  });
});
