import { pageUser } from "@/lib/page-user";
import { readBalance } from "@/lib/account/balance";
import { QueryForm } from "@/components/query-form";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "New investigation | VoidAccess" };

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
        title="New investigation"
        lede={
          <>
            You have{" "}
            <span className="font-mono text-[15px] text-paper tabular-nums">
              {balance.toLocaleString("en-US")}
            </span>{" "}
            credits.
          </>
        }
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
