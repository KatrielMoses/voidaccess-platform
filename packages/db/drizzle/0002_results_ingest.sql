CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
ALTER TABLE "inv_entities" ADD COLUMN "degree" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inv_entities" ADD COLUMN "community" integer;--> statement-breakpoint
ALTER TABLE "inv_entities" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inv_exports" ADD COLUMN "content" "bytea";--> statement-breakpoint
ALTER TABLE "inv_summary" ADD COLUMN "entity_counts" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inv_summary" ADD COLUMN "stats" jsonb;--> statement-breakpoint
CREATE INDEX "inv_entities_search_trgm_idx" ON "inv_entities" USING gin ("search_text" gin_trgm_ops);
