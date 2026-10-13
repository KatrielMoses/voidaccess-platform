CREATE TABLE "lifecycle_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "product_emails" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "product_emails_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "star_prompt_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lifecycle_emails" ADD CONSTRAINT "lifecycle_emails_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lifecycle_emails_user_kind_uq" ON "lifecycle_emails" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "lifecycle_emails_kind_idx" ON "lifecycle_emails" USING btree ("kind");--> statement-breakpoint
-- P6: lifecycle_emails is system-only (RLS on, one system policy, no va_app grants; default privileges give va_system ALL).
ALTER TABLE lifecycle_emails ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY system_all ON lifecycle_emails AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);--> statement-breakpoint
-- P6: a user may change their own email preference and dismiss the star prompt (column-level, on top of the own_row policy).
-- updated_at is included because drizzle bumps it on every UPDATE of users.
GRANT UPDATE (product_emails, product_emails_changed_at, star_prompt_dismissed_at, updated_at) ON users TO va_app;--> statement-breakpoint
-- P6: once-only analytics events (graph_viewed per investigation, ...): a writer sets props.dedupeKey and inserts ON CONFLICT DO NOTHING.
CREATE UNIQUE INDEX events_dedupe_uq ON events (name, user_id, (props->>'dedupeKey')) WHERE props ? 'dedupeKey';
