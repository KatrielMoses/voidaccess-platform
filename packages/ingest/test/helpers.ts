import pg from "pg";
import { randomUUID } from "node:crypto";
import { createDatabase, investigations, users, type Database } from "@voidaccess/db";
import type { PlanId } from "@voidaccess/config";
import { appUrl, ownerUrl } from "./urls";

let app: Database | undefined;
let owner: pg.Pool | undefined;
export const appDb = () => (app ??= createDatabase(appUrl, { max: 10 }));
export const ownerPool = () => (owner ??= new pg.Pool({ connectionString: ownerUrl, max: 3 }));

export async function makeUser(plan: PlanId = "pro") {
  const id = randomUUID();
  await appDb().withSystem("test.makeUser", (tx) =>
    tx.insert(users).values({ id, name: "T " + id.slice(0, 4), email: `${id}@test.local`, plan }),
  );
  return id;
}

export async function makeInvestigation(
  userId: string,
  over: Partial<typeof investigations.$inferInsert> = {},
) {
  const id = randomUUID();
  await appDb().withSystem("test.makeInvestigation", (tx) =>
    tx.insert(investigations).values({
      id,
      userId,
      query: "test query",
      depth: "standard",
      status: "ingesting",
      engineRunId: `run-${id}`,
      ...over,
    }),
  );
  return { id, runId: `run-${id}` };
}

export const INV_TABLES = [
  "inv_entities",
  "inv_relationships",
  "inv_actors",
  "inv_sources",
  "inv_summary",
  "inv_exports",
] as const;

/** Everything stored for an investigation in every snapshot table, as one searchable string. */
export async function dumpSnapshot(investigationId: string): Promise<string> {
  const parts: string[] = [];
  for (const t of INV_TABLES) {
    const { rows } = await ownerPool().query(
      `select row_to_json(x)::text as j from ${t} x where investigation_id = $1`,
      [investigationId],
    );
    parts.push(...rows.map((r) => r.j as string));
  }
  const { rows: ex } = await ownerPool().query(
    `select convert_from(content, 'UTF8') as c from inv_exports where investigation_id = $1`,
    [investigationId],
  );
  parts.push(...ex.map((r) => r.c as string));
  return parts.join("\n");
}

export async function counts(investigationId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of [...INV_TABLES, "credential_vault"]) {
    const { rows } = await ownerPool().query(`select count(*)::int n from ${t} where investigation_id = $1`, [
      investigationId,
    ]);
    out[t] = rows[0].n;
  }
  return out;
}
