// Create real test-mode checkout sessions (no purchase is made) for Pro monthly, founding Pro and a top-up, and print the URLs.
//   DODO_PAYMENTS_API_KEY=... DATABASE_URL=... pnpm --filter @voidaccess/app billing:checkout-smoke [topup usd]
// Uses a throwaway Dodo customer; requires `pnpm dodo:sync` to have run.
import { and, eq } from "drizzle-orm";
import { TOPUPS } from "@voidaccess/config";
import { billingCatalog, getDatabase } from "@voidaccess/db";
import { DodoProvider } from "../lib/billing/provider";
import { FOUNDING_KEY, subKey, topupKey } from "../lib/billing/catalog";

const key = process.env.DODO_PAYMENTS_API_KEY;
if (!key) throw new Error("DODO_PAYMENTS_API_KEY is not set");
const provider = new DodoProvider(key, "test");
const usd = Number(process.argv[2] ?? TOPUPS[0].usd);
const customer = await provider.createCustomer({
  email: `checkout-smoke-${Date.now()}@example.com`,
  name: "Checkout Smoke",
  userId: "00000000-0000-4000-8000-000000000000",
});
for (const k of [subKey("pro", "month"), FOUNDING_KEY, topupKey(usd)]) {
  const [row] = await getDatabase().withSystem(
    "billing.smoke",
    (tx) =>
      tx
        .select()
        .from(billingCatalog)
        .where(
          and(eq(billingCatalog.mode, "test"), eq(billingCatalog.key, k), eq(billingCatalog.active, true)),
        ),
    { audit: false },
  );
  if (!row) {
    console.log(`${k}: not in catalogue (run dodo:sync)`);
    continue;
  }
  const s = await provider.createCheckout({
    customerId: customer.id,
    productId: row.dodoProductId,
    metadata: { key: k },
    returnUrl: "http://localhost:3400/billing?checkout=success",
    cancelUrl: "http://localhost:3400/billing?checkout=cancelled",
  });
  console.log(`${k}: ${s.url}`);
}
process.exit(0);
