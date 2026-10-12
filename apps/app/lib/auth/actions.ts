"use server";
import { redirect } from "next/navigation";
import { acceptAup } from "./bootstrap";
import { requireUser } from "./session";

export interface FormState {
  error?: string;
}

// Email sign-up lives on the site and goes straight to Better Auth, which enforces the AUP on the server
// (lib/auth/auth.ts). This interstitial remains for users who arrived via magic link or OAuth.
export async function acceptAupAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (formData.get("aup") !== "on") redirect("/accept-terms?error=1");
  await acceptAup(user.id);
  redirect("/welcome");
}
