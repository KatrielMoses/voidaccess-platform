-- P7: Creem replaces Dodo. Dodo only ever ran in test mode and took no payment, so its catalogue rows and customer
-- mappings are dropped (they would block Creem rows: one active key and one customer per user and mode). The Dodo
-- events stay as history, marked provider 'dodo'.
DELETE FROM "billing_catalog";--> statement-breakpoint
DELETE FROM "billing_customers";--> statement-breakpoint
ALTER TABLE "billing_catalog" RENAME COLUMN "dodo_product_id" TO "provider_product_id";--> statement-breakpoint
ALTER TABLE "billing_customers" RENAME COLUMN "dodo_customer_id" TO "provider_customer_id";--> statement-breakpoint
ALTER INDEX "billing_customers_dodo_uq" RENAME TO "billing_customers_provider_uq";--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "provider" SET DEFAULT 'creem';--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "provider" SET DEFAULT 'creem';--> statement-breakpoint
-- events are keyed by (provider, mode, event id): a test event id can never block, or be confused with, a live one
ALTER TABLE "billing_events" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "billing_events" ADD COLUMN "mode" text;--> statement-breakpoint
UPDATE "billing_events" SET "provider" = 'dodo', "mode" = 'test';--> statement-breakpoint
ALTER TABLE "billing_events" ALTER COLUMN "provider" SET DEFAULT 'creem';--> statement-breakpoint
ALTER TABLE "billing_events" ALTER COLUMN "provider" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_events" ALTER COLUMN "mode" SET DEFAULT 'test';--> statement-breakpoint
ALTER TABLE "billing_events" ALTER COLUMN "mode" SET NOT NULL;--> statement-breakpoint
DROP INDEX "billing_events_event_id_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "billing_events_provider_event_uq" ON "billing_events" USING btree ("provider","mode","event_id");--> statement-breakpoint
CREATE TABLE "billing_checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"topup_usd" integer,
	"provider_checkout_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "billing_checkouts" ADD CONSTRAINT "billing_checkouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkouts_provider_uq" ON "billing_checkouts" USING btree ("mode","provider_checkout_id");--> statement-breakpoint
CREATE INDEX "billing_checkouts_user_idx" ON "billing_checkouts" USING btree ("user_id","created_at");--> statement-breakpoint
-- P7: billing_checkouts is system-only (RLS on, one system policy, no va_app grants; default privileges give va_system ALL).
ALTER TABLE billing_checkouts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY system_all ON billing_checkouts AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
