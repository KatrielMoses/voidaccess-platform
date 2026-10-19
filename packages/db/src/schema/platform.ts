import { sql } from "drizzle-orm";
import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uuid,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createdAt, pk, tstz } from "./_common";
import { users } from "./auth";
import { investigations } from "./investigations";

/** Analytics funnel (PRD §7 event names). user_id nullable: anonymous visitors. System-written only. */
export const events = pgTable(
  "events",
  {
    id: pk(),
    name: text("name").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    anonymousId: text("anonymous_id"),
    props: jsonb("props")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    utm: jsonb("utm").$type<Record<string, string>>(),
    ref: text("ref"),
    at: tstz("at").notNull().defaultNow(),
  },
  (t) => [index("events_name_at_idx").on(t.name, t.at), index("events_user_idx").on(t.userId)],
);

export const abuseFlagStatusEnum = pgEnum("abuse_flag_status", ["open", "reviewed", "dismissed", "actioned"]);

export const abuseFlags = pgTable(
  "abuse_flags",
  {
    id: pk(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    investigationId: uuid("investigation_id").references(() => investigations.id, { onDelete: "set null" }),
    kind: text("kind").notNull(), // e.g. blocked_query, rate_limit, manual
    detail: jsonb("detail")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: abuseFlagStatusEnum("status").notNull().default("open"),
    createdAt: createdAt(),
    reviewedAt: tstz("reviewed_at"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [index("abuse_flags_status_idx").on(t.status, t.createdAt)],
);

/** Every system-role transaction and every credential decrypt leaves a row here. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: pk(),
    actor: text("actor").notNull(), // user id, "system", "cron", "webhook:creem" ...
    action: text("action").notNull(),
    target: text("target"),
    at: tstz("at").notNull().defaultNow(),
    meta: jsonb("meta")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [index("audit_log_action_at_idx").on(t.action, t.at)],
);

/** Measured cost per run for the admin cost-vs-charge view. System-only. */
export const runCosts = pgTable(
  "run_costs",
  {
    id: pk(),
    investigationId: uuid("investigation_id")
      .notNull()
      .references(() => investigations.id, { onDelete: "cascade" }),
    computeUsd: doublePrecision("compute_usd").notNull().default(0),
    llmUsd: doublePrecision("llm_usd").notNull().default(0),
    tokensIn: bigint("tokens_in", { mode: "number" }).notNull().default(0),
    tokensOut: bigint("tokens_out", { mode: "number" }).notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    measuredAt: tstz("measured_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("run_costs_investigation_uq").on(t.investigationId)],
);
