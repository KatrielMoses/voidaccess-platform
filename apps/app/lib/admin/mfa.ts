/**
 * The owner's authenticator (TOTP) for the admin console. No table of its own: the secret lives only in the
 * encrypted credential vault (envelope AES-256-GCM, KMS in production, every decrypt audited), as kind
 * "admin_totp" for the owner's user id; an enrolment in progress is "admin_totp_pending" and expires after
 * PENDING_TTL_MS. The secret is generated and kept on the server, so a client can neither choose nor swap it.
 *
 * Replay: the last accepted time step is the newest audit_log row "admin.mfa.verified" {step} for the user; a step
 * at or before it is refused. Brute force: at most MFA_MAX_FAILS wrong codes per MFA_WINDOW_SECONDS per user (the
 * shared DB-backed limiter). Every enrolment, success and failure is audited; codes and secrets never are, and
 * nothing here logs them.
 *
 * Re-enrolment is an ops step (scripts/admin-mfa-reset.ts), never the UI.
 */
import { and, desc, eq, lte, sql } from "drizzle-orm";
import {
  credentialVault,
  decryptCredential,
  getDatabase,
  storeCredential,
  type Database,
  type Tx,
} from "@voidaccess/db";
import { createAuthRateLimitStorage } from "@/lib/rate-limit";
import { isReplay, matchTotp, newTotpSecret } from "./totp";
import { writeAudit } from "./audit";

export const TOTP_KIND = "admin_totp";
export const TOTP_PENDING_KIND = "admin_totp_pending";
export const PENDING_TTL_MS = 15 * 60_000;
export const MFA_MAX_FAILS = 5;
export const MFA_WINDOW_SECONDS = 600;

type Opts = { database?: Database; now?: Date };
const dbOf = (o?: Opts) => o?.database ?? getDatabase();
const nowOf = (o?: Opts) => o?.now ?? new Date();
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;
const limitKey = (userId: string) => `admin-mfa:${userId}`;

