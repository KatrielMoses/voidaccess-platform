/**
 * User-initiated subscription changes. None of these touch users.plan or the ledger: they ask Creem (or record a
 * pending downgrade) and the plan follows Creem's webhook. Upgrades show an estimate of the prorated charge first.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { PLANS, type PlanId } from "@voidaccess/config";
import { foundingSeats, getDatabase, subscriptions, type Database } from "@voidaccess/db";
import { sendEmail } from "@voidaccess/emails";
import { trackEvent } from "../analytics";
import { activeCatalogEntry, FOUNDING_KEY, planRank, productRank, subKey, type Interval } from "./catalog";
import { dateFmt } from "./format";
import { getBillingProvider, type BillingProvider } from "./provider";
import { userContact } from "./post-effects";

type Deps = { provider?: BillingProvider; database?: Database };
export type SubscriptionRow = typeof subscriptions.$inferSelect;

export interface FoundingState {
  held: boolean;
  seatNo?: number;
  anniversaryAt?: Date | null;
  /** renews: nothing to do; at_risk: a renewal or inactivity release is coming */
  status?: "renews" | "at_risk";
}

export async function currentSubscription(
  userId: string,
  database: Database = getDatabase(),
): Promise<SubscriptionRow | null> {
  return database.withUser(userId, async (tx) => {
    const [s] = await tx
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          inArray(subscriptions.status, ["active", "past_due", "paused", "cancelled"]),
        ),
      )
      .orderBy(desc(subscriptions.createdAt))
      .limit(1);
    // a cancelled row only counts while it's still inside the paid period
    if (s && s.status === "cancelled" && (!s.cancelAt || s.cancelAt <= new Date())) return null;
    return s ?? null;
  });
}

export async function foundingState(
  userId: string,
  database: Database = getDatabase(),
): Promise<FoundingState> {
  const [seat] = await database.withSystem(
    "billing.founding.state",
    (tx) => tx.select().from(foundingSeats).where(eq(foundingSeats.holderUserId, userId)),
    { audit: false },
  );
  return seat
    ? { held: true, seatNo: seat.seatNo, anniversaryAt: seat.anniversaryAt, status: "renews" }
    : { held: false };
}

export type ChangeKind = "upgrade" | "downgrade" | "same";
export interface ChangePreview {
  kind: ChangeKind;
  /** what the upgrade would charge right now (cents, an estimate: Creem computes the exact proration) */
  amountCents: number | null;
  estimated: boolean;
  currency: string | null;
  /** when a downgrade takes effect */
  effectiveAt: Date | null;
  releasesFoundingSeat: boolean;
  targetKey: string;
}

export type ChangeError =
  "no_subscription" | "plan_invalid" | "not_in_catalog" | "founding_release_confirmation_required";

async function target(userId: string, plan: PlanId, interval: Interval, deps: Deps) {
  const provider = deps.provider ?? getBillingProvider();
  const database = deps.database ?? getDatabase();
  const sub = await currentSubscription(userId, database);
  if (!sub || sub.status === "cancelled") return { ok: false as const, error: "no_subscription" as const };
  if ((plan !== "pro" && plan !== "pro_plus") || (interval !== "month" && interval !== "year"))
    return { ok: false as const, error: "plan_invalid" as const };
  const key = subKey(plan, interval);
  const entry = await database.withSystem(
    "billing.catalog.lookup",
    (tx) => activeCatalogEntry(tx, provider.mode, key),
    { audit: false },
  );
  if (!entry) return { ok: false as const, error: "not_in_catalog" as const };
  const currentKey = sub.productKey ?? subKey(sub.plan, sub.interval);
  const founder = sub.isFounding;
  const rankNow =
    currentKey === FOUNDING_KEY ? productRank("pro", "month") : productRank(sub.plan, sub.interval);
  const rankNew = productRank(plan, interval);
  const kind: ChangeKind =
    rankNew > rankNow
      ? "upgrade"
      : rankNew < rankNow
        ? "downgrade"
        : currentKey === key
          ? "same"
          : founder
            ? "upgrade"
            : "same";
  // a founder moving off the founding product (even to the same-ranked standard Pro) gives the seat up
  const releases = founder && key !== FOUNDING_KEY;
  return { ok: true as const, provider, database, sub, entry, key, kind, releases };
}

