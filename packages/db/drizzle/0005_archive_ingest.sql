CREATE TYPE "public"."archive_tier" AS ENUM('unconfirmed', 'corroborated', 'feed_validated');--> statement-breakpoint
CREATE TABLE "archive_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" text NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "archive_relationship_sources" (
	"relationship_id" uuid NOT NULL,
	"source_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "archive_removed_pages" (
	"content_hash" text PRIMARY KEY NOT NULL,
	"removed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "archive_observations" ALTER COLUMN "bundle_path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "archive_entities" ADD COLUMN "tier" "archive_tier" DEFAULT 'unconfirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "archive_entities" ADD COLUMN "display_value" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "archive_entities" ADD COLUMN "sensitive" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "archive_entities" ADD COLUMN "feed_match" text;--> statement-breakpoint
ALTER TABLE "archive_entities" ADD COLUMN "tombstoned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "archive_relationships" ADD COLUMN "independent_source_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "archive_relationships" ADD COLUMN "tier" "archive_tier" DEFAULT 'unconfirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "archive_sources" ADD COLUMN "host" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "archive_sources" ADD COLUMN "kind" text DEFAULT 'page' NOT NULL;--> statement-breakpoint
ALTER TABLE "archive_sources" ADD COLUMN "excerpt" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "archive_sources" ADD COLUMN "tombstoned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "archive_relationship_sources" ADD CONSTRAINT "archive_relationship_sources_relationship_id_archive_relationships_id_fk" FOREIGN KEY ("relationship_id") REFERENCES "public"."archive_relationships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_relationship_sources" ADD CONSTRAINT "archive_relationship_sources_source_id_archive_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."archive_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "archive_jobs_run_uq" ON "archive_jobs" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "archive_jobs_due_idx" ON "archive_jobs" USING btree ("next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "archive_relationship_sources_uq" ON "archive_relationship_sources" USING btree ("relationship_id","source_id");--> statement-breakpoint
CREATE INDEX "archive_relationship_sources_source_idx" ON "archive_relationship_sources" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "archive_entities_live_idx" ON "archive_entities" USING btree ("type") WHERE "archive_entities"."tombstoned_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "archive_observations_triple_uq" ON "archive_observations" USING btree ("entity_id","source_id","observed_at");--> statement-breakpoint
CREATE INDEX "archive_sources_host_idx" ON "archive_sources" USING btree ("host");--> statement-breakpoint
ALTER TABLE "archive_entities" DROP COLUMN "confidence_tier";--> statement-breakpoint
ALTER TABLE "archive_sources" ADD CONSTRAINT "archive_sources_excerpt_len" CHECK (char_length("archive_sources"."excerpt") <= 500);--> statement-breakpoint
DROP TYPE "public"."confidence_tier";
--> statement-breakpoint
-- P4: the queue and the removed-page list are system-only (RLS on, one system policy, no va_app grants).
ALTER TABLE archive_jobs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY system_all ON archive_jobs AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE archive_removed_pages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY system_all ON archive_removed_pages AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);--> statement-breakpoint
-- the evidence table is part of the shared archive: like the other archive_* tables it has no RLS and is read-only for the app role
GRANT SELECT ON archive_relationship_sources TO va_app;
