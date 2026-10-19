import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createdAt, pk, planEnum, tstz } from "./_common";
import { users } from "./auth";
import { billingIntervalEnum } from "./billing";

/**
 * Payment-provider catalogue (Creem since P7), written by apps/app/scripts/creem-sync.ts from @voidaccess/config.
 * One active row per (mode, key); a price change adds a new row and deactivates the old one (old products stay so
 * existing subscriptions still resolve). System-only: read through withSystem.
 */
export const billingCatalog = pgTable(
  "billing_catalog",
  {
    id: pk(),
    /** pro_month, pro_year, pro_plus_month, pro_plus_year, founding_pro_month, topup_credits */
    key: text("key").notNull(),
    kind: text("kind").notNull(), // 'subscription' | 'topup'
    plan: planEnum("plan"),
    interval: billingIntervalEnum("interval"),
    /** unused since P7 (top-ups are one pay-as-you-go product); kept for old rows */
    topupUsd: integer("topup_usd"),
    /** price in cents at sync time (from config), kept so a config change is detectable */
    amountCents: integer("amount_cents").notNull(),
    mode: text("mode").notNull(), // 'test' | 'live'
    providerProductId: text("provider_product_id").notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("billing_catalog_product_uq").on(t.mode, t.providerProductId),
    uniqueIndex("billing_catalog_active_key_uq")
      .on(t.mode, t.key)
      .where(sql`${t.active}`),
  ],
);

/** One provider customer per user and mode. A webhook's customer id must map to exactly one user. System-only. */
export const billingCustomers = pgTable(
  "billing_customers",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    providerCustomerId: text("provider_customer_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("billing_customers_user_mode_uq").on(t.userId, t.mode),
    uniqueIndex("billing_customers_provider_uq").on(t.mode, t.providerCustomerId),
  ],
);

/**
 * Every webhook delivery, keyed by (provider, mode, provider event id): the exactly-once guard. System-only; no
 * payload bodies (PII).
 */
export const billingEvents = pgTable(
  "billing_events",
  {
    id: pk(),
    provider: text("provider").notNull().default("creem"),
    mode: text("mode").notNull().default("test"),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** the provider's own timestamp for the event */
    eventAt: tstz("event_at"),
    receivedAt: createdAt(),
    /** applied | ignored | rejected | duplicate-never-stored */
    outcome: text("outcome").notNull(),
    detail: jsonb("detail")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [
    uniqueIndex("billing_events_provider_event_uq").on(t.provider, t.mode, t.eventId),
    index("billing_events_type_idx").on(t.type, t.receivedAt),
  ],
);

/**
 * Every checkout our server created (P7). The webhook only credits a top-up for a checkout recorded here, for the
 * same user and mode, and only if the amount paid matches `amountCents`. System-only.
 */
export const billingCheckouts = pgTable(
  "billing_checkouts",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(),
    kind: text("kind").notNull(), // 'subscription' | 'topup'
    /** billing_catalog.key the checkout is for */
    key: text("key").notNull(),
    /** what the customer is asked to pay before tax, in cents (top-ups: the custom price) */
    amountCents: integer("amount_cents").notNull(),
    /** whole dollars for a top-up, else null */
    topupUsd: integer("topup_usd"),
    /** the provider's checkout id, set once the provider returns it */
    providerCheckoutId: text("provider_checkout_id"),
    createdAt: createdAt(),
    completedAt: tstz("completed_at"),
  },
  (t) => [
    uniqueIndex("billing_checkouts_provider_uq").on(t.mode, t.providerCheckoutId),
    index("billing_checkouts_user_idx").on(t.userId, t.createdAt),
  ],
);

/** 80%/100% credit alerts sent, once per user, kind and period. System-only. */
export const billingAlerts = pgTable(
  "billing_alerts",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // credits_80 | credits_100
    periodKey: text("period_key").notNull(),
    sentAt: createdAt(),
  },
  (t) => [uniqueIndex("billing_alerts_uq").on(t.userId, t.kind, t.periodKey)],
);
