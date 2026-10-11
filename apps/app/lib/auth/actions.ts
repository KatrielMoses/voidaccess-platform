"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { getAuth } from "./auth";
import { acceptAup, bootstrapAccount } from "./bootstrap";
import { requireUser } from "./session";
import { trackEvent } from "@/lib/analytics";

export interface FormState {
  error?: string;
}

const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(80),
  email: z.email("Enter a valid email"),
  password: z.string().min(10, "Use at least 10 characters").max(128),
  aup: z.literal("on", { error: "You must accept the Acceptable Use Policy to continue" }),
});

/** Email + password sign-up. The AUP checkbox is mandatory and its timestamp is stored. */
export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const { name, email, password } = parsed.data;
  let userId: string;
  try {
    const res = await getAuth().api.signUpEmail({
      body: { name, email, password, callbackURL: "/welcome" },
      headers: await headers(),
    });
    userId = res.user.id;
  } catch (e) {
    if (e instanceof APIError) return { error: e.message || "Could not create the account" };
    throw e;
  }
  await acceptAup(userId);
  await bootstrapAccount(userId);
  await trackEvent("signup_completed", { userId, props: { method: "password" } });
  redirect(`/check-email?email=${encodeURIComponent(email)}`);
}

/** Interstitial for users who arrived via magic link or OAuth and haven't accepted the AUP yet. */
export async function acceptAupAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  if (formData.get("aup") !== "on") redirect("/accept-terms?error=1");
  await acceptAup(user.id);
  redirect("/welcome");
}
