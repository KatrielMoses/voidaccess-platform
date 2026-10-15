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
      <main className="va-wrap pt-14 pb-28 max-[960px]:pt-10 max-[960px]:pb-20">{children}</main>
    </>
  );
}
