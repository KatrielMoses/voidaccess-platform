"use server";
import { redirect } from "next/navigation";
import { acceptAup } from "./bootstrap";
import { requireUser } from "./session";

export interface FormState {
  error?: string;
}

// Every sign-in method (email code, Google, Microsoft, GitHub) lands here before anything else until the user has
// accepted the Acceptable Use Policy; the timestamp is stored server-side.
export async function acceptAupAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (formData.get("aup") !== "on") redirect("/accept-terms?error=1");
  await acceptAup(user.id);
  redirect("/welcome");
}
