/**
 * Lifecycle email (welcome, first-investigation nudge, what-next): each goes to a user at most once.
 *
 * Exactly-once: a `lifecycle_emails` row (unique per user+kind) is claimed BEFORE sending, in the same transaction that
 * reads the user's consent. No row, no send. A failed send releases the claim so the next cron run retries.
 * Consent: with product email off the claim is recorded as `suppressed` and nothing is sent, so switching it back on
 * later never releases a stale nudge. Transactional email (receipts, results-ready, usage alerts) never comes through here.
 */
import { and, eq } from "drizzle-orm";
import { PLANS } from "@voidaccess/config";
import { getDatabase, lifecycleEmails, users, type Database } from "@voidaccess/db";
import { EMAIL_CONTENT, sendEmail } from "@voidaccess/emails";
import { getEnv } from "../../env";
import { unsubscribeOneClickUrl, unsubscribePageUrl } from "../ops/unsubscribe";

export type LifecycleKind = "welcome" | "first_investigation_nudge" | "what_next";
export type LifecycleResult = "sent" | "suppressed" | "duplicate" | "skipped" | "failed";

const num = (n: number) => n.toLocaleString("en-US");

export async function sendLifecycle(
  kind: LifecycleKind,
  userId: string,
  database: Database = getDatabase(),
): Promise<LifecycleResult> {
  const claim = await database.withSystem(
    "lifecycle.claim",
    async (tx) => {
      const [u] = await tx
        .select({
          email: users.email,
          name: users.name,
          status: users.status,
          emailVerified: users.emailVerified,
          productEmails: users.productEmails,
        })
        .from(users)
        .where(eq(users.id, userId));
      if (!u || u.status !== "active" || !u.emailVerified) return { result: "skipped" as const };
      const ins = await tx
        .insert(lifecycleEmails)
        .values({ userId, kind, status: u.productEmails ? "sent" : "suppressed" })
        .onConflictDoNothing()
        .returning({ id: lifecycleEmails.id });
      if (ins.length === 0) return { result: "duplicate" as const };
      if (!u.productEmails) return { result: "suppressed" as const };
      return { result: "send" as const, email: u.email, name: u.name };
    },
    { audit: false },
  );
  if (claim.result !== "send") return claim.result;

  const base = getEnv().APP_URL.replace(/\/$/, "");
  const common = { name: claim.name, url: `${base}/investigations/new` };
  const unsubscribeUrl = unsubscribePageUrl(userId);
  const opts = { oneClickUrl: unsubscribeOneClickUrl(userId) };
  try {
    if (kind === "welcome")
      await sendEmail(
        "welcome",
        claim.email,
        { ...common, freeCredits: num(PLANS.free.monthlyCredits), unsubscribeUrl },
        opts,
      );
    else if (kind === "first_investigation_nudge")
      await sendEmail(
        "firstInvestigationNudge",
        claim.email,
        { ...common, example: EMAIL_CONTENT.welcome.exampleQueries[0], unsubscribeUrl },
        opts,
      );
    else
      await sendEmail(
        "whatNext",
        claim.email,
        { ...common, billingUrl: `${base}/billing`, unsubscribeUrl },
        opts,
      );
    return "sent";
  } catch (e) {
    console.error(`lifecycle ${kind} email failed`, e instanceof Error ? e.message : e);
    await database.withSystem(
      "lifecycle.release",
      (tx) =>
        tx
          .delete(lifecycleEmails)
          .where(and(eq(lifecycleEmails.userId, userId), eq(lifecycleEmails.kind, kind))),
      { audit: false },
    );
    return "failed";
  }
}
