// Create real Creem TEST-mode checkouts (nothing is charged) for (a) Pro monthly and (b) a credit top-up, and print
// both URLs. Uses a throwaway test customer and the catalogue that creem:sync wrote.
//   CREEM_API_KEY=creem_test_... DATABASE_URL=... pnpm --filter @voidaccess/app creem:checkout-smoke [topup dollars]
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { TOPUP_MIN_USD, topupAmountError, topupCredits } from "@voidaccess/config";
import { billingCatalog, getDatabase } from "@voidaccess/db";
import { subKey, TOPUP_KEY } from "../lib/billing/catalog";
import { CreemProvider } from "../lib/billing/provider";

const key = process.env.CREEM_API_KEY;
if (!key) throw new Error("CREEM_API_KEY is not set");
const provider = new CreemProvider(key, "test"); // refuses a live key
const usd = Number(process.argv[2] ?? TOPUP_MIN_USD);
const invalid = topupAmountError(usd);
if (invalid) throw new Error(`Invalid top-up amount: ${invalid}`);

const userId = randomUUID();
const customer = await provider.createCustomer({
  email: `checkout-smoke-${Date.now()}@example.com`,
  name: "Checkout Smoke",
  userId,
});
const success = "http://localhost:3400/billing?checkout=success";

async function product(k: string) {
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
  if (!row) throw new Error(`${k} is not in the test catalogue: run creem:sync first`);
  return row.providerProductId;
}

const pro = await provider.createCheckout({
  customerId: customer.id,
  productId: await product(subKey("pro", "month")),
  requestId: randomUUID(),
  metadata: { user_id: userId, key: subKey("pro", "month"), smoke: "1" },
  successUrl: success,
});
console.log(`pro_month: ${pro.url}`);
const top = await provider.createCheckout({
  customerId: customer.id,
  productId: await product(TOPUP_KEY),
  requestId: randomUUID(),
  metadata: { user_id: userId, key: TOPUP_KEY, smoke: "1" },
  successUrl: success,
  customPriceCents: usd * 100,
});
console.log(`${TOPUP_KEY} ($${usd}, ${topupCredits(usd, "free")} credits on Free): ${top.url}`);
process.exit(0);
