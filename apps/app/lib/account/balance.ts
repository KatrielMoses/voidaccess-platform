import { eq } from "drizzle-orm";
import { getDatabase } from "@voidaccess/db";
import { creditBalances } from "@voidaccess/db/schema";

/** Live credit balance from the `credit_balances` view, read under RLS as the user. 0 when no ledger rows yet. */
export async function readBalance(userId: string): Promise<number> {
  const [row] = await getDatabase().withUser(userId, (tx) =>
    tx.select({ total: creditBalances.total }).from(creditBalances).where(eq(creditBalances.userId, userId)),
  );
  return row?.total ?? 0;
}
