import { and, eq } from "drizzle-orm";
import { billingCustomers, getDatabase, users, type Database } from "@voidaccess/db";
import type { BillingProvider } from "./provider";

/** The user's Dodo customer id, created on first use. One customer per user and mode; a race resolves to the same row. */
export async function ensureCustomer(
  userId: string,
  provider: BillingProvider,
  database: Database = getDatabase(),
): Promise<string> {
  const find = () =>
    database.withSystem(
      "billing.customer.lookup",
      async (tx) => {
        const [m] = await tx
          .select({ id: billingCustomers.dodoCustomerId })
          .from(billingCustomers)
          .where(and(eq(billingCustomers.userId, userId), eq(billingCustomers.mode, provider.mode)));
        return m?.id ?? null;
      },
      { audit: false },
    );
  const existing = await find();
  if (existing) return existing;
  const [u] = await database.withSystem(
    "billing.customer.user",
    (tx) => tx.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId)),
    { audit: false },
  );
  if (!u) throw new Error("unknown user");
  const created = await provider.createCustomer({ email: u.email, name: u.name, userId });
  await database.withSystem(
    "billing.customer.link",
    (tx) =>
      tx
        .insert(billingCustomers)
        .values({ userId, mode: provider.mode, dodoCustomerId: created.id })
        .onConflictDoNothing(),
    { audit: false },
  );
  return (await find()) ?? created.id;
}
