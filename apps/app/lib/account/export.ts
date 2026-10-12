// Data export: JSON of the signed-in user's own rows. Every read runs under withUser (RLS) AND filters by the
// user id, so a policy mistake still cannot leak another account's data. Secrets (password hashes, OAuth/session
// tokens, vault ciphertext) are never selected.
import { eq } from "drizzle-orm";
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
    return {
      exportedAt: new Date().toISOString(),
      user: user ?? null,
      investigations: await tx.select().from(investigations).where(own(investigations)),
      runEvents: await tx.select().from(runEvents).where(own(runEvents)),
      entities: await tx.select().from(invEntities).where(own(invEntities)),
      relationships: await tx.select().from(invRelationships).where(own(invRelationships)),
      actors: await tx.select().from(invActors).where(own(invActors)),
      sources: await tx.select().from(invSources).where(own(invSources)),
      summaries: await tx.select().from(invSummary).where(own(invSummary)),
      exports: await tx.select().from(invExports).where(own(invExports)),
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
