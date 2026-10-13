CREATE TABLE "blocked_email_domains" (
	"domain" text PRIMARY KEY NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"path" text NOT NULL,
	"user_id" uuid,
	"ip_hash" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "blocked_email_domains" ADD CONSTRAINT "blocked_email_domains_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_limit_events" ADD CONSTRAINT "rate_limit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rate_limit_events_at_idx" ON "rate_limit_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "rate_limit_events_user_idx" ON "rate_limit_events" USING btree ("user_id");
--> statement-breakpoint
-- H1: all three tables are system-only (no va_app grants; default privileges give va_system ALL). RLS on, one system policy.
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON rate_limits AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE rate_limit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON rate_limit_events AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE blocked_email_domains ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON blocked_email_domains AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE blocked_email_domains ADD CONSTRAINT blocked_email_domains_domain_form
  CHECK (domain = lower(domain) AND domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$');
