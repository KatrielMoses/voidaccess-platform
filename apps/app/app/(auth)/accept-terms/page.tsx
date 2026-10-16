import { redirect } from "next/navigation";
import { Button } from "@voidaccess/ui";
import { acceptAupAction } from "@/lib/auth/actions";
import { afterTermsPath } from "@/lib/auth/after-terms";
import { getSessionUser } from "@/lib/auth/session";
import { signInUrl } from "@/lib/page-user";
import { AUP_URL } from "@/lib/site";
import { AuthCard } from "@/components/auth-card";
import { FormError } from "@/components/field";
import { AupCheckbox } from "./checkbox";

export const metadata = { title: "Accept the Acceptable Use Policy | VoidAccess" };
export const dynamic = "force-dynamic";

export default async function AcceptTermsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next: rawNext } = await searchParams;
  const next = afterTermsPath(rawNext);
  const user = await getSessionUser().catch(() => null);
  if (!user || user.status !== "active") redirect(await signInUrl());
  if (user.aupAcceptedAt) redirect(next);
  return (
    <AuthCard
      title="One more step"
      description="VoidAccess searches dark-web sources. You need to agree to the rules before you continue."
    >
      <form action={acceptAupAction} className="flex flex-col gap-6">
        <input type="hidden" name="next" value={next} />
        <AupCheckbox aupUrl={AUP_URL} />
        <FormError message={error ? "You must accept the Acceptable Use Policy to continue" : null} />
        <Button type="submit" size="lg" className="self-start">
          Continue
        </Button>
      </form>
    </AuthCard>
  );
}
