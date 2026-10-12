CREATE TABLE "billing_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"plan" "plan",
	"interval" "billing_interval",
	"topup_usd" integer,
	"amount_cents" integer NOT NULL,
	"mode" text NOT NULL,
	"dodo_product_id" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"dodo_customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"user_id" uuid,
	"event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "product_key" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider_event_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_grant_period_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_product_key" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_effective_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "pending_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "is_founding" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_alerts" ADD CONSTRAINT "billing_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_customers" ADD CONSTRAINT "billing_customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_alerts_uq" ON "billing_alerts" USING btree ("user_id","kind","period_key");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_catalog_product_uq" ON "billing_catalog" USING btree ("mode","dodo_product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_catalog_active_key_uq" ON "billing_catalog" USING btree ("mode","key") WHERE "billing_catalog"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customers_user_mode_uq" ON "billing_customers" USING btree ("user_id","mode");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_customers_dodo_uq" ON "billing_customers" USING btree ("mode","dodo_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_events_event_id_uq" ON "billing_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "billing_events_type_idx" ON "billing_events" USING btree ("type","created_at");--> statement-breakpoint
-- P5: all four tables are system-only (no va_app grants; default privileges give va_system ALL). RLS on, one system policy.
ALTER TABLE billing_catalog ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY system_all ON billing_catalog AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE billing_customers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY system_all ON billing_customers AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY system_all ON billing_events AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);--> statement-breakpoint
ALTER TABLE billing_alerts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY system_all ON billing_alerts AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
