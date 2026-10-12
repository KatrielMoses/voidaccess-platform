/**
 * Ledger operations billing needs that packages/db's ledger.ts doesn't have. Same invariants: runs inside the
 * caller's transaction (so the plan change and the credits commit together), takes the per-user credit lock,
 * and is idempotent through a unique ledger key.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { creditLedger, lockUserCredits, type Tx } from "@voidaccess/db";

/** Extra grant-bucket credits for a mid-period upgrade (the difference between the two plans' monthly credits). Once per key. */
export async function grantPlanDifference(
  tx: Tx,
  userId: string,
  credits: number,
  key: string,
  fallbackExpiry: Date,
): Promise<boolean> {
  if (credits <= 0) return false;
  await lockUserCredits(tx, userId);
  const idem = `grant-diff:${key}`;
  const [dup] = await tx
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(eq(creditLedger.idempotencyKey, idem));
  if (dup) return false;
  const [latest] = await tx
    .select({ expiresAt: creditLedger.expiresAt })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.userId, userId),
        eq(creditLedger.bucket, "grant"),
        eq(creditLedger.reason, "grant"),
      ),
    )
    .orderBy(desc(creditLedger.createdAt))
    .limit(1);
  await tx.insert(creditLedger).values({
    userId,
    bucket: "grant",
    amount: credits,
    reason: "grant",
    expiresAt: latest?.expiresAt ?? fallbackExpiry,
    idempotencyKey: idem,
  });
  return true;
}

/** When the latest monthly grant was written (the anchor for the next monthly grant), or null. */
export async function lastGrantAt(tx: Tx, userId: string): Promise<Date | null> {
  const [r] = await tx
    .select({ at: sql<Date | null>`max(${creditLedger.createdAt})` })
    .from(creditLedger)
    .where(
      and(
        eq(creditLedger.userId, userId),
        eq(creditLedger.bucket, "grant"),
        eq(creditLedger.reason, "grant"),
      ),
    );
  return r?.at ? new Date(r.at) : null;
}
