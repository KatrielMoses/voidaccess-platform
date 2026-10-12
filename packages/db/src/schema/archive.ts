// THE ARCHIVE (shared corpus). By design these tables have NO user_id, query or investigation-id
// columns and must never gain any: a test fails the build if they do. Schema only here; ingest is P4.
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  check,
} from "drizzle-orm/pg-core";
import { pk, tstz } from "./_common";

/** unconfirmed: one independent source; corroborated: two or more distinct source hosts; feed_validated: matches a licensed public feed. */
export const archiveTierEnum = pgEnum("archive_tier", ["unconfirmed", "corroborated", "feed_validated"]);

export const archiveEntities = pgTable(
  "archive_entities",
  {
    id: pk(),
    type: text("type").notNull(),
    /** canonical value for public identifiers; for sensitive types only the fingerprint is stored */
    canonicalValue: text("canonical_value"),
    fingerprint: text("fingerprint"),
    firstSeen: tstz("first_seen").notNull(),
    lastSeen: tstz("last_seen").notNull(),
    observationCount: integer("observation_count").notNull().default(1),
    independentSourceCount: integer("independent_source_count").notNull().default(1),
    tier: archiveTierEnum("tier").notNull().default("unconfirmed"),
    /** what to show: the first-seen form for public identifiers, the masked form for sensitive ones (never the raw value) */
    displayValue: text("display_value").notNull().default(""),
    sensitive: boolean("sensitive").notNull().default(false),
    /** name of the licensed public feed that validates this entity (e.g. cisa_kev), if any */
    feedMatch: text("feed_match"),
    /** removal: tombstoned rows are hidden from every read (see removeFromArchive) */
    tombstonedAt: tstz("tombstoned_at"),
  },
  (t) => [
    index("archive_entities_live_idx")
      .on(t.type)
      .where(sql`${t.tombstonedAt} IS NULL`),
    uniqueIndex("archive_entities_type_value_uq").on(t.type, t.canonicalValue),
    uniqueIndex("archive_entities_type_fp_uq").on(t.type, t.fingerprint),
    check(
      "archive_entities_value_or_fp",
      sql`${t.canonicalValue} IS NOT NULL OR ${t.fingerprint} IS NOT NULL`,
    ),
  ],
);

export const archiveSources = pgTable(
  "archive_sources",
  {
    id: pk(),
    url: text("url").notNull(), // clearnet URL or onion address
    firstSeen: tstz("first_seen").notNull(),
    lastSeen: tstz("last_seen").notNull(),
    lastAlive: tstz("last_alive"),
    contentHash: text("content_hash"),
    snapshotPath: text("snapshot_path"), // object key of the sanitized snapshot (pages/<sha256>.txt.gz)
    /** independence key: the registrable domain for clearnet, the full onion host for onion services */
    host: text("host").notNull().default(""),
    kind: text("kind").notNull().default("page"),
    /** latest sanitized excerpt (at most 500 characters) */
    excerpt: text("excerpt").notNull().default(""),
    tombstonedAt: tstz("tombstoned_at"),
  },
  (t) => [
    uniqueIndex("archive_sources_url_uq").on(t.url),
    index("archive_sources_host_idx").on(t.host),
    check("archive_sources_excerpt_len", sql`char_length(${t.excerpt}) <= 500`),
  ],
);

export const archiveObservations = pgTable(
  "archive_observations",
  {
    id: pk(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => archiveEntities.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => archiveSources.id, { onDelete: "cascade" }),
    observedAt: tstz("observed_at").notNull(),
    /** unused (nullable): bundles contain run ids and queries, so they are never archived */
    bundlePath: text("bundle_path"),
  },
  (t) => [
    uniqueIndex("archive_observations_triple_uq").on(t.entityId, t.sourceId, t.observedAt),
    index("archive_observations_entity_idx").on(t.entityId, t.observedAt),
    index("archive_observations_source_idx").on(t.sourceId),
  ],
);

export const archiveRelationships = pgTable(
  "archive_relationships",
  {
    id: pk(),
    aEntityId: uuid("a_entity_id")
      .notNull()
      .references(() => archiveEntities.id, { onDelete: "cascade" }),
    bEntityId: uuid("b_entity_id")
      .notNull()
      .references(() => archiveEntities.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    firstSeen: tstz("first_seen").notNull(),
    lastSeen: tstz("last_seen").notNull(),
    evidenceCount: integer("evidence_count").notNull().default(1),
    independentSourceCount: integer("independent_source_count").notNull().default(1),
    tier: archiveTierEnum("tier").notNull().default("unconfirmed"),
  },
  (t) => [
    uniqueIndex("archive_relationships_uq").on(t.aEntityId, t.bEntityId, t.type),
    index("archive_relationships_b_idx").on(t.bEntityId),
  ],
);

export const archiveAliases = pgTable(
  "archive_aliases",
  {
    id: pk(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => archiveEntities.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    kind: text("kind").notNull().default("name"),
    firstSeen: tstz("first_seen").notNull(),
  },
  (t) => [
    uniqueIndex("archive_aliases_uq").on(t.entityId, t.alias),
    index("archive_aliases_alias_idx").on(t.alias),
  ],
);

/** The distinct pages that evidence a relationship: counts and independence come from here, so a re-fetch never double-counts. */
export const archiveRelationshipSources = pgTable(
  "archive_relationship_sources",
  {
    relationshipId: uuid("relationship_id")
      .notNull()
      .references(() => archiveRelationships.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => archiveSources.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("archive_relationship_sources_uq").on(t.relationshipId, t.sourceId),
    index("archive_relationship_sources_source_idx").on(t.sourceId),
  ],
);

/** Page snapshots that were removed: a later run must not put the same content back. System-only. */
export const archiveRemovedPages = pgTable("archive_removed_pages", {
  contentHash: text("content_hash").primaryKey(),
  removedAt: tstz("removed_at").notNull().defaultNow(),
});

/**
 * The transient work queue that feeds the archive. System-only. It holds only a run id and bookkeeping, and a
 * row is deleted as soon as its run has been archived, so nothing here outlives the work.
 */
export const archiveJobs = pgTable(
  "archive_jobs",
  {
    id: pk(),
    runId: text("run_id").notNull(),
    enqueuedAt: tstz("enqueued_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: tstz("next_attempt_at").notNull().defaultNow(),
    lockedAt: tstz("locked_at"),
  },
  (t) => [uniqueIndex("archive_jobs_run_uq").on(t.runId), index("archive_jobs_due_idx").on(t.nextAttemptAt)],
);
