CREATE TABLE "blocked_email_domains" (
	"domain" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- PLACEHOLDER for H1's table (system-only, RLS on, one system policy). The architect drops this migration at merge in favour of H1's.
ALTER TABLE blocked_email_domains ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY system_all ON blocked_email_domains AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
