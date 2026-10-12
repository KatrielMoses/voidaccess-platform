/**
 * Checkout sessions. Prices are never sent from here: the Dodo product (created from config by the sync script)
 * carries the price, and the UI shows the same config number before the user clicks.
 */
import { and, eq, inArray } from "drizzle-orm";
import { TOPUPS, type PlanId } from "@voidaccess/config";
import { availableSeats, foundingSeats, getDatabase, subscriptions, type Database } from "@voidaccess/db";
import { getEnv } from "../../env";
import { activeCatalogEntry, FOUNDING_KEY, subKey, topupKey, type Interval } from "./catalog";
import { ensureCustomer } from "./customers";
import { getBillingProvider, type BillingProvider } from "./provider";

export type CheckoutError =
  "plan_invalid" | "already_subscribed" | "founding_unavailable" | "not_in_catalog" | "topup_invalid";

export type CheckoutResult = { ok: true; url: string; key: string } | { ok: false; error: CheckoutError };

export interface CheckoutDeps {
  provider?: BillingProvider;
  database?: Database;
}

const returnUrls = () => {
  const base = getEnv().APP_URL.replace(/\/$/, "");
  return { returnUrl: `${base}/billing?checkout=success`, cancelUrl: `${base}/billing?checkout=cancelled` };
};

export async function createSubscriptionCheckout(
  userId: string,
  input: { plan: PlanId; interval: Interval; founding?: boolean },
  deps: CheckoutDeps = {},
): Promise<CheckoutResult> {
  const provider = deps.provider ?? getBillingProvider();
  const database = deps.database ?? getDatabase();
  if (input.plan !== "pro" && input.plan !== "pro_plus") return { ok: false, error: "plan_invalid" };
  if (input.interval !== "month" && input.interval !== "year") return { ok: false, error: "plan_invalid" };

  const live = await database.withUser(userId, (tx) =>
    tx
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          inArray(subscriptions.status, ["active", "past_due", "paused"]),
        ),
      )
      .limit(1),
  );
  if (live.length > 0) return { ok: false, error: "already_subscribed" };

  let key = subKey(input.plan, input.interval);
  if (input.founding) {
    if (input.plan !== "pro" || input.interval !== "month")
      return { ok: false, error: "founding_unavailable" };
    const mine = await database.withSystem(
      "billing.founding.holder",
      (tx) =>
        tx
          .select({ n: foundingSeats.seatNo })
          .from(foundingSeats)
          .where(eq(foundingSeats.holderUserId, userId)),
      { audit: false },
    );
    if (mine.length > 0 || (await availableSeats({ database })) <= 0)
      return { ok: false, error: "founding_unavailable" };
    key = FOUNDING_KEY;
  }
  return startCheckout(userId, key, provider, database);
}

export async function createTopupCheckout(
  userId: string,
  usd: number,
  deps: CheckoutDeps = {},
): Promise<CheckoutResult> {
  if (!TOPUPS.some((t) => t.usd === usd)) return { ok: false, error: "topup_invalid" };
  return startCheckout(
    userId,
    topupKey(usd),
    deps.provider ?? getBillingProvider(),
    deps.database ?? getDatabase(),
  );
}

async function startCheckout(
  userId: string,
  key: string,
  provider: BillingProvider,
  database: Database,
): Promise<CheckoutResult> {
  const entry = await database.withSystem(
    "billing.catalog.lookup",
    (tx) => activeCatalogEntry(tx, provider.mode, key),
    { audit: false },
  );
  if (!entry) return { ok: false, error: "not_in_catalog" };
  const customerId = await ensureCustomer(userId, provider, database);
  const { returnUrl, cancelUrl } = returnUrls();
  const s = await provider.createCheckout({
    customerId,
    productId: entry.dodoProductId,
    metadata: { user_id: userId, key },
    returnUrl,
    cancelUrl,
  });
  return { ok: true, url: s.url, key };
}