export async function previewPlanChange(
  userId: string,
  input: { plan: PlanId; interval: Interval },
  deps: Deps = {},
): Promise<{ ok: true; preview: ChangePreview } | { ok: false; error: ChangeError }> {
  const t = await target(userId, input.plan, input.interval, deps);
  if (!t.ok) return { ok: false, error: t.error };
  let amountCents: number | null = null;
  let currency: string | null = null;
  let estimated = false;
  if (t.kind === "upgrade") {
    const p = await t.provider.previewChange({
      subscriptionId: t.sub.providerSubscriptionId,
      productId: t.entry.providerProductId,
    });
    amountCents = p.amountCents;
    currency = p.currency;
    estimated = p.estimated;
  }
  return {
    ok: true,
    preview: {
      kind: t.kind,
      amountCents,
      currency,
      estimated,
      effectiveAt: t.kind === "downgrade" ? t.sub.currentPeriodEnd : null,
      releasesFoundingSeat: t.releases,
      targetKey: t.key,
    },
  };
}

export async function requestPlanChange(
  userId: string,
  input: { plan: PlanId; interval: Interval; confirmReleaseFounding?: boolean },
  deps: Deps = {},
): Promise<{ ok: true; kind: ChangeKind; effectiveAt: Date | null } | { ok: false; error: ChangeError }> {
  const t = await target(userId, input.plan, input.interval, deps);
  if (!t.ok) return { ok: false, error: t.error };
  if (t.releases && !input.confirmReleaseFounding)
    return { ok: false, error: "founding_release_confirmation_required" };
  if (t.kind === "same") return { ok: true, kind: "same", effectiveAt: null };
  if (t.kind === "upgrade") {
    await t.provider.changePlan({
      subscriptionId: t.sub.providerSubscriptionId,
      productId: t.entry.providerProductId,
      billing: "prorated_immediately",
    });
    return { ok: true, kind: "upgrade", effectiveAt: null };
  }
  // downgrade: record it; the cron asks Creem shortly before the period ends, and the plan drops when the new period starts
  await t.database.withSystem(
    "billing.pending.set",
    (tx) =>
      tx
        .update(subscriptions)
        .set({
          pendingProductKey: t.key,
          pendingEffectiveAt: t.sub.currentPeriodEnd,
          pendingRequestedAt: null,
        })
        .where(eq(subscriptions.id, t.sub.id)),
    { audit: false },
  );
  return { ok: true, kind: "downgrade", effectiveAt: t.sub.currentPeriodEnd };
}

export async function cancelPendingChange(userId: string, deps: Deps = {}): Promise<void> {
  const database = deps.database ?? getDatabase();
  const sub = await currentSubscription(userId, database);
  if (!sub) return;
  await database.withSystem(
    "billing.pending.clear",
    (tx) =>
      tx
        .update(subscriptions)
        .set({ pendingProductKey: null, pendingEffectiveAt: null, pendingRequestedAt: null })
        .where(eq(subscriptions.id, sub.id)),
    { audit: false },
  );
}

export async function cancelAtPeriodEnd(
  userId: string,
  reason: string | undefined,
  deps: Deps = {},
): Promise<{ ok: boolean; endsAt: Date | null }> {
  const provider = deps.provider ?? getBillingProvider();
  const database = deps.database ?? getDatabase();
  const sub = await currentSubscription(userId, database);
  if (!sub || sub.status === "cancelled") return { ok: false, endsAt: null };
  await provider.setCancelAtPeriodEnd({ subscriptionId: sub.providerSubscriptionId, cancel: true, reason });
  await database.withSystem(
    "billing.cancel",
    (tx) =>
      tx.update(subscriptions).set({ cancelAt: sub.currentPeriodEnd }).where(eq(subscriptions.id, sub.id)),
    { audit: false },
  );
  await trackEvent("cancelled", {
    userId,
    props: { reason: reason ?? null, plan: sub.plan, endsAt: sub.currentPeriodEnd?.toISOString() ?? null },
  });
  const c = await userContact(userId);
  if (c)
    await sendEmail("cancellationSurvey", c.email, {
      name: c.name,
      date: dateFmt(sub.currentPeriodEnd),
    }).catch(() => {});
  return { ok: true, endsAt: sub.currentPeriodEnd };
}

export async function resumeSubscription(userId: string, deps: Deps = {}): Promise<boolean> {
  const provider = deps.provider ?? getBillingProvider();
  const database = deps.database ?? getDatabase();
  const sub = await currentSubscription(userId, database);
  if (!sub || !sub.cancelAt) return false;
  await provider.setCancelAtPeriodEnd({ subscriptionId: sub.providerSubscriptionId, cancel: false });
  await database.withSystem(
    "billing.resume",
    (tx) => tx.update(subscriptions).set({ cancelAt: null }).where(eq(subscriptions.id, sub.id)),
    { audit: false },
  );
  return true;
}

export const planName = (p: PlanId) => PLANS[p].name;
export { planRank };
