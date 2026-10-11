import { pageUser } from "@/lib/page-user";
import { readBalance } from "@/lib/account/balance";
import { QueryForm } from "@/components/query-form";

export const metadata = { title: "New investigation | VoidAccess" };

export default async function NewInvestigationPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const [{ q }, user] = await Promise.all([searchParams, pageUser()]);
  const balance = await readBalance(user.id);
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold tracking-tight">New investigation</h1>
        <p className="text-fg-secondary">
          You have <span className="font-mono text-fg tabular-nums">{balance.toLocaleString("en-US")}</span>{" "}
          credits.
        </p>
      </header>
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
