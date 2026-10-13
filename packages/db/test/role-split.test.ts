import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { DEV_CONTEXT_KEY, signUserContext } from "../src/client";
import { investigations } from "../src/schema";
import { appDb, makeUser, ownerPool, pgError } from "./helpers";

const db = appDb();
/** Postgres reports a refused SET ROLE as 22023 (invalid_parameter_value, "permission denied to set role"). */
const DENIED = ["42501", "22023"];
let A: string;
let B: string;
let invA: string;
let invB: string;

beforeAll(async () => {
  A = await makeUser("pro");
  B = await makeUser("pro");
  await db.withSystem("test.role-split.seed", async (tx) => {
    const [a] = await tx
      .insert(investigations)
      .values({ userId: A, query: "a query", depth: "quick" })
      .returning({ id: investigations.id });
    const [b] = await tx
      .insert(investigations)
      .values({ userId: B, query: "b secret query", depth: "quick" })
      .returning({ id: investigations.id });
    invA = a!.id;
    invB = b!.id;
  });
});

/** Run raw SQL on the app pool (va_app), the way an SQL-injection payload would: no withUser helper. */
async function rawApp<T extends object = Record<string, unknown>>(
  statements: string[],
  params: unknown[][] = [],
): Promise<T[][]> {
  const client = await db.pool.connect();
  try {
    await client.query("begin");
    const out: T[][] = [];
    for (const [i, s] of statements.entries()) out.push((await client.query(s, params[i] ?? [])).rows);
    await client.query("rollback");
    return out;
  } finally {
    client.release();
  }
}

