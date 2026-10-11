CREATE TYPE "public"."depth" AS ENUM('quick', 'standard', 'deep');--> statement-breakpoint
CREATE TYPE "public"."plan" AS ENUM('free', 'pro', 'pro_plus');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'banned');--> statement-breakpoint
CREATE TYPE "public"."investigation_status" AS ENUM('reserved', 'launching', 'running', 'ingesting', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ledger_bucket" AS ENUM('grant', 'topup');--> statement-breakpoint
CREATE TYPE "public"."ledger_reason" AS ENUM('grant', 'expiry', 'reserve', 'settle', 'refund', 'topup', 'bonus', 'admin');--> statement-breakpoint
CREATE TYPE "public"."billing_interval" AS ENUM('month', 'year');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('subscription', 'topup');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'past_due', 'cancelled', 'expired', 'paused');--> statement-breakpoint
CREATE TYPE "public"."founding_notice_kind" AS ENUM('renewal_check_30d', 'inactivity_30d', 'release_day');--> statement-breakpoint
CREATE TYPE "public"."abuse_flag_status" AS ENUM('open', 'reviewed', 'dismissed', 'actioned');--> statement-breakpoint
CREATE TYPE "public"."confidence_tier" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"aup_accepted_at" timestamp with time zone,
	"plan" "plan" DEFAULT 'free' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"profile_role" text,
	"profile_use_case" text,
	"first_touch" jsonb,
	"referral_code" text,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_actors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"investigation_id" uuid NOT NULL,
	"bundle_id" text NOT NULL,
	"handle" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"entity_bundle_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"first_seen" timestamp with time zone,
	"last_seen" timestamp with time zone,
	"summary" text
);
--> statement-breakpoint
CREATE TABLE "inv_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"investigation_id" uuid NOT NULL,
	"bundle_id" text NOT NULL,
	"type" text NOT NULL,
	"value" text,
	"display_value" text NOT NULL,
	"fingerprint" text,
	"sensitive" boolean DEFAULT false NOT NULL,
	"confidence" double precision NOT NULL,
	"first_seen" timestamp with time zone,
	"source_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"investigation_id" uuid NOT NULL,
	"format" text NOT NULL,
	"object_path" text NOT NULL,
	"bytes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"investigation_id" uuid NOT NULL,
	"source_bundle_id" text NOT NULL,
	"target_bundle_id" text NOT NULL,
	"type" text NOT NULL,
	"weight" double precision DEFAULT 1 NOT NULL,
	"evidence_source_ids" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inv_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"investigation_id" uuid NOT NULL,
	"bundle_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"fetched_at" timestamp with time zone NOT NULL,
	"excerpt" text DEFAULT '' NOT NULL,
	CONSTRAINT "inv_sources_excerpt_len" CHECK (char_length("inv_sources"."excerpt") <= 500)
);
--> statement-breakpoint
CREATE TABLE "inv_summary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"investigation_id" uuid NOT NULL,
	"markdown" text NOT NULL,
	"key_findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" text NOT NULL,
	"source_count" integer DEFAULT 0 NOT NULL,
	"communities" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investigations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"query" text NOT NULL,
	"depth" "depth" NOT NULL,
	"status" "investigation_status" DEFAULT 'reserved' NOT NULL,
	"engine_run_id" text,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"refined_queries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failure_reason" text,
	"summary_kind" text
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"run_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"type" text NOT NULL,
	"stage" text,
	"counts" jsonb,
	"at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_events_run_id_seq_pk" PRIMARY KEY("run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bucket" "ledger_bucket" NOT NULL,
	"amount" integer NOT NULL,
	"reason" "ledger_reason" NOT NULL,
	"investigation_id" uuid,
	"lot_id" uuid,
	"expires_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_amount_nonzero" CHECK ("credit_ledger"."amount" <> 0),
	CONSTRAINT "credit_ledger_lot_iff_topup" CHECK (("credit_ledger"."bucket" = 'topup') = ("credit_ledger"."lot_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "topup_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credits_initial" integer NOT NULL,
	"remaining" integer NOT NULL,
	"usd" integer,
	"payment_ref" text,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "topup_lots_remaining_nonneg" CHECK ("topup_lots"."remaining" >= 0),
	CONSTRAINT "topup_lots_remaining_le_initial" CHECK ("topup_lots"."remaining" <= "topup_lots"."credits_initial")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text DEFAULT 'dodo' NOT NULL,
	"provider_payment_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"subscription_id" uuid,
	"paid_at" timestamp with time zone NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text DEFAULT 'dodo' NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"provider_customer_id" text,
	"plan" "plan" NOT NULL,
	"interval" "billing_interval" DEFAULT 'month' NOT NULL,
	"status" "subscription_status" NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "founding_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"seat_no" integer NOT NULL,
	"kind" "founding_notice_kind" NOT NULL,
	"ref_at" timestamp with time zone NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "founding_seats" (
	"seat_no" integer PRIMARY KEY NOT NULL,
	"holder_user_id" uuid,
	"last_holder_user_id" uuid,
	"claimed_at" timestamp with time zone,
	"term_start" timestamp with time zone,
	"anniversary_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"release_reason" text,
	CONSTRAINT "founding_seats_holder_user_id_unique" UNIQUE("holder_user_id"),
	CONSTRAINT "founding_seats_seat_no_range" CHECK ("founding_seats"."seat_no" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "abuse_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"investigation_id" uuid,
	"kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "abuse_flag_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"user_id" uuid,
	"anonymous_id" text,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"utm" jsonb,
	"ref" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investigation_id" uuid NOT NULL,
	"compute_usd" double precision DEFAULT 0 NOT NULL,
	"llm_usd" double precision DEFAULT 0 NOT NULL,
	"tokens_in" bigint DEFAULT 0 NOT NULL,
	"tokens_out" bigint DEFAULT 0 NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credential_vault" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"investigation_id" uuid,
	"kind" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"iv" "bytea" NOT NULL,
	"auth_tag" "bytea" NOT NULL,
	"wrapped_dek" "bytea" NOT NULL,
	"key_ref" text NOT NULL,
	"masked_value" text NOT NULL,
	"fingerprint" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "archive_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"kind" text DEFAULT 'name' NOT NULL,
	"first_seen" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "archive_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"canonical_value" text,
	"fingerprint" text,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"observation_count" integer DEFAULT 1 NOT NULL,
	"independent_source_count" integer DEFAULT 1 NOT NULL,
	"confidence_tier" "confidence_tier" DEFAULT 'low' NOT NULL,
	CONSTRAINT "archive_entities_value_or_fp" CHECK ("archive_entities"."canonical_value" IS NOT NULL OR "archive_entities"."fingerprint" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "archive_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"bundle_path" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "archive_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"a_entity_id" uuid NOT NULL,
	"b_entity_id" uuid NOT NULL,
	"type" text NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"evidence_count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "archive_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"last_seen" timestamp with time zone NOT NULL,
	"last_alive" timestamp with time zone,
	"content_hash" text,
	"snapshot_path" text
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_actors" ADD CONSTRAINT "inv_actors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_actors" ADD CONSTRAINT "inv_actors_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."investigations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_entities" ADD CONSTRAINT "inv_entities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_entities" ADD CONSTRAINT "inv_entities_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."investigations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_exports" ADD CONSTRAINT "inv_exports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_exports" ADD CONSTRAINT "inv_exports_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."investigations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_relationships" ADD CONSTRAINT "inv_relationships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_relationships" ADD CONSTRAINT "inv_relationships_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."investigations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_sources" ADD CONSTRAINT "inv_sources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_sources" ADD CONSTRAINT "inv_sources_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."investigations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_summary" ADD CONSTRAINT "inv_summary_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inv_summary" ADD CONSTRAINT "inv_summary_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."investigations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_investigations_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."investigations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_lot_id_topup_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."topup_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topup_lots" ADD CONSTRAINT "topup_lots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founding_notices" ADD CONSTRAINT "founding_notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founding_seats" ADD CONSTRAINT "founding_seats_holder_user_id_users_id_fk" FOREIGN KEY ("holder_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founding_seats" ADD CONSTRAINT "founding_seats_last_holder_user_id_users_id_fk" FOREIGN KEY ("last_holder_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abuse_flags" ADD CONSTRAINT "abuse_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abuse_flags" ADD CONSTRAINT "abuse_flags_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."investigations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abuse_flags" ADD CONSTRAINT "abuse_flags_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_costs" ADD CONSTRAINT "run_costs_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."investigations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_vault" ADD CONSTRAINT "credential_vault_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_vault" ADD CONSTRAINT "credential_vault_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."investigations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_aliases" ADD CONSTRAINT "archive_aliases_entity_id_archive_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."archive_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_observations" ADD CONSTRAINT "archive_observations_entity_id_archive_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."archive_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_observations" ADD CONSTRAINT "archive_observations_source_id_archive_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."archive_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_relationships" ADD CONSTRAINT "archive_relationships_a_entity_id_archive_entities_id_fk" FOREIGN KEY ("a_entity_id") REFERENCES "public"."archive_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive_relationships" ADD CONSTRAINT "archive_relationships_b_entity_id_archive_entities_id_fk" FOREIGN KEY ("b_entity_id") REFERENCES "public"."archive_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_actors_inv_bundle_uq" ON "inv_actors" USING btree ("investigation_id","bundle_id");--> statement-breakpoint
CREATE INDEX "inv_actors_user_idx" ON "inv_actors" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_entities_inv_bundle_uq" ON "inv_entities" USING btree ("investigation_id","bundle_id");--> statement-breakpoint
CREATE INDEX "inv_entities_user_idx" ON "inv_entities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "inv_entities_inv_type_idx" ON "inv_entities" USING btree ("investigation_id","type");--> statement-breakpoint
CREATE INDEX "inv_entities_fingerprint_idx" ON "inv_entities" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_exports_inv_format_uq" ON "inv_exports" USING btree ("investigation_id","format");--> statement-breakpoint
CREATE INDEX "inv_exports_user_idx" ON "inv_exports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "inv_relationships_inv_idx" ON "inv_relationships" USING btree ("investigation_id");--> statement-breakpoint
CREATE INDEX "inv_relationships_user_idx" ON "inv_relationships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_sources_inv_bundle_uq" ON "inv_sources" USING btree ("investigation_id","bundle_id");--> statement-breakpoint
CREATE INDEX "inv_sources_user_idx" ON "inv_sources" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inv_summary_inv_uq" ON "inv_summary" USING btree ("investigation_id");--> statement-breakpoint
CREATE INDEX "inv_summary_user_idx" ON "inv_summary" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "investigations_user_created_idx" ON "investigations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "investigations_status_idx" ON "investigations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "investigations_engine_run_id_uq" ON "investigations" USING btree ("engine_run_id");--> statement-breakpoint
CREATE INDEX "run_events_user_idx" ON "run_events" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_idempotency_uq" ON "credit_ledger" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "credit_ledger_user_idx" ON "credit_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_investigation_idx" ON "credit_ledger" USING btree ("investigation_id");--> statement-breakpoint
CREATE INDEX "topup_lots_user_expiry_idx" ON "topup_lots" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_id_uq" ON "payments" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "payments_user_paid_idx" ON "payments" USING btree ("user_id","paid_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_id_uq" ON "subscriptions" USING btree ("provider","provider_subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_user_idx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "founding_notices_dedupe_uq" ON "founding_notices" USING btree ("user_id","kind","ref_at");--> statement-breakpoint
CREATE INDEX "founding_notices_due_idx" ON "founding_notices" USING btree ("scheduled_for") WHERE "founding_notices"."sent_at" IS NULL;--> statement-breakpoint
CREATE INDEX "abuse_flags_status_idx" ON "abuse_flags" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_at_idx" ON "audit_log" USING btree ("action","at");--> statement-breakpoint
CREATE INDEX "events_name_at_idx" ON "events" USING btree ("name","at");--> statement-breakpoint
CREATE INDEX "events_user_idx" ON "events" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "run_costs_investigation_uq" ON "run_costs" USING btree ("investigation_id");--> statement-breakpoint
CREATE INDEX "credential_vault_user_idx" ON "credential_vault" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credential_vault_fingerprint_idx" ON "credential_vault" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "archive_aliases_uq" ON "archive_aliases" USING btree ("entity_id","alias");--> statement-breakpoint
CREATE INDEX "archive_aliases_alias_idx" ON "archive_aliases" USING btree ("alias");--> statement-breakpoint
CREATE UNIQUE INDEX "archive_entities_type_value_uq" ON "archive_entities" USING btree ("type","canonical_value");--> statement-breakpoint
CREATE UNIQUE INDEX "archive_entities_type_fp_uq" ON "archive_entities" USING btree ("type","fingerprint");--> statement-breakpoint
CREATE INDEX "archive_observations_entity_idx" ON "archive_observations" USING btree ("entity_id","observed_at");--> statement-breakpoint
CREATE INDEX "archive_observations_source_idx" ON "archive_observations" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "archive_relationships_uq" ON "archive_relationships" USING btree ("a_entity_id","b_entity_id","type");--> statement-breakpoint
CREATE INDEX "archive_relationships_b_idx" ON "archive_relationships" USING btree ("b_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "archive_sources_url_uq" ON "archive_sources" USING btree ("url");