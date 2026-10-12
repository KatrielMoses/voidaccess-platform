ALTER TABLE "investigations" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "execution_id" text;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "spec_token_hash" text;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "spec_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "spec_token_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "last_event_at" timestamp with time zone;