import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthCard } from "@/components/auth-card";
import { GithubButton } from "@/components/github-button";
import { githubEnabled } from "@/lib/auth/auth";
import { getSessionUser } from "@/lib/auth/session";
import { SignInForm } from "./form";

export const metadata = { title: "Sign in | VoidAccess" };
export const dynamic = "force-dynamic";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const user = await getSessionUser().catch(() => null);
  if (user?.status === "active") redirect("/welcome");
  const message =
    error === "inactive"
      ? "This account can't be used. Contact support if you think that's a mistake."
      : error
        ? "Sign-in failed. Try again."
        : undefined;
  return (
    <AuthCard title="Sign in">
      {githubEnabled ? (
        <>
          <GithubButton />
          <p className="text-center text-xs text-fg-muted">or with email</p>
        </>
      ) : null}
      <SignInForm initialError={message} />
      <p className="text-center text-sm text-fg-secondary">
        New here?{" "}
        <Link href="/sign-up" className="text-accent underline underline-offset-2">
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}
