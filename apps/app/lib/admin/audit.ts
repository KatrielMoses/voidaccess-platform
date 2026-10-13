/** Admin audit trail: one audit_log row per read of user content and per change, written in the same transaction as the change. */
import type { Tx } from "@voidaccess/db";
import { auditLog } from "@voidaccess/db";
import { AdminError } from "./errors";
import { REASON_MAX, REASON_MIN } from "./constants";

/** A typed reason: trimmed, at least REASON_MIN characters, at most REASON_MAX. */
export function requireReason(raw: unknown): string {
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (reason.length < REASON_MIN)
    throw new AdminError(400, `A reason of at least ${REASON_MIN} characters is required`);
  if (reason.length > REASON_MAX)
    throw new AdminError(400, `The reason is too long (max ${REASON_MAX} characters)`);
  return reason;
}

export interface AuditEntry {
  actor: string; // the admin's user id (or `ops:<name>` for the CLI script)
  action: string; // admin.user.suspend, admin.credits.grant, ...
  target?: string | null; // what it acted on: a user id, `investigation:<id>`, `domain:<name>` ...
  reason?: string | null;
  meta?: Record<string, unknown>;
}

export async function writeAudit(tx: Tx, e: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    actor: e.actor,
    action: e.action,
    target: e.target?.slice(0, 300) ?? null,
    meta: { ...(e.reason ? { reason: e.reason } : {}), ...e.meta },
  });
}
