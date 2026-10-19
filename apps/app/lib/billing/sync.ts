import { and, eq } from "drizzle-orm";
import { billingCatalog, getDatabase, type Database } from "@voidaccess/db";
import { desiredCatalog, type CatalogEntry } from "./catalog";
import type { BillingProvider, ProviderProduct } from "./provider";

export interface SyncReport {
  /** made at the provider because no product with this name existed */
  created: string[];
  /** an existing provider product (same name, price and billing period) recorded in the catalogue */
  adopted: string[];
  /** the config price changed and a product at the new price was adopted or created */
  repriced: string[];
  unchanged: string[];
  /** a provider product has the configured name but a different price or period: refused, nothing written */
  conflicts: { key: string; reason: string }[];
  /** for printing: key -> provider product */
  products: Record<string, { id: string; name: string; amountCents: number }>;
}

const periodOf = (e: CatalogEntry) => (e.kind === "topup" ? "once" : e.interval!);
const kindOf = (e: CatalogEntry) => (e.kind === "topup" ? "onetime" : "recurring");
const matches = (e: CatalogEntry, p: ProviderProduct) =>
  p.priceCents === e.amountCents &&
  p.currency === "USD" &&
  p.billingType === kindOf(e) &&
  p.period === periodOf(e);

/**
 * Make the catalogue match config. Adopts first: a provider product with the configured name, price and billing
 * period is recorded as-is; only a product that doesn't exist is created. A product that has the configured name but
 * a different price or period is never adopted or overwritten (rename or archive it at the provider, then re-run).
 * A config price change records a NEW product and deactivates the old row (existing subscribers keep resolving).
 */
export async function syncCatalog(
  provider: BillingProvider,
  database: Database = getDatabase(),
): Promise<SyncReport> {
  const report: SyncReport = {
    created: [],
    adopted: [],
    repriced: [],
    unchanged: [],
    conflicts: [],
    products: {},
  };
  const remote = (await provider.listProducts()).filter((p) => p.active);
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
      report.products[e.key] = {
        id: active.providerProductId,
        name: active.name,
        amountCents: active.amountCents,
      };
      continue;
    }
    const named = remote.filter((p) => p.name === e.name);
    const exact = named.filter((p) => matches(e, p));
    if (exact.length > 1) {
      report.conflicts.push({
        key: e.key,
        reason: `${exact.length} active products named "${e.name}" match; archive the extras`,
      });
      continue;
    }
    if (exact.length === 0 && named.length > 0) {
      const p = named[0]!;
      report.conflicts.push({
        key: e.key,
        reason: `"${e.name}" exists at ${p.priceCents} cents ${p.billingType}/${p.period ?? "-"}, config wants ${e.amountCents} cents ${kindOf(e)}/${periodOf(e)}`,
      });
      continue;
    }
    let productId: string;
    let how: "adopted" | "created";
    if (exact.length === 1) {
      productId = exact[0]!.id;
      how = "adopted";
    } else {
      productId = (await provider.createProduct(e)).id;
      how = "created";
    }
    await database.withSystem("billing.sync.write", async (tx) => {
      if (active)
        await tx.update(billingCatalog).set({ active: false }).where(eq(billingCatalog.id, active.id));
      const [known] = await tx
        .select({ id: billingCatalog.id })
        .from(billingCatalog)
        .where(and(eq(billingCatalog.mode, provider.mode), eq(billingCatalog.providerProductId, productId)));
      if (known)
        await tx
          .update(billingCatalog)
          .set({ active: true, key: e.key, amountCents: e.amountCents, name: e.name })
          .where(eq(billingCatalog.id, known.id));
      else
        await tx.insert(billingCatalog).values({
          key: e.key,
          kind: e.kind,
          plan: e.plan ?? null,
          interval: e.interval ?? null,
          amountCents: e.amountCents,
          mode: provider.mode,
          providerProductId: productId,
          name: e.name,
          active: true,
        });
    });
    report.products[e.key] = { id: productId, name: e.name, amountCents: e.amountCents };
    (active ? report.repriced : how === "adopted" ? report.adopted : report.created).push(e.key);
  }
  return report;
}
