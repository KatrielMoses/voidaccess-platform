/** Notification preferences. Reads and writes the user's own row under RLS; the unsubscribe link uses the system role. */
import { eq } from "drizzle-orm";
import { getDatabase, users } from "@voidaccess/db";

export interface NotificationPrefs {
  productEmails: boolean;
}

export async function getPrefs(userId: string): Promise<NotificationPrefs> {
  const [row] = await getDatabase().withUser(userId, (tx) =>
    tx.select({ productEmails: users.productEmails }).from(users).where(eq(users.id, userId)),
  );
  return { productEmails: row?.productEmails ?? true };
}

/** A signed-in user changing their own preference (RLS + the column grant keep it to their row and these columns). */
export async function setProductEmails(userId: string, on: boolean): Promise<void> {
  await getDatabase().withUser(userId, (tx) =>
    tx
      .update(users)
      .set({ productEmails: on, productEmailsChangedAt: new Date() })
      .where(eq(users.id, userId)),
  );
}

/** A verified unsubscribe link. Idempotent. Returns false when the user no longer exists. */
export async function unsubscribeUser(userId: string): Promise<boolean> {
  const rows = await getDatabase().withSystem(
    "email.unsubscribe",
    (tx) =>
      tx
        .update(users)
        .set({ productEmails: false, productEmailsChangedAt: new Date() })
        .where(eq(users.id, userId))
        .returning({ id: users.id }),
    { actor: `unsubscribe:${userId}` },
  );
  return rows.length > 0;
}
