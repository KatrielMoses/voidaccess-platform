import { bootstrapAccount } from "@/lib/auth/bootstrap";
import { pageUser } from "@/lib/page-user";
import { readBalance } from "@/lib/account/balance";
import { AppHeader } from "./header";
import { AlertBanner } from "@/components/billing/alert-banner";
import { loadAlertBanner } from "@/lib/billing/banner";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await pageUser();
  await bootstrapAccount(user.id);
  const balance = await readBalance(user.id);
  const banner = await loadAlertBanner(user.id);
  return (
    <>
      <AppHeader
        initialBalance={balance}
        name={user.name}
        email={user.email}
        emailVerified={user.emailVerified}
      />
      <AlertBanner state={banner} />
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </>
  );
}
