import { index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, pk, planEnum, tstz } from "./_common";
import { users } from "./auth";

export const billingIntervalEnum = pgEnum("billing_interval", ["month", "year"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "past_due",
  "cancelled",
  "expired",
  "paused",
]);
export const paymentKindEnum = pgEnum("payment_kind", ["subscription", "topup"]);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("dodo"),
    providerSubscriptionId: text("provider_subscription_id").notNull(),
    providerCustomerId: text("provider_customer_id"),
    plan: planEnum("plan").notNull(),
    interval: billingIntervalEnum("interval").notNull().default("month"),
    status: subscriptionStatusEnum("status").notNull(),
    currentPeriodStart: tstz("current_period_start"),
    currentPeriodEnd: tstz("current_period_end"),
    cancelAt: tstz("cancel_at"),
    createdAt: createdAt(),
    updatedAt: tstz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("subscriptions_provider_id_uq").on(t.provider, t.providerSubscriptionId),
    index("subscriptions_user_idx").on(t.userId),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("dodo"),
    providerPaymentId: text("provider_payment_id").notNull(),
    /** minor units (cents) */
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    kind: paymentKindEnum("kind").notNull(),
    subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
    paidAt: tstz("paid_at").notNull(),
    /** period the payment covers (subscription payments); drives the founding 3-of-12 rule */
    periodStart: tstz("period_start"),
    periodEnd: tstz("period_end"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("payments_provider_id_uq").on(t.provider, t.providerPaymentId),
    index("payments_user_paid_idx").on(t.userId, t.paidAt),
  ],
);