async function lockUser(tx: Tx, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"admin-mfa:" + userId}, 0))`);
}

async function confirmedId(tx: Tx, userId: string): Promise<string | null> {
  const [r] = await tx
    .select({ id: credentialVault.id })
    .from(credentialVault)
    .where(and(eq(credentialVault.userId, userId), eq(credentialVault.kind, TOTP_KIND)))
    .orderBy(desc(credentialVault.createdAt))
    .limit(1);
  return r?.id ?? null;
}

async function freshPending(tx: Tx, userId: string, now: Date) {
  const [r] = await tx
    .select({ id: credentialVault.id, createdAt: credentialVault.createdAt })
    .from(credentialVault)
    .where(
      and(
        eq(credentialVault.userId, userId),
        eq(credentialVault.kind, TOTP_PENDING_KIND),
        sql`${credentialVault.createdAt} > ${ts(new Date(now.getTime() - PENDING_TTL_MS))}`,
      ),
    )
    .orderBy(desc(credentialVault.createdAt))
    .limit(1);
  return r ?? null;
}

/** The last accepted time step for the user, from the audit trail (null before the first success). */
async function lastStep(tx: Tx, userId: string): Promise<number | null> {
  const r = await tx.execute<{ s: string | null }>(sql`select max((meta->>'step')::bigint)::text as s
    from audit_log where action = 'admin.mfa.verified' and actor = ${userId}`);
  const v = r.rows[0]?.s;
  return v == null ? null : Number(v);
}

export async function isEnrolled(userId: string, o?: Opts): Promise<boolean> {
  return dbOf(o).withSystem("admin.mfa.state", async (tx) => (await confirmedId(tx, userId)) !== null, {
    audit: false,
  });
}

/**
 * The enrolment in progress for the owner: reuses an unexpired pending secret (so a reload shows the same QR) or
 * creates a new one. Expired pending rows are deleted. Refuses when an authenticator is already enrolled.
 */
export async function pendingEnrolment(
  userId: string,
  o?: Opts,
): Promise<{ secret: string; expiresAt: Date }> {
  const db = dbOf(o);
  const now = nowOf(o);
  const found = await db.withSystem(
    "admin.mfa.enrol",
    async (tx) => {
      await lockUser(tx, userId);
      if (await confirmedId(tx, userId)) throw new Error("already enrolled");
      await tx
        .delete(credentialVault)
        .where(
          and(
            eq(credentialVault.userId, userId),
            eq(credentialVault.kind, TOTP_PENDING_KIND),
            lte(credentialVault.createdAt, new Date(now.getTime() - PENDING_TTL_MS)),
          ),
        );
      const p = await freshPending(tx, userId, now);
      if (p) return { id: p.id, createdAt: p.createdAt, secret: null as string | null };
      const secret = newTotpSecret();
      const s = await storeCredential({ userId, type: TOTP_PENDING_KIND, value: secret }, { tx });
      await writeAudit(tx, { actor: userId, action: "admin.mfa.enrol_started", target: userId });
      return { id: s.id, createdAt: now, secret };
    },
    { audit: false },
  );
  const secret =
    found.secret ??
    (await decryptCredential(found.id, { actor: userId, reason: "admin.mfa.enrol" }, { database: db }));
  return { secret, expiresAt: new Date(found.createdAt.getTime() + PENDING_TTL_MS) };
}

export type VerifyResult =
  | { ok: true; enrolled: boolean; step: number }
  | { ok: false; error: "invalid_code" | "too_many_attempts" | "enrolment_expired" };

const fail = (tx: Tx, userId: string, reason: string, phase: "enrol" | "verify") =>
  writeAudit(tx, { actor: userId, action: "admin.mfa.failed", target: userId, meta: { reason, phase } });

/**
 * Check a code. Before enrolment it confirms the pending secret (only then is "admin_totp" stored); afterwards it
 * verifies against the enrolled one. A success records the step (replay guard) and clears the attempt counter.
 */
export async function verifyAdminCode(userId: string, code: string, o?: Opts): Promise<VerifyResult> {
  const db = dbOf(o);
  const now = nowOf(o);
  const audit = (reason: string, phase: "enrol" | "verify") =>
    db.withSystem("admin.mfa.audit", (tx) => fail(tx, userId, reason, phase), { audit: false });

  const limit = await createAuthRateLimitStorage(() => db).consume(limitKey(userId), {
    window: MFA_WINDOW_SECONDS,
    max: MFA_MAX_FAILS,
  });
  const state = await db.withSystem(
    "admin.mfa.state",
    async (tx) => ({
      confirmed: await confirmedId(tx, userId),
      pending: await freshPending(tx, userId, now),
      last: await lastStep(tx, userId),
    }),
    { audit: false },
  );
  const phase = state.confirmed ? "verify" : "enrol";
  if (!limit.allowed) {
    await audit("rate_limited", phase);
    return { ok: false, error: "too_many_attempts" };
  }
  const vaultId = state.confirmed ?? state.pending?.id;
  if (!vaultId) {
    await audit("enrolment_expired", phase);
    return { ok: false, error: "enrolment_expired" };
  }
  const secret = await decryptCredential(
    vaultId,
    { actor: userId, reason: `admin.mfa.${phase}` },
    { database: db },
  );
  const step = matchTotp(secret, code, now.getTime(), state.last);
  if (step === null) {
    await audit(isReplay(secret, code, now.getTime(), state.last) ? "replay" : "wrong_code", phase);
    return { ok: false, error: "invalid_code" };
  }

  const result = await db.withSystem(
    "admin.mfa.verify",
    async (tx): Promise<VerifyResult> => {
      await lockUser(tx, userId);
      // re-read under the lock: two requests with the same code can't both pass
      const last = await lastStep(tx, userId);
      if (last !== null && step <= last) {
        await fail(tx, userId, "replay", phase);
        return { ok: false, error: "invalid_code" };
      }
      const enrolling = !state.confirmed;
      if (enrolling) {
        if (await confirmedId(tx, userId)) {
          await fail(tx, userId, "already_enrolled", phase);
          return { ok: false, error: "invalid_code" };
        }
        await storeCredential({ userId, type: TOTP_KIND, value: secret }, { tx });
        await tx
          .delete(credentialVault)
          .where(and(eq(credentialVault.userId, userId), eq(credentialVault.kind, TOTP_PENDING_KIND)));
        await writeAudit(tx, { actor: userId, action: "admin.mfa.enrolled", target: userId });
      }
      await writeAudit(tx, { actor: userId, action: "admin.mfa.verified", target: userId, meta: { step } });
      return { ok: true, enrolled: enrolling, step };
    },
    { audit: false },
  );
  if (result.ok)
    await db.withSystem(
      "admin.mfa.reset-limit",
      (tx) => tx.execute(sql`delete from rate_limits where key = ${limitKey(userId)}`),
      { audit: false },
    );
  return result;
}

/** "Lock now": audited; the route clears the cookie. */
export async function auditLock(userId: string, o?: Opts) {
  await dbOf(o).withSystem(
    "admin.mfa.lock",
    (tx) => writeAudit(tx, { actor: userId, action: "admin.mfa.locked", target: userId }),
    { audit: false },
  );
}
