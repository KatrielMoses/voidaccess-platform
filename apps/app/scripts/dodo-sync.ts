// Create/update the Dodo catalogue from @voidaccess/config and record the product ids in billing_catalog.
//   DODO_PAYMENTS_API_KEY=... DATABASE_URL=postgres://va_app:...@localhost/voidaccess_p5_dev pnpm --filter @voidaccess/app dodo:sync
// Test mode unless DODO_ENV=live_mode AND --live is passed. Prints product names and catalogue keys, never ids or keys.
import { eq } from "drizzle-orm";
import { billingCatalog, getDatabase } from "@voidaccess/db";
import { DodoProvider } from "../lib/billing/provider";
import { syncCatalog } from "../lib/billing/sync";

const live = process.env.DODO_ENV === "live_mode";
if (live && !process.argv.includes("--live")) throw new Error("Refusing to touch live mode without --live");
const key = process.env.DODO_PAYMENTS_API_KEY;
if (!key) throw new Error("DODO_PAYMENTS_API_KEY is not set");

const provider = new DodoProvider(key, live ? "live" : "test");
const report = await syncCatalog(provider);
console.log(`mode: ${provider.mode}`);
for (const k of ["created", "repriced", "unchanged"] as const)
  console.log(`${k}: ${report[k].join(", ") || "-"}`);
const rows = await getDatabase().withSystem(
  "billing.sync.report",
  (tx) => tx.select().from(billingCatalog).where(eq(billingCatalog.mode, provider.mode)),
  { audit: false },
);
for (const r of rows.filter((r) => r.active).sort((a, b) => a.key.localeCompare(b.key)))
  console.log(`  ${r.key.padEnd(20)} ${(r.amountCents / 100).toFixed(2).padStart(7)} USD  ${r.name}`);
process.exit(0);
