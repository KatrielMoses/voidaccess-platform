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
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_email_lower_uq" ON "waitlist" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_confirm_token_hash_uq" ON "waitlist" USING btree ("confirm_token_hash");