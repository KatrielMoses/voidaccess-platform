import { and, desc, eq } from "drizzle-orm";
import { getDatabase, subscriptions } from "@voidaccess/db";
import { alertLevel, creditUsage, sendDueAlerts } from "./alerts";
import { dateFmt } from "./format";
import type { BannerState } from "@/components/billing/alert-banner";

/** The in-app banner state; also fires any due 80% / 100% email inline (once per period). Never throws. */
export async function loadAlertBanner(userId: string): Promise<BannerState> {
  const none: BannerState = { level: null, pct: 0, resetDate: "", key: "" };
  try {
    const db = getDatabase();
    const [sub] = await db.withUser(userId, (tx) =>
      tx
        .select({ status: subscriptions.status })
        .from(subscriptions)
        .where(and(eq(subscriptions.userId, userId)))
        .orderBy(desc(subscriptions.createdAt))
        .limit(1),
    );
    if (sub?.status === "past_due") return { ...none, level: "past_due", key: "pd" };
    const usage = await creditUsage(userId, db);
    const level = alertLevel(usage);
    if (!usage || !level) return none;
    await sendDueAlerts(userId, db);
    return {
      level,
      pct: Math.round(usage.pct * 100),
      resetDate: dateFmt(usage.resetAt),
      key: usage.periodKey,
    };
  } catch (e) {
    console.error("alert banner failed", e instanceof Error ? e.message : e);
    return none;
  }
}
