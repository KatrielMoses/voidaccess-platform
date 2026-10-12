// Idempotent account bootstrap: everything that needs the request (first touch) or that must be guaranteed
// even if the create hook failed (free credits, referral code). Safe to call on every authenticated render.
import { randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDatabase, grantMonthly } from "@voidaccess/db";
import { creditLedger, users } from "@voidaccess/db/schema";
import { FIRST_TOUCH_COOKIE, parseAttribution } from "./attribution";

export async function bootstrapAccount(
  userId: string,
  opts: { query?: URLSearchParams } = {},
): Promise<void> {
  const db = getDatabase();
  const jar = await cookies();
  const ft = parseAttribution({ cookie: jar.get(FIRST_TOUCH_COOKIE)?.value, query: opts.query });
  const needsGrant = await db.withSystem(
    "account.bootstrap",
    async (tx) => {
      await tx
        .update(users)
        .set({ referralCode: randomBytes(5).toString("hex") })
        .where(and(eq(users.id, userId), isNull(users.referralCode)));
      if (ft) {
        await tx
          .update(users)
          .set({ firstTouch: ft })
          .where(and(eq(users.id, userId), sql`${users.firstTouch} is null`));
      }
      const [any] = await tx
        .select({ id: creditLedger.id })
        .from(creditLedger)
        .where(eq(creditLedger.userId, userId))
        .limit(1);
      return !any; // only a brand-new account with no ledger history gets the free grant here
    },
    { audit: false },
  );
  if (needsGrant) await grantMonthly(userId, "free", new Date());
}

/** Stamp the AUP acceptance once (never overwritten). */
export async function acceptAup(userId: string): Promise<void> {
  await getDatabase().withSystem("account.aup", (tx) =>
    tx
      .update(users)
      .set({ aupAcceptedAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.aupAcceptedAt))),
  );
}
