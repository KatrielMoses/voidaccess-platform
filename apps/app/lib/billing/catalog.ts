/**
 * The Dodo catalogue, derived from @voidaccess/config (never typed by hand), and lookups against the
 * billing_catalog table that the sync script fills.
 */
import { and, eq } from "drizzle-orm";
import { FOUNDING, PLANS, TOPUPS, type PlanId } from "@voidaccess/config";
import { billingCatalog, type Tx } from "@voidaccess/db";
import { centsToUsd } from "./format";

export type Interval = "month" | "year";

export interface CatalogEntry {
  key: string;
  kind: "subscription" | "topup";
  plan?: PlanId;
  interval?: Interval;
  topupUsd?: number;
  amountCents: number;
  name: string;
}

export const FOUNDING_KEY = "founding_pro_month";
export const subKey = (plan: PlanId, interval: Interval) =>
  `${plan}_${interval === "month" ? "month" : "year"}`;
export const topupKey = (usd: number) => `topup_${usd}`;

/** Every product that should exist in Dodo, from config. */
export function desiredCatalog(): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const id of ["pro", "pro_plus"] as const) {
    const p = PLANS[id];
    out.push({
      key: subKey(id, "month"),
      kind: "subscription",
      plan: id,
      interval: "month",
      amountCents: p.monthlyUsd * 100,
      name: `VoidAccess ${p.name} (monthly)`,
    });
    if (p.annualUsd !== null)
      out.push({
        key: subKey(id, "year"),
        kind: "subscription",
        plan: id,
        interval: "year",
        amountCents: p.annualUsd * 100,
        name: `VoidAccess ${p.name} (annual)`,
      });
  }
  out.push({
    key: FOUNDING_KEY,
    kind: "subscription",
    plan: FOUNDING.plan,
    interval: "month",
    amountCents: FOUNDING.monthlyUsd * 100,
    name: `VoidAccess Founding ${PLANS[FOUNDING.plan].name} (monthly)`,
  });
  for (const t of TOPUPS)
    out.push({
      key: topupKey(t.usd),
      kind: "topup",
      topupUsd: t.usd,
      amountCents: t.usd * 100,
      name: `VoidAccess top-up ${centsToUsd(t.usd * 100)}`,
    });
  return out;
}

export type CatalogRow = typeof billingCatalog.$inferSelect;

export async function catalogByProductId(
  tx: Tx,
  mode: string,
  productId: string,
): Promise<CatalogRow | null> {
  const [r] = await tx
    .select()
    .from(billingCatalog)
    .where(and(eq(billingCatalog.mode, mode), eq(billingCatalog.dodoProductId, productId)))
    .limit(1);
  return r ?? null;
}

export async function activeCatalogEntry(tx: Tx, mode: string, key: string): Promise<CatalogRow | null> {
  const [r] = await tx
    .select()
    .from(billingCatalog)
    .where(and(eq(billingCatalog.mode, mode), eq(billingCatalog.key, key), eq(billingCatalog.active, true)))
    .limit(1);
  return r ?? null;
}

/** Plan rank for upgrade/downgrade decisions; annual outranks monthly on the same plan. */
const PLAN_RANK: Record<PlanId, number> = { free: 0, pro: 1, pro_plus: 2 };
export const productRank = (plan: PlanId, interval: Interval | null | undefined) =>
  PLAN_RANK[plan] * 10 + (interval === "year" ? 1 : 0);
export const planRank = (plan: PlanId) => PLAN_RANK[plan];
