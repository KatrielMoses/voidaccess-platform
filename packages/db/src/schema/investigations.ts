import { sql } from "drizzle-orm";
import {
  check,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  primaryKey,
  bigint,
} from "drizzle-orm/pg-core";
import { createdAt, depthEnum, pk, tstz } from "./_common";
import { users } from "./auth";

export const INVESTIGATION_STATUSES = [
  "reserved",
  "launching",
  "running",
  "ingesting",
  "completed",
  "failed",
  "cancelled",
] as const;
export const investigationStatusEnum = pgEnum("investigation_status", INVESTIGATION_STATUSES);

export const investigations = pgTable(
  "investigations",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    query: text("query").notNull(),
    depth: depthEnum("depth").notNull(),
    status: investigationStatusEnum("status").notNull().default("reserved"),
    engineRunId: text("engine_run_id"),
    /** Net credits charged (reserve minus refunds). Prices come from @voidaccess/config via the ledger. */
    creditsCharged: integer("credits_charged").notNull().default(0),
    refinedQueries: jsonb("refined_queries")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    startedAt: tstz("started_at"),
    completedAt: tstz("completed_at"),
    updatedAt: tstz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    failureReason: text("failure_reason"),
    summaryKind: text("summary_kind"),
  },
  (t) => [
    index("investigations_user_created_idx").on(t.userId, t.createdAt),
    index("investigations_status_idx").on(t.status),
    uniqueIndex("investigations_engine_run_id_uq").on(t.engineRunId),
  ],
);

export const runEvents = pgTable(
  "run_events",
  {
    // run_id is the investigation id (one engine run per investigation)
    runId: uuid("run_id")
      .notNull()
      .references(() => investigations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").notNull(),
    stage: text("stage"),
    counts: jsonb("counts").$type<Record<string, number>>(),
    at: tstz("at").notNull(),
    receivedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.seq] }), index("run_events_user_idx").on(t.userId)],
);

// ---- snapshot tables: immutable after ingest (UPDATE blocked by trigger) ----

const snapshotBase = {
  id: pk(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  investigationId: uuid("investigation_id")
    .notNull()
    .references(() => investigations.id, { onDelete: "cascade" }),
};

export const invEntities = pgTable(
  "inv_entities",
  {
    ...snapshotBase,
    /** id from the bundle, stable within the investigation (relationships reference it) */
    bundleId: text("bundle_id").notNull(),
    type: text("type").notNull(),
    /** Raw value for non-sensitive entities; null when sensitive (raw lives only in credential_vault). */
    value: text("value"),
    displayValue: text("display_value").notNull(),
    fingerprint: text("fingerprint"),
    sensitive: boolean("sensitive").notNull().default(false),
    confidence: doublePrecision("confidence").notNull(),
    firstSeen: tstz("first_seen"),
    sourceIds: text("source_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (t) => [
    uniqueIndex("inv_entities_inv_bundle_uq").on(t.investigationId, t.bundleId),
    index("inv_entities_user_idx").on(t.userId),
    index("inv_entities_inv_type_idx").on(t.investigationId, t.type),
    index("inv_entities_fingerprint_idx").on(t.fingerprint),
  ],
);

export const invRelationships = pgTable(
  "inv_relationships",
  {
    ...snapshotBase,
    sourceBundleId: text("source_bundle_id").notNull(),
    targetBundleId: text("target_bundle_id").notNull(),
    type: text("type").notNull(),
    weight: doublePrecision("weight").notNull().default(1),
    evidenceSourceIds: text("evidence_source_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (t) => [
    index("inv_relationships_inv_idx").on(t.investigationId),
    index("inv_relationships_user_idx").on(t.userId),
  ],
);

export const invActors = pgTable(
  "inv_actors",
  {
    ...snapshotBase,
    bundleId: text("bundle_id").notNull(),
    handle: text("handle").notNull(),
    aliases: text("aliases")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    entityBundleIds: text("entity_bundle_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    firstSeen: tstz("first_seen"),
    lastSeen: tstz("last_seen"),
    summary: text("summary"),
  },
  (t) => [
    uniqueIndex("inv_actors_inv_bundle_uq").on(t.investigationId, t.bundleId),
    index("inv_actors_user_idx").on(t.userId),
  ],
);

export const invSources = pgTable(
  "inv_sources",
  {
    ...snapshotBase,
    bundleId: text("bundle_id").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    url: text("url"),
    fetchedAt: tstz("fetched_at").notNull(),
    /** sanitized excerpt, at most 500 chars (enforced by CHECK) */
    excerpt: text("excerpt").notNull().default(""),
  },
  (t) => [
    uniqueIndex("inv_sources_inv_bundle_uq").on(t.investigationId, t.bundleId),
    index("inv_sources_user_idx").on(t.userId),
    check("inv_sources_excerpt_len", sql`char_length(${t.excerpt}) <= 500`),
  ],
);

export const invSummary = pgTable(
  "inv_summary",
  {
    ...snapshotBase,
    markdown: text("markdown").notNull(),
    keyFindings: jsonb("key_findings")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    riskNotes: jsonb("risk_notes")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    confidence: text("confidence").notNull(),
    sourceCount: integer("source_count").notNull().default(0),
    communities: jsonb("communities")
      .$type<Array<{ id: number; entity_ids: string[]; label?: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
  },
  (t) => [
    uniqueIndex("inv_summary_inv_uq").on(t.investigationId),
    index("inv_summary_user_idx").on(t.userId),
  ],
);

export const invExports = pgTable(
  "inv_exports",
  {
    ...snapshotBase,
    format: text("format").notNull(),
    objectPath: text("object_path").notNull(),
    bytes: bigint("bytes", { mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("inv_exports_inv_format_uq").on(t.investigationId, t.format),
    index("inv_exports_user_idx").on(t.userId),
  ],
);
