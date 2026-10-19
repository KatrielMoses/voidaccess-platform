/**
 * Checkout sessions. Subscription prices are never sent from here: the provider product (adopted or created from
 * config by creem:sync) carries the price, and the UI shows the same config number before the user clicks.
 * Top-ups are pay-as-you-go: the amount is validated against config, recorded in billing_checkouts and sent as the
 * checkout's custom price; the webhook credits only what was paid for a checkout recorded here.
 */
import { and, eq, inArray } from "drizzle-orm";
import { topupAmountError, type PlanId, type TopupAmountError } from "@voidaccess/config";
import {
  availableSeats,
  billingCheckouts,
  foundingSeats,
  getDatabase,
  subscriptions,
  type Database,
} from "@voidaccess/db";
import { getEnv } from "../../env";
import { activeCatalogEntry, FOUNDING_KEY, subKey, TOPUP_KEY, type Interval } from "./catalog";
import { ensureCustomer } from "./customers";
import { getBillingProvider, type BillingProvider } from "./provider";

export type CheckoutError =
  "plan_invalid" | "already_subscribed" | "founding_unavailable" | "not_in_catalog" | "topup_invalid";

export type CheckoutResult =
  { ok: true; url: string; key: string } | { ok: false; error: CheckoutError; reason?: TopupAmountError };

export interface CheckoutDeps {
  provider?: BillingProvider;
  database?: Database;
}

const successUrl = () => `${getEnv().APP_URL.replace(/\/$/, "")}/billing?checkout=success`;

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

/** `usd` is whatever the client sent: only a whole-dollar amount inside the config range gets a checkout. */
export async function createTopupCheckout(
  userId: string,
  usd: unknown,
  deps: CheckoutDeps = {},
): Promise<CheckoutResult> {
  const n = typeof usd === "number" ? usd : typeof usd === "string" && usd.trim() !== "" ? Number(usd) : NaN;
  const reason = topupAmountError(n);
  if (reason) return { ok: false, error: "topup_invalid", reason };
  return startCheckout(
    userId,
    TOPUP_KEY,
    deps.provider ?? getBillingProvider(),
    deps.database ?? getDatabase(),
    n,
  );
}

async function startCheckout(
  userId: string,
  key: string,
  provider: BillingProvider,
  database: Database,
  topupUsd?: number,
): Promise<CheckoutResult> {
  const entry = await database.withSystem(
    "billing.catalog.lookup",
    (tx) => activeCatalogEntry(tx, provider.mode, key),
    { audit: false },
  );
  if (!entry) return { ok: false, error: "not_in_catalog" };
  const customerId = await ensureCustomer(userId, provider, database);
  const amountCents = topupUsd !== undefined ? topupUsd * 100 : entry.amountCents;
  const [row] = await database.withSystem(
    "billing.checkout.record",
    (tx) =>
      tx
        .insert(billingCheckouts)
        .values({
          userId,
          mode: provider.mode,
          kind: entry.kind,
          key,
          amountCents,
          topupUsd: topupUsd ?? null,
        })
        .returning({ id: billingCheckouts.id }),
    { audit: false },
  );
  const s = await provider.createCheckout({
    customerId,
    productId: entry.providerProductId,
    requestId: row!.id,
    metadata: { user_id: userId, key, checkout_ref: row!.id },
    successUrl: successUrl(),
    ...(topupUsd !== undefined ? { customPriceCents: amountCents } : {}),
  });
  await database.withSystem(
    "billing.checkout.link",
    (tx) =>
      tx
        .update(billingCheckouts)
        .set({ providerCheckoutId: s.checkoutId })
        .where(eq(billingCheckouts.id, row!.id)),
    { audit: false },
  );
  return { ok: true, url: s.url, key };
}
