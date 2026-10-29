-- 2.2 remaster (22T): contract v0.4 relevance tiers on the snapshot tables. Backward compatible: every column is
-- nullable with no default (a metadata-only ADD COLUMN: no row is rewritten, so the inv_* immutability triggers, which
-- block UPDATE, never fire), and snapshots ingested before this migration keep NULL tiers, which the app renders
-- exactly as before. The CHECKs pass for every existing row (all NULL). va_app's table-level SELECT grants and the
-- own_rows policies cover the new columns unchanged; ingest (va_system) writes them once, at insert.
ALTER TABLE "inv_entities" ADD COLUMN "relevance" text;--> statement-breakpoint
ALTER TABLE "inv_entities" ADD COLUMN "relevance_reason" text;--> statement-breakpoint
ALTER TABLE "inv_relationships" ADD COLUMN "relevance" text;--> statement-breakpoint
ALTER TABLE "inv_sources" ADD COLUMN "relevance" text;--> statement-breakpoint
ALTER TABLE "inv_sources" ADD COLUMN "relevance_reason" text;--> statement-breakpoint
ALTER TABLE "inv_sources" ADD COLUMN "page_kind" text;--> statement-breakpoint
ALTER TABLE "inv_summary" ADD COLUMN "relevance" jsonb;--> statement-breakpoint
CREATE INDEX "inv_entities_inv_relevance_idx" ON "inv_entities" USING btree ("investigation_id","relevance");--> statement-breakpoint
ALTER TABLE "inv_entities" ADD CONSTRAINT "inv_entities_relevance_check" CHECK ("inv_entities"."relevance" IS NULL OR "inv_entities"."relevance" IN ('direct', 'related', 'background'));--> statement-breakpoint
ALTER TABLE "inv_relationships" ADD CONSTRAINT "inv_relationships_relevance_check" CHECK ("inv_relationships"."relevance" IS NULL OR "inv_relationships"."relevance" IN ('direct', 'related', 'background'));--> statement-breakpoint
ALTER TABLE "inv_sources" ADD CONSTRAINT "inv_sources_relevance_check" CHECK ("inv_sources"."relevance" IS NULL OR "inv_sources"."relevance" IN ('direct', 'related', 'background'));