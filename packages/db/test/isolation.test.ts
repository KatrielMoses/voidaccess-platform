import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { addMonths, grantMonthly, reserve, topup } from "../src";
import { DEV_CONTEXT_KEY, signUserContext } from "../src/client";
import {
  accounts,
  foundingNotices,
  invActors,
  invEntities,
  invExports,
  invRelationships,
  invSources,
  invSummary,
  investigations,
  payments,
  runEvents,
  sessions,
  subscriptions,
} from "../src/schema";
import { appDb, makeUser, ownerPool, pgError } from "./helpers";

const db = appDb();
let A: string;
let B: string;
let invB: string;
const ids: Record<string, string> = {}; // table -> a row id owned by B

/** Every table with a user_id column MUST be seeded here, or the coverage test below fails. */
beforeAll(async () => {
  A = await makeUser("pro");
  B = await makeUser("pro");
  await db.withSystem("test.seed", async (tx) => {
    const [inv] = await tx
      .insert(investigations)
      .values({ userId: B, query: "b secret query", depth: "standard" })
      .returning({ id: investigations.id });
    invB = inv!.id;
    ids.investigations = invB;
    const base = { userId: B, investigationId: invB };
    await tx.insert(runEvents).values({ runId: invB, userId: B, seq: 1, type: "stage", at: new Date() });
    await tx
      .insert(invEntities)
      .values({ ...base, bundleId: "e1", type: "email", displayValue: "j***@x.com", confidence: 0.9 });
    await tx
      .insert(invRelationships)
      .values({ ...base, sourceBundleId: "e1", targetBundleId: "e2", type: "uses" });
    await tx.insert(invActors).values({ ...base, bundleId: "a1", handle: "h" });
    await tx
      .insert(invSources)
      .values({ ...base, bundleId: "s1", kind: "paste", name: "n", fetchedAt: new Date() });
    await tx.insert(invSummary).values({ ...base, markdown: "m", confidence: "low" });
    await tx.insert(invExports).values({ ...base, format: "csv", objectPath: "x" });
    const [sub] = await tx
      .insert(subscriptions)
      .values({ userId: B, providerSubscriptionId: "sub_" + B, plan: "pro", status: "active" })
      .returning({ id: subscriptions.id });
    await tx.insert(payments).values({
      userId: B,
      providerPaymentId: "pay_" + B,
      amountCents: 900,
      kind: "subscription",
      paidAt: new Date(),
    });
    await tx
      .insert(foundingNotices)
      .values({ userId: B, seatNo: 1, kind: "release_day", refAt: new Date(), scheduledFor: new Date() });
    await tx.insert(sessions).values({ userId: B, token: "tok_" + B, expiresAt: addMonths(new Date(), 1) });
    await tx.insert(accounts).values({ userId: B, accountId: B, providerId: "credential" });
    void sub;
  });
  await grantMonthly(B, "pro", new Date(), { database: db });
  await topup(B, 10, "pay_topup_" + B, { database: db });
  await db.withUser(B, async (tx) => {
    const [i2] = await tx
      .insert(investigations)
      .values({ userId: B, query: "q2", depth: "quick" })
      .returning({ id: investigations.id });
    await reserve(B, i2!.id, "quick", { tx });
  });
});

async function tenantTables(): Promise<string[]> {
  const { rows } = await ownerPool().query(
    `select c.table_name from information_schema.columns c
     join information_schema.tables t on t.table_name=c.table_name and t.table_schema=c.table_schema
     where c.table_schema='public' and c.column_name='user_id' and t.table_type='BASE TABLE' order by 1`,
  );
  return rows.map((r) => r.table_name);
}

