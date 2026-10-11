// THE ARCHIVE (shared corpus). By design these tables have NO user_id, query or investigation-id
// columns and must never gain any: a test fails the build if they do. Schema only here; ingest is P4.
import { sql } from "drizzle-orm";
import { index, integer, pgEnum, pgTable, text, uniqueIndex, uuid, check } from "drizzle-orm/pg-core";
import { pk, tstz } from "./_common";

export const confidenceTierEnum = pgEnum("confidence_tier", ["low", "medium", "high"]);

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
    confidenceTier: confidenceTierEnum("confidence_tier").notNull().default("low"),
  },
  (t) => [
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
    snapshotPath: text("snapshot_path"), // GCS object path of the sanitized snapshot
  },
  (t) => [uniqueIndex("archive_sources_url_uq").on(t.url)],
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
    bundlePath: text("bundle_path").notNull(), // GCS path of the immutable dated bundle
  },
  (t) => [
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
