import { check, index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, pk, planEnum, tstz } from "./_common";
import { users } from "./auth";
import { billingIntervalEnum } from "./billing";

/** Every status NOWPayments reports for a payment, plus our own 'created' (order row written, no payment yet). */
export const CRYPTO_ORDER_STATUSES = [
  "created",
  "waiting",
  "confirming",
  "confirmed",
  "sending",
  "partially_paid",
  "finished",
  "failed",
  "expired",
  "refunded",
] as const;
export type CryptoOrderStatus = (typeof CRYPTO_ORDER_STATUSES)[number];

/**
 * One-time crypto purchases (NOWPayments): a credit pack or a plan pass that doesn't renew. Created at checkout,
 * moved along by signed IPN callbacks, and applied exactly once (applied_at is set in the same transaction as the
 * credits). System-only: the app reads it through withSystem filtered by user id.
 */
export const cryptoOrders = pgTable(
  "crypto_orders",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(), // 'test' | 'live'
    kind: text("kind").notNull(), // 'topup' | 'pass'
    plan: planEnum("plan"),
    interval: billingIntervalEnum("interval"),
    topupUsd: integer("topup_usd"),
    /** the exact price the invoice was created for; an IPN must report this amount or it is rejected */
    priceCents: integer("price_cents").notNull(),
    status: text("status").notNull().default("created"),
    providerInvoiceId: text("provider_invoice_id"),
    providerPaymentId: text("provider_payment_id"),
    /** set once, when the purchase was credited; a later or re-sent status can never apply it again */
    appliedAt: tstz("applied_at"),
    createdAt: createdAt(),
    updatedAt: tstz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("crypto_orders_invoice_uq").on(t.providerInvoiceId),
    index("crypto_orders_user_created_idx").on(t.userId, t.createdAt),
    check("crypto_orders_kind_check", sql`${t.kind} in ('topup', 'pass')`),
    check("crypto_orders_mode_check", sql`${t.mode} in ('test', 'live')`),
    check(
      "crypto_orders_status_check",
      sql`${t.status} in ('created', 'waiting', 'confirming', 'confirmed', 'sending', 'partially_paid', 'finished', 'failed', 'expired', 'refunded')`,
    ),
    check(
      "crypto_orders_shape_check",
      sql`(${t.kind} = 'topup' and ${t.topupUsd} is not null and ${t.plan} is null and ${t.interval} is null) or (${t.kind} = 'pass' and ${t.plan} is not null and ${t.interval} is not null and ${t.topupUsd} is null)`,
    ),
  ],
);
