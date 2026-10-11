import { describe, expect, it } from "vitest";
import { ownerPool, appDb } from "./helpers";
import { sql } from "drizzle-orm";

const ARCHIVE = ["archive_entities", "archive_sources", "archive_observations", "archive_relationships", "archive_aliases"];
// tables owned by other lanes may be added here with their lane noted
const NO_RLS_ALLOWED = new Set<string>([...ARCHIVE, "waitlist" /* P1 SITE: public signup, system-written */]);

describe("schema guards", () => {
  it("archive tables have no tenant, query or investigation columns", async () => {
    const { rows } = await ownerPool().query(
      `select table_name, column_name from information_schema.columns
       where table_schema='public' and table_name like 'archive\\_%'`,
    );
    const tables = new Set(rows.map((r) => r.table_name));
    for (const t of ARCHIVE) expect(tables.has(t), `${t} missing`).toBe(true);
    const bad = rows.filter((r) => /user|query|investigation|session|owner|account|tenant|email|ip_addr/i.test(r.column_name));
    expect(bad).toEqual([]);
    // and no foreign key from an archive table to any tenant table
    const fks = await ownerPool().query(
      `select conrelid::regclass::text as t, confrelid::regclass::text as ref from pg_constraint
       where contype='f' and conrelid::regclass::text like 'archive\\_%'`,
    );
    for (const r of fks.rows) expect(r.ref.startsWith("archive_"), `${r.t} -> ${r.ref}`).toBe(true);
  });

  it("every public table has RLS enabled unless explicitly allowed", async () => {
    const { rows } = await ownerPool().query(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relkind='r'`,
    );
    const missing = rows.filter((r) => !r.relrowsecurity && !NO_RLS_ALLOWED.has(r.relname)).map((r) => r.relname);
    expect(missing).toEqual([]);
  });

  it("every table with user_id has an own-row policy for va_app or is system-only", async () => {
    const { rows } = await ownerPool().query(
      `select c.table_name,
         exists (select 1 from pg_policies p where p.tablename=c.table_name and 'va_app' = any(p.roles)) as has_app_policy,
         has_table_privilege('va_app', format('public.%I', c.table_name), 'select') as app_select
       from information_schema.columns c join information_schema.tables t on t.table_name=c.table_name and t.table_schema=c.table_schema
       where c.table_schema='public' and c.column_name='user_id' and t.table_type='BASE TABLE'`,
    );
    // an app SELECT grant without an app policy would mean deny-all; a policy without grant is harmless
    for (const r of rows.filter((r) => r.app_select)) expect(r.has_app_policy, r.table_name).toBe(true);
  });

  it("app role is not owner, superuser or BYPASSRLS; system role is reachable only via SET ROLE", async () => {
    const { rows } = await ownerPool().query(
      `select rolname, rolsuper, rolbypassrls, rolcreaterole from pg_roles where rolname in ('va_app','va_system')`,
    );
    for (const r of rows) {
      expect(r.rolsuper).toBe(false);
      expect(r.rolbypassrls).toBe(false);
      expect(r.rolcreaterole).toBe(false);
    }
    const own = await ownerPool().query(
      `select count(*)::int as n from pg_tables where schemaname='public' and tableowner in ('va_app','va_system')`,
    );
    expect(own.rows[0].n).toBe(0);
    const res = await appDb().db.execute(sql`select current_user as u, pg_has_role(current_user, 'va_system', 'USAGE') as inherits`);
    expect(res.rows[0]).toMatchObject({ u: "va_app", inherits: false });
  });
});
