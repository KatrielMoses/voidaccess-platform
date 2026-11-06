/**
 * What the unlock panel needs after a checkout: has the plan applied yet, did our record of the checkout complete,
 * and (only when asked, to keep provider calls rare) what Creem says about it. Creem has no failed-checkout event and
 * no failure reason: its checkout status (pending | processing | completed | expired) is the best signal there is.
 */
import { and, eq } from "drizzle-orm";
import type { PlanId } from "@voidaccess/config";
import { billingCheckouts, getDatabase, users, type Database } from "@voidaccess/db";
import { getBillingProvider, type BillingProvider, type CheckoutStatus } from "@/lib/billing/provider";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UnlockCheckoutState {
  plan: PlanId;
  /** pro or pro_plus: the report reads as full now (the access check runs at read time) */
  paidPlan: boolean;
  /** our billing_checkouts row is closed (checkout.completed arrived) */
  completed: boolean;
  /** the provider's status, only with probe; null when not asked or the lookup failed */
  provider: CheckoutStatus | null;
}

export async function unlockCheckoutState(
  userId: string,
  ref: string,
  opts: { probe?: boolean; database?: Database; provider?: BillingProvider } = {},
): Promise<UnlockCheckoutState | null> {
  if (!UUID.test(ref)) return null;
  const database = opts.database ?? getDatabase();
  const [row] = await database.withSystem(
    "billing.checkout.status",
    (tx) =>
      tx
        .select({
          completedAt: billingCheckouts.completedAt,
          providerCheckoutId: billingCheckouts.providerCheckoutId,
        })
        .from(billingCheckouts)
        .where(and(eq(billingCheckouts.id, ref), eq(billingCheckouts.userId, userId)))
        .limit(1),
    { audit: false },
  );
  if (!row) return null;
  const [u] = await database.withUser(userId, (tx) =>
    tx.select({ plan: users.plan }).from(users).where(eq(users.id, userId)).limit(1),
  );
  const plan = (u?.plan ?? "free") as PlanId;
  let provider: CheckoutStatus | null = null;
  if (opts.probe && row.providerCheckoutId && !row.completedAt) {
    try {
      provider = await (opts.provider ?? getBillingProvider()).checkoutStatus(row.providerCheckoutId);
    } catch {
      provider = null;
    }
  }
  return {
    plan,
    paidPlan: plan === "pro" || plan === "pro_plus",
    completed: row.completedAt !== null,
    provider: row.completedAt ? "completed" : provider,
  };
}