describe("H1-1: the app login cannot escalate", () => {
  it("each pool connects as its own login; withSystem runs as va_system", async () => {
    expect((await db.pool.query("select current_user u")).rows[0].u).toBe("va_app");
    expect((await db.systemPool.query("select current_user u")).rows[0].u).toBe("va_worker");
    const inside = await db.withSystem("test.role-split.role", async (tx) => {
      const r = await tx.execute<{ u: string }>(sql`select current_user u`);
      return r.rows[0]!.u;
    });
    expect(inside).toBe("va_system");
  });

  it("va_app is a member of no role at all, and cannot SET ROLE to anything privileged", async () => {
    const m = await ownerPool().query(
      `select r.rolname from pg_auth_members am join pg_roles r on r.oid = am.roleid
       join pg_roles u on u.oid = am.member where u.rolname = 'va_app'`,
    );
    expect(m.rows).toEqual([]);
    const su = (await ownerPool().query(`select rolname from pg_roles where rolsuper order by oid limit 1`))
      .rows[0].rolname as string;
    for (const role of ["va_system", "va_worker", `"${su}"`, "pg_read_all_data", "pg_write_all_data"]) {
      const e = await pgError(db.pool.query(`set role ${role}`));
      expect(DENIED, role).toContain(e.code);
      expect(e.message, role).toMatch(/permission denied/);
    }
    const e = await pgError(db.pool.query(`set session authorization "${su}"`));
    expect(DENIED).toContain(e.code);
    // setting the role through a GUC is the same door
    const g = await pgError(db.pool.query(`select set_config('role', 'va_system', false)`));
    expect(DENIED).toContain(g.code);
    expect((await db.pool.query("select current_user u")).rows[0].u).toBe("va_app");
  });

  it("va_app cannot be made to bypass RLS: no BYPASSRLS, not superuser, cannot create roles", async () => {
    const { rows } = await ownerPool().query(
      `select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcanlogin, rolinherit from pg_roles
       where rolname in ('va_app','va_worker','va_system') order by 1`,
    );
    for (const r of rows) {
      expect(r.rolsuper, r.rolname).toBe(false);
      expect(r.rolbypassrls, r.rolname).toBe(false);
      expect(r.rolcreaterole, r.rolname).toBe(false);
    }
    expect(rows.find((r) => r.rolname === "va_system")!.rolcanlogin).toBe(false);
    expect(rows.find((r) => r.rolname === "va_app")!.rolcanlogin).toBe(true);
    expect(rows.find((r) => r.rolname === "va_worker")!.rolcanlogin).toBe(true);
  });

  it("a raw va_app session reads nothing of another user, even when it forges the tenant GUCs", async () => {
    // no context at all
    const [none] = await rawApp([`select count(*)::int n from investigations`]);
    expect(none![0]).toEqual({ n: 0 });

    // forged id, no signature (the old attack: one statement flips app.user_id)
    const [, forged] = await rawApp([
      `select set_config('app.user_id', '${B}', true)`,
      `select id from investigations`,
    ]);
    expect(forged).toEqual([]);

    // forged id with a signature made under a guessed key
    const wrong = signUserContext("a-guess-that-is-not-the-key-0000000000000", B);
    const [, guessed] = await rawApp([
      `select set_config('app.user_id', '${B}', true), set_config('app.user_sig', '${wrong}', true)`,
      `select id from investigations`,
    ]);
    expect(guessed).toEqual([]);

    // a sig that is valid for user A, replayed for user B's id
    const sigA = signUserContext(DEV_CONTEXT_KEY, A);
    const [, replayed] = await rawApp([
      `select set_config('app.user_id', '${B}', true), set_config('app.user_sig', '${sigA}', true)`,
      `select id from investigations`,
    ]);
    expect(replayed).toEqual([]);
  });

  it("inside withUser(A), flipping app.user_id to B in the SAME statement still returns nothing of B", async () => {
    const rows = await db.withUser(A, async (tx) => {
      const r = await tx.execute<{ id: string; query: string }>(
        sql`with flip as (select set_config('app.user_id', ${B}, true) as v)
            select i.id, i.query from flip, investigations i`,
      );
      return r.rows;
    });
    expect(rows.map((r) => r.id)).not.toContain(invB);
    expect(rows.every((r) => r.id !== invB)).toBe(true);
    // after the flip, the transaction is anonymous: A's own rows are gone too (fail closed), B's never appear
    const after = await db.withUser(A, async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${B}, true)`);
      return (await tx.execute<{ id: string }>(sql`select id from investigations`)).rows;
    });
    expect(after).toEqual([]);
  });

  it("what IS possible for a va_app session: acting as itself, and replaying its own signature", async () => {
    const own = await db.withUser(A, async (tx) => {
      const sig = (await tx.execute<{ s: string }>(sql`select current_setting('app.user_sig') s`)).rows[0]!.s;
      return { sig, rows: (await tx.execute<{ id: string }>(sql`select id from investigations`)).rows };
    });
    expect(own.rows.map((r) => r.id)).toEqual([invA]);
    expect(own.sig).toBe(signUserContext(DEV_CONTEXT_KEY, A)); // readable by its own session, useless for any other id
  });

  it("the context key is unreadable to every login, and app_user_id() cannot be coaxed into leaking it", async () => {
    for (const pool of [db.pool, db.systemPool]) {
      const e = await pgError(pool.query(`select key from app_ctx_key`));
      expect(e.code).toBe("42501");
    }
    const e = await pgError(
      db.withSystem("test.role-split.key", (tx) => tx.execute(sql`select key from app_ctx_key`)),
    );
    expect(e.code).toBe("42501");
    const w = await pgError(db.pool.query(`update app_ctx_key set key = repeat('x', 40)`));
    expect(w.code).toBe("42501");
    // fail closed: with the key removed no signature verifies
    const client = await ownerPool().connect();
    try {
      await client.query("begin");
      await client.query("delete from app_ctx_key");
      await client.query("select set_config('app.user_id', $1, true), set_config('app.user_sig', $2, true)", [
        A,
        signUserContext(DEV_CONTEXT_KEY, A),
      ]);
      const r = await client.query(`select app_user_id() as id`);
      expect(r.rows[0].id).toBeNull();
      await client.query("rollback");
    } finally {
      client.release();
    }
  });
});

describe("H1-1: va_worker is the only way into the system role", () => {
  it("va_worker owns no table privileges of its own: everything comes through va_system", async () => {
    const own = await ownerPool().query(
      `select count(*)::int n from pg_class c, lateral aclexplode(c.relacl) a
       where c.relnamespace = 'public'::regnamespace and a.grantee = 'va_worker'::regrole`,
    );
    expect(own.rows[0].n).toBe(0);
    const viaSystem = await ownerPool().query(
      `select pg_has_role('va_worker','va_system','USAGE') usage, pg_has_role('va_worker','va_system','MEMBER') member`,
    );
    expect(viaSystem.rows[0]).toEqual({ usage: true, member: true });
    const denied = await ownerPool().query(
      `select has_table_privilege('va_worker','public.app_ctx_key','select') ok`,
    );
    expect(denied.rows[0].ok).toBe(false);
  });

  it("withSystem still works through the system pool and still writes its audit row", async () => {
    const reason = "test.role-split.audit." + randomUUID();
    const n = await db.withSystem(reason, async (tx) => {
      const r = await tx.execute<{ n: number }>(sql`select count(*)::int n from investigations`);
      return r.rows[0]!.n;
    });
    expect(n).toBeGreaterThanOrEqual(2);
    const a = await ownerPool().query(`select count(*)::int n from audit_log where meta->>'reason' = $1`, [
      reason,
    ]);
    expect(a.rows[0].n).toBe(1);
    const quiet = "test.role-split.quiet." + randomUUID();
    await db.withSystem(quiet, async () => 1, { audit: false });
    const q = await ownerPool().query(`select count(*)::int n from audit_log where meta->>'reason' = $1`, [
      quiet,
    ]);
    expect(q.rows[0].n).toBe(0);
  });

  it("the ledger stays append-only for the worker login", async () => {
    const e = await pgError(db.systemPool.query(`delete from credit_ledger`));
    expect(e.code).toBe("42501");
  });

  it("createDatabase refuses to start without a system URL", async () => {
    const { createDatabase } = await import("../src/client");
    expect(() => createDatabase("postgres://x/y", { systemUrl: "", contextKey: DEV_CONTEXT_KEY })).toThrow(
      /systemUrl/,
    );
  });
});
