CREATE TABLE "crypto_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"kind" text NOT NULL,
	"plan" "plan",
	"interval" "billing_interval",
	"topup_usd" integer,
	"price_cents" integer NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"provider_invoice_id" text,
	"provider_payment_id" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crypto_orders_kind_check" CHECK ("crypto_orders"."kind" in ('topup', 'pass')),
	CONSTRAINT "crypto_orders_mode_check" CHECK ("crypto_orders"."mode" in ('test', 'live')),
	CONSTRAINT "crypto_orders_status_check" CHECK ("crypto_orders"."status" in ('created', 'waiting', 'confirming', 'confirmed', 'sending', 'partially_paid', 'finished', 'failed', 'expired', 'refunded')),
	CONSTRAINT "crypto_orders_shape_check" CHECK (("crypto_orders"."kind" = 'topup' and "crypto_orders"."topup_usd" is not null and "crypto_orders"."plan" is null and "crypto_orders"."interval" is null) or ("crypto_orders"."kind" = 'pass' and "crypto_orders"."plan" is not null and "crypto_orders"."interval" is not null and "crypto_orders"."topup_usd" is null))
);
--> statement-breakpoint
ALTER TABLE "crypto_orders" ADD CONSTRAINT "crypto_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "crypto_orders_invoice_uq" ON "crypto_orders" USING btree ("provider_invoice_id");--> statement-breakpoint
CREATE INDEX "crypto_orders_user_created_idx" ON "crypto_orders" USING btree ("user_id","created_at");--> statement-breakpoint
-- Crypto payments: crypto_orders is system-only (RLS on, one system policy, no va_app grants; default privileges give va_system ALL).
-- The app reads a user's orders through withSystem filtered by user id.
ALTER TABLE crypto_orders ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY system_all ON crypto_orders AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
