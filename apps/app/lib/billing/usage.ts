/** Credit ledger and balances for the usage page. Everything reads as the user (RLS), never by id from the client. */
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { creditLedger, getDatabase, topupLots, type Database } from "@voidaccess/db";

export const LEDGER_REASONS = [
  "reserve",
  "settle",
  "refund",
  "grant",
  "expiry",
  "topup",
  "bonus",
  "admin",
] as const;
export type LedgerReason = (typeof LEDGER_REASONS)[number];

export const REASON_LABEL: Record<string, string> = {
  reserve: "Investigation",
  settle: "Investigation (settled)",
  refund: "Refund",
  grant: "Monthly grant",
  expiry: "Expired credits",
  topup: "Top-up",
  bonus: "Top-up bonus",
  admin: "Admin grant",
};

export interface LedgerRow {
  id: string;
  at: Date;
  reason: string;
  bucket: string;
  amount: number;
  investigationId: string | null;
  investigationLabel: string | null;
  balanceAfter: number;
}

export interface LedgerFilter {
  reason?: string;
  /** YYYY-MM (UTC) */
  month?: string;
  limit?: number;
  offset?: number;
}

export const isMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

/** Newest first. `balanceAfter` is the running total over the user's whole ledger, so filters never distort it. */
export async function getLedger(
  userId: string,
  f: LedgerFilter = {},
  database: Database = getDatabase(),
): Promise<{ rows: LedgerRow[]; hasMore: boolean }> {
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 5000);
  const offset = Math.max(f.offset ?? 0, 0);
  const reason = f.reason && (LEDGER_REASONS as readonly string[]).includes(f.reason) ? f.reason : null;
  const month = f.month && isMonth(f.month) ? f.month : null;
  const res = await database.withUser(userId, (tx) =>
    tx.execute<{
      id: string;
      at: Date;
      reason: string;
      bucket: string;
      amount: number;
      investigation_id: string | null;
      label: string | null;
      balance_after: number;
    }>(sql`
      select * from (
        select l.id, l.created_at as at, l.reason::text as reason, l.bucket::text as bucket, l.amount, l.investigation_id,
               coalesce(i.title, i.query) as label,
               (sum(l.amount) over (order by l.created_at, l.id))::int as balance_after
        from credit_ledger l left join investigations i on i.id = l.investigation_id
        where l.user_id = ${userId}
      ) x
      where (${reason}::text is null or x.reason = ${reason})
        and (${month}::text is null or to_char(x.at at time zone 'UTC', 'YYYY-MM') = ${month})
      order by x.at desc, x.id desc
      limit ${limit + 1} offset ${offset}`),
  );
  const rows = res.rows.slice(0, limit).map((r) => ({
    id: r.id,
    at: new Date(r.at),
    reason: r.reason,
    bucket: r.bucket,
    amount: Number(r.amount),
    investigationId: r.investigation_id,
    investigationLabel: r.label,
    balanceAfter: Number(r.balance_after),
  }));
  return { rows, hasMore: res.rows.length > limit };
}

export interface Balances {
  grant: number;
  grantResetsAt: Date | null;
  lots: { id: string; remaining: number; expiresAt: Date }[];
  total: number;
}

export async function getBalances(
  userId: string,
  now = new Date(),
  database: Database = getDatabase(),
): Promise<Balances> {
  return database.withUser(userId, async (tx) => {
    const [g] = await tx
      .select({ n: sql<number>`coalesce(sum(${creditLedger.amount}), 0)::int` })
      .from(creditLedger)
      .where(and(eq(creditLedger.userId, userId), eq(creditLedger.bucket, "grant")));
    const [latest] = await tx
      .select({ at: creditLedger.expiresAt })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.userId, userId),
          eq(creditLedger.bucket, "grant"),
          eq(creditLedger.reason, "grant"),
        ),
      )
      .orderBy(sql`${creditLedger.createdAt} desc`)
      .limit(1);
    const lots = await tx
      .select({ id: topupLots.id, remaining: topupLots.remaining, expiresAt: topupLots.expiresAt })
      .from(topupLots)
      .where(and(eq(topupLots.userId, userId), gt(topupLots.remaining, 0), gt(topupLots.expiresAt, now)))
      .orderBy(asc(topupLots.expiresAt));
    const grant = Math.max(0, g?.n ?? 0);
    return {
      grant,
      grantResetsAt: latest?.at ?? null,
      lots,
      total: grant + lots.reduce((a, l) => a + l.remaining, 0),
    };
  });
}
