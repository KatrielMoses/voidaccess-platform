import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { signInUrl } from "@/lib/page-user";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let user = null;
  try {
    user = await getSessionUser();
  } catch {
    /* no database configured: fall through to sign-in */
  }
  redirect(user?.status === "active" ? "/welcome" : await signInUrl());
}
