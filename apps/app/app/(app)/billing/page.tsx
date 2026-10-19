import { pageUser } from "@/lib/page-user";
import { trackEvent } from "@/lib/analytics";
import { loadBillingView } from "@/lib/billing/view";
import { BillingClient } from "@/components/billing/billing-client";
import { billingCopy as copy, fill } from "@/content/billing";
import { TOPUP_EXPIRY_MONTHS } from "@voidaccess/config";
import { PageHeader } from "@/components/page-header";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing" };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; from?: string; crypto?: string }>;
}) {
  const user = await pageUser();
  const sp = await searchParams;
  const view = await loadBillingView(user.id, user.plan);
  if (user.plan !== "pro_plus" && !sp.checkout && !sp.crypto)
    await trackEvent("upgrade_viewed", {
      userId: user.id,
      props: { from: sp.from ?? null, plan: user.plan },
    });
  return (
    <div className="va-rise flex flex-col gap-12">
      <PageHeader title={copy.title} lede={fill(copy.intro, { expiryMonths: TOPUP_EXPIRY_MONTHS })} />
      <BillingClient view={view} checkout={sp.checkout} crypto={sp.crypto} />
    </div>
  );
}
