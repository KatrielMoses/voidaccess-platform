-- pg_trgm for the entity search index (P3). waitlist (P1) joins the main chain here; IF NOT EXISTS because
-- databases provisioned before this migration already have it from apps/site/drizzle/0000_waitlist_init.sql.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"use_case" text,
	"wants_founding" boolean DEFAULT false NOT NULL,
	"first_touch" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ref_code" text,
	"ip_hash" text NOT NULL,
	"consent_marketing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirm_token_hash" text,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "inv_entities" ADD COLUMN "degree" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inv_entities" ADD COLUMN "community" integer;--> statement-breakpoint
ALTER TABLE "inv_entities" ADD COLUMN "search_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "inv_exports" ADD COLUMN "content" "bytea";--> statement-breakpoint
ALTER TABLE "inv_summary" ADD COLUMN "entity_counts" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "inv_summary" ADD COLUMN "stats" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_email_lower_uq" ON "waitlist" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_confirm_token_hash_uq" ON "waitlist" USING btree ("confirm_token_hash");--> statement-breakpoint
CREATE INDEX "inv_entities_search_trgm_idx" ON "inv_entities" USING gin ("search_text" gin_trgm_ops);