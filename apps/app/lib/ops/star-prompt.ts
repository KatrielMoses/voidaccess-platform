/** The post-first-investigation "Star us on GitHub" prompt: shown until the user dismisses it, remembered per user. */
import { eq } from "drizzle-orm";
import { getDatabase, users } from "@voidaccess/db";

export async function starPromptVisible(userId: string): Promise<boolean> {
  const [row] = await getDatabase().withUser(userId, (tx) =>
    tx.select({ at: users.starPromptDismissedAt }).from(users).where(eq(users.id, userId)),
  );
  return row ? row.at === null : false;
}

export async function dismissStarPrompt(userId: string): Promise<void> {
  await getDatabase().withUser(userId, (tx) =>
    tx.update(users).set({ starPromptDismissedAt: new Date() }).where(eq(users.id, userId)),
  );
}
