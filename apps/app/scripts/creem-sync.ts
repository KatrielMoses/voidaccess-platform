// Adopt (or, if missing, create) the Creem catalogue from @voidaccess/config and record the product ids in
// billing_catalog. Products are matched on name + price + billing period; one with the configured name but a
// different price or period is refused, never adopted or overwritten.
//   CREEM_API_KEY=creem_test_... DATABASE_URL=... pnpm --filter @voidaccess/app creem:sync
// Test mode unless CREEM_ENV=live_mode AND --live are both given. Prints no API keys.
import { CreemProvider } from "../lib/billing/provider";
import { syncCatalog } from "../lib/billing/sync";

const wantLive = process.argv.includes("--live");
const envLive = process.env.CREEM_ENV === "live_mode";
if (wantLive !== envLive)
  throw new Error("Live mode needs both --live and CREEM_ENV=live_mode (and neither for test)");
const key = process.env.CREEM_API_KEY;
if (!key) throw new Error("CREEM_API_KEY is not set");

const provider = new CreemProvider(key, wantLive ? "live" : "test");
const report = await syncCatalog(provider);
console.log(`mode: ${provider.mode}`);
for (const k of ["adopted", "created", "repriced", "unchanged"] as const)
  console.log(`${k.padEnd(9)}: ${report[k].join(", ") || "-"}`);
for (const c of report.conflicts) console.log(`CONFLICT ${c.key}: ${c.reason}`);
console.log("");
console.log(`  ${"key".padEnd(20)} ${"price".padStart(9)}  ${"product".padEnd(30)} name`);
for (const [k, p] of Object.entries(report.products).sort(([a], [b]) => a.localeCompare(b)))
  console.log(
    `  ${k.padEnd(20)} ${(p.amountCents / 100).toFixed(2).padStart(9)}  ${p.id.padEnd(30)} ${p.name}`,
  );
process.exit(report.conflicts.length > 0 ? 1 : 0);
