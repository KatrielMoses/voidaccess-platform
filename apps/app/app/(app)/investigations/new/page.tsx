import { pageUser } from "@/lib/page-user";
import { readBalance } from "@/lib/account/balance";
import { QueryForm } from "@/components/query-form";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Investigate | VoidAccess" };

export default async function NewInvestigationPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ q }, user] = await Promise.all([searchParams, pageUser()]);
  const balance = await readBalance(user.id);
  return (
    <div className="va-rise flex max-w-[860px] flex-col gap-12">
      <PageHeader
        title="Start an investigation"
        lede="Search the dark web for a threat actor, malware family, CVE or brand. Pick a depth, then start."
      />
      <QueryForm
        balance={balance}
        emailVerified={user.emailVerified}
        email={user.email}
        defaultQuery={(q ?? "").slice(0, 500)}
        showExamples
        autoFocus
      />
    </div>
  );
}