/** A query result of zero rows, or a permission/RLS error, both mean "isolated". */
async function attempt(userId: string | null, query: string): Promise<{ rows: number } | { denied: string }> {
  const client = await db.pool.connect();
  try {
    await client.query("begin");
    // exactly what withUser does: the id plus its signature (an unsigned id is ignored, see role-split.test.ts)
    if (userId)
      await client.query("select set_config('app.user_id', $1, true), set_config('app.user_sig', $2, true)", [
        userId,
        signUserContext(DEV_CONTEXT_KEY, userId),
      ]);
    const r = await client.query(query);
    await client.query("rollback");
    return { rows: r.rowCount ?? 0 };
  } catch (e) {
    await client.query("rollback").catch(() => {});
    return { denied: (e as { code?: string }).code ?? String(e) };
  } finally {
    client.release();
  }
}

describe("tenant isolation (RLS)", () => {
  it("every tenant table (has user_id) is covered by the seed above", async () => {
    const covered = new Set([
      "investigations",
      "run_events",
      "inv_entities",
      "inv_relationships",
      "inv_actors",
      "inv_sources",
      "inv_summary",
      "inv_exports",
      "credit_ledger",
      "topup_lots",
      "subscriptions",
      "payments",
      "founding_notices",
      "sessions",
      "accounts",
      // system-only tables with a user_id: no app grants at all, checked in the system-only test
      "events",
      "abuse_flags",
      "credential_vault",
      "billing_customers", // P5: system-only
      "billing_events",
      "billing_alerts",
      "rate_limit_events", // H1: system-only
    ]);
    const missing = (await tenantTables()).filter((t) => !covered.has(t));
    expect(missing, "new tenant table: add it to the isolation seed + this list").toEqual([]);
  });

  it("user A sees none of user B's rows, via withUser and via raw app-role SQL", async () => {
    const tables = (await tenantTables()).filter(
      (t) =>
        ![
          "events",
          "abuse_flags",
          "credential_vault",
          "billing_customers",
          "billing_events",
          "billing_alerts",
          "rate_limit_events", // H1: system-only
        ].includes(t),
    );
    for (const t of tables) {
      // ground truth: B has rows (owner connection, bypasses RLS)
      const truth = await ownerPool().query(`select count(*)::int n from ${t} where user_id = $1`, [B]);
      expect(truth.rows[0].n, `seed missing for ${t}`).toBeGreaterThan(0);

      for (const who of [A, null]) {
        const r = await attempt(who, `select * from ${t} where user_id = '${B}'`);
        expect("rows" in r ? r.rows : 0, `${t} as ${who ? "A" : "no-user"}`).toBe(0);
        const all = await attempt(who, `select * from ${t}`);
        if ("rows" in all) expect(all.rows, `${t} unfiltered as ${who ? "A" : "no-user"}`).toBe(0);
      }
    }
  });

  it("owner of the rows can read them where the app role has a SELECT grant (so zero above is RLS, not a broken grant)", async () => {
    for (const t of [
      "investigations",
      "run_events",
      "inv_entities",
      "inv_summary",
      "credit_ledger",
      "topup_lots",
      "subscriptions",
      "payments",
    ]) {
      const r = await attempt(B, `select * from ${t}`);
      expect("rows" in r && r.rows, t).toBeGreaterThan(0);
    }
  });

  it("A cannot update or delete B's rows (0 rows or denied), even with the id forged", async () => {
    for (const q of [
      `update investigations set query='pwn' where id='${invB}'`,
      `delete from investigations where id='${invB}'`,
      `update users set name='pwn' where id='${B}'`,
      `delete from credit_ledger where user_id='${B}'`,
      `update topup_lots set remaining=9999 where user_id='${B}'`,
      `update inv_entities set display_value='x' where user_id='${B}'`,
    ]) {
      const r = await attempt(A, q);
      expect("rows" in r ? r.rows : 0, q).toBe(0);
    }
    const still = await ownerPool().query(`select query from investigations where id=$1`, [invB]);
    expect(still.rows[0].query).toBe("b secret query");
  });

  it("a forged user_id on insert is rejected (investigations, ledger)", async () => {
    const forged = await attempt(
      A,
      `insert into investigations (user_id, query, depth) values ('${B}', 'x', 'quick')`,
    );
    expect("denied" in forged && forged.denied).toBe("42501"); // RLS WITH CHECK violation
    const own = await attempt(
      A,
      `insert into investigations (user_id, query, depth) values ('${A}', 'x', 'quick')`,
    );
    expect(own).toEqual({ rows: 1 });
    const ledger = await attempt(
      A,
      `insert into credit_ledger (user_id, bucket, amount, reason, idempotency_key) values ('${B}', 'grant', -5, 'reserve', '${randomUUID()}')`,
    );
    expect("denied" in ledger).toBe(true);
    // a user cannot mint credits for themselves either: only negative 'reserve' rows are insertable by the app role
    const mint = await attempt(
      A,
      `insert into credit_ledger (user_id, bucket, amount, reason, idempotency_key) values ('${A}', 'grant', 100000, 'grant', '${randomUUID()}')`,
    );
    expect("denied" in mint).toBe(true);
    // and cannot reassign ownership of their own row
    const mv = await attempt(A, `update investigations set user_id='${B}' where user_id='${A}'`);
    expect("denied" in mv || ("rows" in mv && mv.rows === 0)).toBe(true);
  });

  it("system-only tables are unreachable from the app role", async () => {
    for (const t of [
      "events",
      "abuse_flags",
      "audit_log",
      "run_costs",
      "credential_vault",
      "verifications",
      "billing_catalog", // P5
      "billing_customers",
      "billing_events",
      "billing_alerts",
      "rate_limit_events", // H1: system-only
      "archive_jobs", // P4: the archive work queue
      "archive_removed_pages",
      "rate_limits", // H1
      "blocked_email_domains",
      "app_ctx_key",
    ]) {
      const r = await attempt(A, `select * from ${t}`);
      expect("denied" in r && r.denied, t).toBe("42501");
    }
    const acct = await attempt(A, `select * from accounts`);
    expect("denied" in acct).toBe(true); // password hashes and tokens never readable by the app role
  });

  it("the app role cannot escalate by SET ROLE inheritance tricks or forging app.system", async () => {
    // plain va_app session must not see anything even if it sets arbitrary GUCs
    const r = await attempt(
      null,
      `select set_config('app.system','on',true), (select count(*) from investigations)::text`,
    );
    expect(r).toEqual({ rows: 1 });
    const c = await db.pool.query("select count(*)::int n from investigations");
    expect(c.rows[0].n).toBe(0);
  });

  it("withSystem sees across tenants and leaves an audit row; withUser(non-uuid) throws", async () => {
    const n = await db.withSystem("test.system-read", async (tx) => {
      const res = await tx.execute<{ n: number }>(sql`select count(*)::int n from investigations`);
      return res.rows[0]!.n;
    });
    expect(n).toBeGreaterThanOrEqual(2);
    const a = await ownerPool().query(
      `select count(*)::int n from audit_log where meta->>'reason' = 'test.system-read'`,
    );
    expect(a.rows[0].n).toBe(1);
    await expect(db.withUser("1; drop table users", async () => 1)).rejects.toThrow();
  });

  it("snapshot tables are immutable and the ledger is append-only, even for the system role", async () => {
    const upd = await pgError(
      db.withSystem("test.mutate", (tx) =>
        tx.execute(sql`update inv_entities set display_value='z' where user_id=${B}`),
      ),
    );
    expect(upd.message).toMatch(/immutable/);
    const del = await pgError(
      db.withSystem("test.mutate", (tx) => tx.execute(sql`delete from credit_ledger where user_id=${B}`)),
    );
    expect(del.code).toBe("42501"); // no DELETE grant even for the system role
    await expect(
      ownerPool().query(`update credit_ledger set amount = amount + 1 where user_id = $1`, [B]),
    ).rejects.toThrow(/append-only/);
    await expect(ownerPool().query(`truncate credit_ledger`)).rejects.toThrow();
  });
});
