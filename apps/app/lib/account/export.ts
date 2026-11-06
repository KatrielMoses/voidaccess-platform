// Data export: JSON of the signed-in user's own rows. Every read runs under withUser (RLS) AND filters by the
// user id, so a policy mistake still cannot leak another account's data. Secrets (password hashes, OAuth/session
// tokens, vault ciphertext) are never selected.
// Preview lock (lib/access): report content of a run the account only has a PREVIEW of (Free plan, not paid with
// purchased top-up credits) is left out (snapshot rows, stored exports) or redacted (trace events, refined queries), so
// the data export is not a way around the paywall. `reportAccess` says which runs are full and which are previews.
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { FULL_PLANS, redactRefinedQueries, redactTraceData, type ReportAccess } from "@/lib/access";
import { getDatabase } from "@voidaccess/db";
import {
  creditLedger,
  foundingSeats,
  invActors,
  invEntities,
  invExports,
  invRelationships,
  invSources,
  invSummary,
  investigations,
  payments,
  runEvents,
  sessions,
  subscriptions,
  topupLots,
  users,
} from "@voidaccess/db/schema";

export async function exportAccountData(userId: string) {
  return getDatabase().withUser(userId, async (tx) => {
    const [user] = await tx
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        emailVerified: users.emailVerified,
        plan: users.plan,
        createdAt: users.createdAt,
        aupAcceptedAt: users.aupAcceptedAt,
        profileRole: users.profileRole,
        profileUseCase: users.profileUseCase,
        firstTouch: users.firstTouch,
        referralCode: users.referralCode,
      })
      .from(users)
      .where(eq(users.id, userId));
    const own = <T extends { userId: unknown }>(t: T) => eq(t.userId as never, userId);
    const invs = await tx.select().from(investigations).where(own(investigations));
    // same rule as getReportAccess, computed in this transaction for every run at once
    const paid = new Set(
      (
        await tx
          .selectDistinct({ id: creditLedger.investigationId })
          .from(creditLedger)
          .innerJoin(topupLots, eq(topupLots.id, creditLedger.lotId))
          .where(
            and(
              own(creditLedger),
              eq(creditLedger.reason, "reserve"),
              eq(creditLedger.bucket, "topup"),
              isNotNull(topupLots.usd),
              sql`${topupLots.usd} > 0`,
            ),
          )
      ).map((r) => r.id),
    );
    const fullPlan = Boolean(user && FULL_PLANS.includes(user.plan));
    const reportAccess: Record<string, ReportAccess> = Object.fromEntries(
      invs.map((i) => [i.id, fullPlan || paid.has(i.id) ? "full" : "preview"]),
    );
    const isFull = (id: string | null) => id !== null && reportAccess[id] === "full";
    const fullIds = invs.filter((i) => isFull(i.id)).map((i) => i.id);
    /** snapshot rows of full-access runs only */
    const fullOnly = <T extends { userId: unknown; investigationId: unknown }>(t: T) =>
      fullIds.length ? and(own(t), inArray(t.investigationId as never, fullIds)) : sql`false`;
    return {
      exportedAt: new Date().toISOString(),
      user: user ?? null,
      reportAccess,
      investigations: invs.map((i) =>
        isFull(i.id) ? i : { ...i, refinedQueries: redactRefinedQueries(i.refinedQueries) },
      ),
      runEvents: (await tx.select().from(runEvents).where(own(runEvents))).map((e) =>
        isFull(e.runId) || e.type !== "trace" ? e : { ...e, data: redactTraceData(e.kind, e.data, e.seq) },
      ),
      entities: await tx.select().from(invEntities).where(fullOnly(invEntities)),
      relationships: await tx.select().from(invRelationships).where(fullOnly(invRelationships)),
      actors: await tx.select().from(invActors).where(fullOnly(invActors)),
      sources: await tx.select().from(invSources).where(fullOnly(invSources)),
      summaries: await tx.select().from(invSummary).where(fullOnly(invSummary)),
      exports: await tx.select().from(invExports).where(fullOnly(invExports)),
      creditLedger: await tx.select().from(creditLedger).where(own(creditLedger)),
      topupLots: await tx.select().from(topupLots).where(own(topupLots)),
      subscriptions: await tx.select().from(subscriptions).where(own(subscriptions)),
      payments: await tx.select().from(payments).where(own(payments)),
      foundingSeat: await tx.select().from(foundingSeats).where(eq(foundingSeats.holderUserId, userId)),
      sessions: await tx
        .select({
          id: sessions.id,
          createdAt: sessions.createdAt,
          expiresAt: sessions.expiresAt,
          ipAddress: sessions.ipAddress,
          userAgent: sessions.userAgent,
        })
        .from(sessions)
        .where(own(sessions)),
    };
  });
}
