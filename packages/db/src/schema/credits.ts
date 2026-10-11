import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, text, uniqueIndex, uuid, pgView } from "drizzle-orm/pg-core";
import { createdAt, pk, tstz } from "./_common";
import { users } from "./auth";

export const ledgerBucketEnum = pgEnum("ledger_bucket", ["grant", "topup"]);
export const ledgerReasonEnum = pgEnum("ledger_reason", [
  "grant",
  "expiry",
  "reserve",
  "settle",
  "refund",
  "topup",
  "bonus",
  "admin",
]);

/** One row per purchased top-up (or admin grant). `remaining` is maintained by a ledger trigger. */
export const topupLots = pgTable(
  "topup_lots",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    creditsInitial: integer("credits_initial").notNull(),
    remaining: integer("remaining").notNull(),
    usd: integer("usd"),
    paymentRef: text("payment_ref"),
    purchasedAt: tstz("purchased_at").notNull().defaultNow(),
    expiresAt: tstz("expires_at").notNull(),
  },
  (t) => [
    check("topup_lots_remaining_nonneg", sql`${t.remaining} >= 0`),
    check("topup_lots_remaining_le_initial", sql`${t.remaining} <= ${t.creditsInitial}`),
    index("topup_lots_user_expiry_idx").on(t.userId, t.expiresAt),
  ],
);

/**
 * Append-only credit ledger. UPDATE/DELETE/TRUNCATE are blocked by triggers; per-bucket and per-lot
 * balances can never go negative (trigger, serialised per user with an advisory lock).
 */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: pk(),
    // No cascading FKs: the ledger is immutable history. Users with ledger rows are anonymised, not hard-deleted.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    bucket: ledgerBucketEnum("bucket").notNull(),
    amount: integer("amount").notNull(),
    reason: ledgerReasonEnum("reason").notNull(),
    // plain uuid (no FK): deleting an investigation must not rewrite immutable history
    investigationId: uuid("investigation_id"),
    lotId: uuid("lot_id").references(() => topupLots.id),
    expiresAt: tstz("expires_at"),
    idempotencyKey: text("idempotency_key").notNull(),
    actorId: uuid("actor_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("credit_ledger_idempotency_uq").on(t.idempotencyKey),
    index("credit_ledger_user_idx").on(t.userId, t.createdAt),
    index("credit_ledger_investigation_idx").on(t.investigationId),
    check("credit_ledger_amount_nonzero", sql`${t.amount} <> 0`),
    check("credit_ledger_lot_iff_topup", sql`(${t.bucket} = 'topup') = (${t.lotId} IS NOT NULL)`),
  ],
);

/** Balances per user. security_invoker so RLS applies to the caller. Definition lives in the RLS migration. */
export const creditBalances = pgView("credit_balances", {
  userId: uuid("user_id").notNull(),
  grantBalance: integer("grant_balance").notNull(),
  topupBalance: integer("topup_balance").notNull(),
  total: integer("total").notNull(),
}).existing();
