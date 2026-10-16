"use server";
import { redirect } from "next/navigation";
import { afterTermsPath } from "./after-terms";
import { acceptAup } from "./bootstrap";
import { requireUser } from "./session";

export interface FormState {
  error?: string;
}

// Every sign-in method (email code, Google, Microsoft, GitHub) lands here before anything else until the user has
// accepted the Acceptable Use Policy; the timestamp is stored server-side.
export async function acceptAupAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const next = afterTermsPath(formData.get("next"));
  if (formData.get("aup") !== "on") redirect(`/accept-terms?error=1&next=${encodeURIComponent(next)}`);
  await acceptAup(user.id);
  redirect(next);
}
