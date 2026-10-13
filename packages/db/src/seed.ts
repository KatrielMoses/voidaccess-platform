// Dev seed: two users (free, pro) with sample investigations loaded from the engine-mock fixture bundles.
// NOTE: this is a minimal loader for development. The real bundle ingest (masking, vault, resolution) is P3.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { grantMonthly } from "./ledger";
import type { Database } from "./client";
import { createLocalDatabase } from "./local";
import { fingerprint, type ResultBundle } from "@voidaccess/engine-client";
import {
  invActors,
  invEntities,
  invRelationships,
  invSources,
  invSummary,
  investigations,
  users,
} from "./schema";
import type { PlanId } from "@voidaccess/config";

const FIXTURES = fileURLToPath(new URL("../../engine-mock/fixtures/", import.meta.url));
const loadBundle = (name: string) =>
  JSON.parse(readFileSync(`${FIXTURES}${name}.bundle.json`, "utf8")) as ResultBundle;
const chunk = <T>(a: T[], n = 400) =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, (i + 1) * n));

export const SEED_USERS: Array<{ email: string; name: string; plan: PlanId; fixtures: string[] }> = [
  { email: "free@seed.voidaccess.test", name: "Seed Free", plan: "free", fixtures: ["dprk-deep-typed"] },
  {
    email: "pro@seed.voidaccess.test",
    name: "Seed Pro",
    plan: "pro",
    fixtures: ["lockbit-deep", "blackcat-standard-onion"],
  },
];

export async function seed(
  database: Database,
  fpKey = process.env.VA_FINGERPRINT_KEY ?? "dev-fingerprint-key",
) {
  const out: Array<{ userId: string; email: string; investigations: string[] }> = [];
  for (const u of SEED_USERS) {
    const userId = await database.withSystem("seed.user", async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          email: u.email,
          name: u.name,
          plan: u.plan,
          emailVerified: true,
          aupAcceptedAt: new Date(),
        })
        .onConflictDoUpdate({ target: users.email, set: { name: u.name } })
        .returning({ id: users.id });
      return row!.id;
    });
    await grantMonthly(userId, u.plan, new Date(), { database });
    const invIds: string[] = [];
    for (const name of u.fixtures) {
      const b = loadBundle(name);
      const id = await database.withSystem("seed.investigation", async (tx) => {
        const [inv] = await tx
          .insert(investigations)
          .values({
            userId,
            query: b.query,
            depth: b.depth,
            status: "completed",
            engineRunId: `${b.run_id}-${userId.slice(0, 8)}`,
            refinedQueries: b.refined_queries,
            startedAt: new Date(b.started_at),
            completedAt: new Date(b.completed_at),
            summaryKind: "ai",
          })
          .returning({ id: investigations.id });
        const base = { userId, investigationId: inv!.id };
        for (const c of chunk(b.entities))
          await tx.insert(invEntities).values(
            c.map((e) => ({
              ...base,
              bundleId: e.id,
              type: e.type,
              value: e.sensitive ? null : e.value,
              displayValue: e.display_value,
              fingerprint: fingerprint(fpKey, e.type, e.value),
              sensitive: e.sensitive,
              confidence: e.confidence,
              firstSeen: e.first_seen ? new Date(e.first_seen) : null,
              sourceIds: e.source_ids,
              tags: e.tags,
            })),
          );
        for (const c of chunk(b.relationships))
          await tx.insert(invRelationships).values(
            c.map((r) => ({
              ...base,
              sourceBundleId: r.source,
              targetBundleId: r.target,
              type: r.type,
              weight: r.weight,
              evidenceSourceIds: r.evidence_source_ids,
            })),
          );
        if (b.actors.length)
          await tx.insert(invActors).values(
            b.actors.map((a) => ({
              ...base,
              bundleId: a.id,
              handle: a.handle,
              aliases: a.aliases,
              entityBundleIds: a.entity_ids,
              firstSeen: a.first_seen ? new Date(a.first_seen) : null,
              lastSeen: a.last_seen ? new Date(a.last_seen) : null,
              summary: a.summary,
            })),
          );
        for (const c of chunk(b.sources))
          await tx.insert(invSources).values(
            c.map((s) => ({
              ...base,
              bundleId: s.id,
              kind: s.kind,
              name: s.name,
              url: s.url,
              fetchedAt: new Date(s.fetched_at),
              excerpt: s.excerpt.slice(0, 500),
            })),
          );
        await tx.insert(invSummary).values({
          ...base,
          markdown: b.summary.markdown,
          keyFindings: b.summary.key_findings,
          riskNotes: b.summary.risk_notes,
          confidence: b.summary.confidence,
          sourceCount: b.summary.source_count,
          communities: b.communities,
        });
        return inv!.id;
      });
      invIds.push(id);
    }
    out.push({ userId, email: u.email, investigations: invIds });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL (the va_app connection) is not set");
  const database = createLocalDatabase(url);
  console.log(JSON.stringify(await seed(database), null, 2));
  await database.close();
}
