import { PLANS } from "@voidaccess/config";
import { AuthCard } from "@/components/auth-card";
import { GithubButton } from "@/components/github-button";
import { githubEnabled } from "@/lib/auth/auth";
import { AUP_URL } from "@/lib/site";
import { SignUpForm } from "./form";

export const metadata = { title: "Create your account | VoidAccess" };
export const dynamic = "force-dynamic";

export default function SignUpPage() {
  return (
    <AuthCard
      title="Create your account"
      description={`${PLANS.free.monthlyCredits} free credits every month. No card needed.`}
    >
      {githubEnabled ? (
        <>
          <GithubButton label="Sign up with GitHub" />
          <p className="text-center text-xs text-fg-muted">or with email</p>
        </>
      ) : null}
      <SignUpForm aupUrl={AUP_URL} />
    </AuthCard>
  );
}
