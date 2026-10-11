"use server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDatabase } from "@voidaccess/db";
import { users } from "@voidaccess/db/schema";
import { PROFILE_ROLES, PROFILE_USE_CASES } from "@/content/examples";
import { requireUser } from "@/lib/auth/session";

const roles = new Set<string>(PROFILE_ROLES.map((r) => r.value));
const useCases = new Set<string>(PROFILE_USE_CASES.map((r) => r.value));

/** Optional 2-question profile. Own-row UPDATE under withUser; only whitelisted answers are stored. */
export async function saveProfileAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const role = String(formData.get("role") ?? "");
  const useCase = String(formData.get("use_case") ?? "");
  await getDatabase().withUser(user.id, (tx) =>
    tx
      .update(users)
      .set({
        profileRole: roles.has(role) ? role : "skipped",
        profileUseCase: useCases.has(useCase) ? useCase : "skipped",
      })
      .where(eq(users.id, user.id)),
  );
  revalidatePath("/welcome");
}

/** Skip: record that we asked so the card stops appearing. */
export async function skipProfileAction(): Promise<void> {
  const user = await requireUser();
  await getDatabase().withUser(user.id, (tx) =>
    tx.update(users).set({ profileRole: "skipped", profileUseCase: "skipped" }).where(eq(users.id, user.id)),
  );
  revalidatePath("/welcome");
}
