/**
 * Admin role assignment. Deliberately NOT reachable from the UI or any API: it is the ops script
 * (`pnpm --filter @voidaccess/app admin:grant-role -- --email ... --reason ...`), run with the OWNER database URL
 * (MIGRATE_DATABASE_URL). The app role cannot update users.role (column grants), so even a bug in the app can't mint an admin.
 * Every change writes an audit_log row in the same transaction.
 */
import pg from "pg";

export interface RoleChange {
  email: string;
  role: "admin" | "user";
  reason: string;
  /** who is running the script, recorded as `ops:<actor>` */
  actor: string;
}
export interface RoleChangeResult {
  userId: string;
  from: "admin" | "user";
  to: "admin" | "user";
  changed: boolean;
}

export async function setUserRole(connectionString: string, c: RoleChange): Promise<RoleChangeResult> {
  const reason = c.reason.trim();
  if (reason.length < 8) throw new Error("--reason is required (at least 8 characters)");
  if (!c.actor.trim()) throw new Error("an actor is required");
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    const who = await pool.query<{ u: string; super: boolean }>(
      "select current_user as u, (select rolsuper from pg_roles where rolname = current_user) as super",
    );
    if (who.rows[0]!.u === "va_app" || who.rows[0]!.u === "va_system")
      throw new Error(
        `refusing to run as ${who.rows[0]!.u}: use the owner database URL (MIGRATE_DATABASE_URL)`,
      );
    const client = await pool.connect();
    try {
      await client.query("begin");
      const found = await client.query<{ id: string; role: "admin" | "user" }>(
        "select id, role from users where lower(email) = lower($1) for update",
        [c.email.trim()],
      );
      const u = found.rows[0];
      if (!u) throw new Error(`no user with email ${c.email}`);
      const changed = u.role !== c.role;
      if (changed) await client.query("update users set role = $2 where id = $1", [u.id, c.role]);
      await client.query("insert into audit_log (actor, action, target, meta) values ($1, $2, $3, $4)", [
        `ops:${c.actor.trim()}`,
        c.role === "admin" ? "admin.role.grant" : "admin.role.revoke",
        u.id,
        JSON.stringify({
          targetUserId: u.id,
          email: c.email.trim().toLowerCase(),
          from: u.role,
          to: c.role,
          reason,
          changed,
        }),
      ]);
      await client.query("commit");
      return { userId: u.id, from: u.role, to: c.role, changed };
    } catch (e) {
      await client.query("rollback").catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}
