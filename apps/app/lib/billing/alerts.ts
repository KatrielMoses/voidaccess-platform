/**
 * Credit alerts at 80% and 100% of the monthly grant, once per user, kind and period. "Used" is measured
 * against the monthly grant bucket (top-up credits are separate). The same evaluation feeds the in-app banner
 * and the emails, and runs from the layout, the hourly cron and the billing page, so it fires inline.
 */
import { and, desc, eq, gte, like, sql } from "drizzle-orm";
import { TOPUP_EXPIRY_MONTHS } from "@voidaccess/config";
import { billingAlerts, creditLedger, getDatabase, type Database } from "@voidaccess/db";
import { sendEmail } from "@voidaccess/emails";
import { trackEvent } from "../analytics";
import { dateFmt, num } from "./format";
import { billingUrl, userContact } from "./post-effects";

export interface CreditUsage {
  granted: number;
  grantBalance: number;
  used: number;
  pct: number;
  resetAt: Date | null;
  periodKey: string;
}

export async function creditUsage(
  userId: string,
  database: Database = getDatabase(),
): Promise<CreditUsage | null> {
  return database.withUser(userId, async (tx) => {
    const [monthly] = await tx
      .select()
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.userId, userId),
          eq(creditLedger.bucket, "grant"),
          like(creditLedger.idempotencyKey, "grant:%"),
        ),
      )
      .orderBy(desc(creditLedger.createdAt))
      .limit(1);
    if (!monthly) return null;
    const [extra] = await tx
      .select({ n: sql<number>`coalesce(sum(${creditLedger.amount}), 0)::int` })
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.userId, userId),
          eq(creditLedger.bucket, "grant"),
          like(creditLedger.idempotencyKey, "grant-diff:%"),
          gte(creditLedger.createdAt, monthly.createdAt),
        ),
      );
    const [bal] = await tx
      .select({ n: sql<number>`coalesce(sum(${creditLedger.amount}), 0)::int` })
      .from(creditLedger)
      .where(and(eq(creditLedger.userId, userId), eq(creditLedger.bucket, "grant")));
    const granted = monthly.amount + (extra?.n ?? 0);
    const grantBalance = Math.max(0, bal?.n ?? 0);
    const used = Math.max(0, granted - grantBalance);
    return {
      granted,
      grantBalance,
      used,
      pct: granted > 0 ? used / granted : 0,
      resetAt: monthly.expiresAt,
      periodKey: monthly.id,
    };
  });
}

export type AlertLevel = "credits_80" | "credits_100" | null;
export const alertLevel = (u: CreditUsage | null): AlertLevel =>
  !u || u.granted <= 0 ? null : u.grantBalance <= 0 ? "credits_100" : u.pct >= 0.8 ? "credits_80" : null;

/** Sends any alert not yet sent for this period (80 and 100 are separate). Returns the kinds sent now. */
export async function sendDueAlerts(userId: string, database: Database = getDatabase()): Promise<string[]> {
  const usage = await creditUsage(userId, database);
  const level = alertLevel(usage);
  if (!usage || !level) return [];
  const kinds = level === "credits_100" ? ["credits_80", "credits_100"] : ["credits_80"];
  const sent: string[] = [];
  const contact = await userContact(userId);
  for (const kind of kinds) {
    const ins = await database.withSystem(
      "billing.alert",
      (tx) =>
        tx
          .insert(billingAlerts)
          .values({ userId, kind, periodKey: usage.periodKey })
          .onConflictDoNothing()
          .returning({ id: billingAlerts.id }),
      { audit: false },
    );
    if (ins.length === 0) continue; // already sent for this period
    sent.push(kind);
    await trackEvent(kind, { userId, props: { pct: Math.round(usage.pct * 100) } });
    // an email only for the highest crossed level, so a jump straight past 80% sends one message, not two
    if (contact && kind === level) {
      try {
        if (kind === "credits_80")
          await sendEmail("creditAlert80", contact.email, {
            name: contact.name,
            pct: String(Math.round(usage.pct * 100)),
            balance: num(usage.grantBalance),
            billingUrl: billingUrl(),
            expiryMonths: String(TOPUP_EXPIRY_MONTHS),
          });
        else
          await sendEmail("creditAlert100", contact.email, {
            name: contact.name,
            resetDate: dateFmt(usage.resetAt),
            billingUrl: billingUrl(),
            expiryMonths: String(TOPUP_EXPIRY_MONTHS),
          });
      } catch (e) {
        console.error("alert email failed", e instanceof Error ? e.message : e);
      }
    }
  }
  return sent;
}
