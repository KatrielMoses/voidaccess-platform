import { and, eq } from "drizzle-orm";
import { billingCatalog, getDatabase, type Database } from "@voidaccess/db";
import { desiredCatalog } from "./catalog";
import type { BillingProvider } from "./provider";

export interface SyncReport {
  created: string[];
  repriced: string[];
  unchanged: string[];
}

/**
 * Create or update the Dodo catalogue from config. Idempotent: an entry whose active row already has the
 * configured price is left alone. A config price change creates a NEW Dodo product and points the catalogue at
 * it; the old product row stays (inactive) so existing subscribers keep resolving to, and paying, their price.
 */
export async function syncCatalog(
  provider: BillingProvider,
  database: Database = getDatabase(),
): Promise<SyncReport> {
  const report: SyncReport = { created: [], repriced: [], unchanged: [] };
  for (const e of desiredCatalog()) {
    const [active] = await database.withSystem(
      "billing.sync.read",
      (tx) =>
        tx
          .select()
          .from(billingCatalog)
          .where(
            and(
              eq(billingCatalog.mode, provider.mode),
              eq(billingCatalog.key, e.key),
              eq(billingCatalog.active, true),
            ),
          ),
      { audit: false },
    );
    if (active && active.amountCents === e.amountCents) {
      report.unchanged.push(e.key);
      continue;
    }
    const product = await provider.createProduct(e);
    await database.withSystem("billing.sync.write", async (tx) => {
      if (active)
        await tx.update(billingCatalog).set({ active: false }).where(eq(billingCatalog.id, active.id));
      await tx.insert(billingCatalog).values({
        key: e.key,
        kind: e.kind,
        plan: e.plan ?? null,
        interval: e.interval ?? null,
        topupUsd: e.topupUsd ?? null,
        amountCents: e.amountCents,
        mode: provider.mode,
        dodoProductId: product.id,
        name: e.name,
        active: true,
      });
    });
    (active ? report.repriced : report.created).push(e.key);
  }
  return report;
}
