"use server";

import { getSessionUserId } from "@/lib/dev-session";
import { resultsActions } from "@/lib/results/actions";

export async function renameInvestigation(id: string, name: string) {
  const userId = await getSessionUserId();
  if (!userId) return { ok: false, message: "Not signed in." };
  return resultsActions.rename(userId, id, name.trim().slice(0, 200));
}

export async function deleteInvestigation(id: string) {
  const userId = await getSessionUserId();
  if (!userId) return { ok: false, message: "Not signed in." };
  return resultsActions.remove(userId, id);
}
