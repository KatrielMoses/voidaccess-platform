// Account deletion. The credit ledger is append-only and credit_ledger.user_id is ON DELETE RESTRICT, so the
// users row cannot be hard-deleted. Instead, inside ONE `withSystem("account.delete")` transaction we:
//   1. release a held founding seat (releaseFoundingSeat) and delete the user's founding notices,
//   2. delete tenant rows: investigations (cascades run_events, inv_* snapshot rows, run_costs and per-investigation
//      vault rows), credential_vault, payments, subscriptions, sessions, accounts, verification tokens,
//   3. detach analytics events (events.user_id -> NULL),
//   4. anonymise the users row: email deleted-<id>@deleted.invalid, name "Deleted user", profile / first touch /
//      referral code cleared, status 'banned' (requireUser rejects it; no credentials remain, so sign-in is impossible),
//   5. write an audit_log row (action account.delete, actor = the user).
// Kept on purpose: credit_ledger + topup_lots (immutable accounting history, now attached to an anonymous row) and
// abuse_flags (safety evidence). Nothing else keeps personal data.
import { and, eq, or, sql } from "drizzle-orm";
import { getDatabase, releaseFoundingSeat } from "@voidaccess/db";
import {
  accounts,
  auditLog,
  credentialVault,
  events,
  foundingNotices,
  investigations,
  payments,
  sessions,
  subscriptions,
  users,
  verifications,
} from "@voidaccess/db/schema";

export interface DeleteAccountResult {
  investigationsDeleted: number;
  anonymisedEmail: string;
}

export async function deleteAccount(userId: string): Promise<DeleteAccountResult | null> {
  return getDatabase().withSystem("account.delete", async (tx) => {
    const [u] = await tx
      .select({ email: users.email, status: users.status })
      .from(users)
      .where(eq(users.id, userId));
    if (!u) return null;
    const anonymisedEmail = `deleted-${userId}@deleted.invalid`;

    await releaseFoundingSeat(userId, "account_closed", { tx });
    await tx.delete(foundingNotices).where(eq(foundingNotices.userId, userId));

    const removed = await tx
      .delete(investigations)
      .where(eq(investigations.userId, userId))
      .returning({ id: investigations.id });
    await tx.delete(credentialVault).where(eq(credentialVault.userId, userId));
    await tx.delete(payments).where(eq(payments.userId, userId));
    await tx.delete(subscriptions).where(eq(subscriptions.userId, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(accounts).where(eq(accounts.userId, userId));
    await tx
      .delete(verifications)
      .where(
        or(eq(verifications.identifier, u.email), sql`${verifications.value} like ${"%" + u.email + "%"}`),
      );
    await tx.update(events).set({ userId: null }).where(eq(events.userId, userId));

    await tx
      .update(users)
      .set({
        email: anonymisedEmail,
        name: "Deleted user",
        image: null,
        emailVerified: false,
        profileRole: null,
        profileUseCase: null,
        firstTouch: null,
        referralCode: null,
        status: "banned",
      })
      .where(and(eq(users.id, userId)));

    await tx.insert(auditLog).values({
      actor: userId,
      action: "account.delete",
      target: userId,
      meta: { investigations: removed.length, previouslyActive: u.status === "active" },
    });
    return { investigationsDeleted: removed.length, anonymisedEmail };
  });
}
