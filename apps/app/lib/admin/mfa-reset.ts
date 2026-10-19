/**
 * Ops-only re-enrolment of the admin authenticator: deletes the owner's "admin_totp" and "admin_totp_pending" vault
 * rows so the next console visit shows the enrolment screen again. Not reachable from the UI or any API; run
 * scripts/admin-mfa-reset.ts with the OWNER database URL (MIGRATE_DATABASE_URL). Audited (actor ops:<name>).
 * Existing step-up cookies stay valid until they expire (at most one hour); revoke the owner's sessions as well
 * if the authenticator was lost to someone else.
 */
import pg from "pg";

export const MFA_VAULT_KINDS = ["admin_totp", "admin_totp_pending"] as const;

export async function resetAdminMfa(
  connectionString: string,
  c: { email: string; reason: string; actor: string },
): Promise<{ userId: string; deleted: number }> {
  const reason = c.reason.trim();
  if (reason.length < 8) throw new Error("--reason is required (at least 8 characters)");
  if (!c.actor.trim()) throw new Error("an actor is required");
  const pool = new pg.Pool({ connectionString, max: 1 });
  try {
    const who = await pool.query<{ u: string }>("select current_user as u");
    if (who.rows[0]!.u === "va_app" || who.rows[0]!.u === "va_system")
      throw new Error(
        `refusing to run as ${who.rows[0]!.u}: use the owner database URL (MIGRATE_DATABASE_URL)`,
      );
    const client = await pool.connect();
    try {
      await client.query("begin");
      const found = await client.query<{ id: string }>(
        "select id from users where lower(email) = lower($1)",
        [c.email.trim()],
      );
      const u = found.rows[0];
      if (!u) throw new Error(`no user with email ${c.email}`);
      const del = await client.query("delete from credential_vault where user_id = $1 and kind = any($2)", [
        u.id,
        [...MFA_VAULT_KINDS],
      ]);
      await client.query("insert into audit_log (actor, action, target, meta) values ($1, $2, $3, $4)", [
        `ops:${c.actor.trim()}`,
        "admin.mfa.reset",
        u.id,
        JSON.stringify({ reason, deleted: del.rowCount ?? 0 }),
      ]);
      await client.query("commit");
      return { userId: u.id, deleted: del.rowCount ?? 0 };
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
