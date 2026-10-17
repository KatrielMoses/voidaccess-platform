import { auth } from "@content/auth";
import { SignInForm } from "@/components/auth/sign-in-form";
import { resolve } from "@/lib/facts";
import { getStats } from "@/lib/stats";

export const metadata = { title: "Sign in | VoidAccess" };

// The GitHub star count under the form is refreshed hourly (lib/stats.ts falls back to the last-known value).
export const revalidate = 3600;

export default async function Page() {
  const { stars } = await getStats();
  return <SignInForm description={resolve(auth.signIn.description)} github={auth.signIn.github.replace("{stars}", stars)} />;
}
