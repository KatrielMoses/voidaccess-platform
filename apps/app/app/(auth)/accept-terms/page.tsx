import { redirect } from "next/navigation";
import { Button } from "@voidaccess/ui";
import { acceptAupAction } from "@/lib/auth/actions";
import { getSessionUser } from "@/lib/auth/session";
import { AUP_URL } from "@/lib/site";
import { AuthCard } from "@/components/auth-card";
import { FormError } from "@/components/field";
import { AupCheckbox } from "./checkbox";

export const metadata = { title: "Accept the Acceptable Use Policy | VoidAccess" };
export const dynamic = "force-dynamic";

export default async function AcceptTermsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const user = await getSessionUser().catch(() => null);
  if (!user || user.status !== "active") redirect("/sign-in");
  if (user.aupAcceptedAt) redirect("/welcome");
  return (
    <AuthCard
      title="One more step"
      description="VoidAccess searches dark-web sources. You need to agree to the rules before you continue."
    >
      <form action={acceptAupAction} className="flex flex-col gap-4">
        <AupCheckbox aupUrl={AUP_URL} />
        <FormError message={error ? "You must accept the Acceptable Use Policy to continue" : null} />
        <Button type="submit" size="lg" className="w-full">
          Continue
        </Button>
      </form>
    </AuthCard>
  );
}
