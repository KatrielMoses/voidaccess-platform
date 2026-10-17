-- P8 live view: contract v2 trace events are stored in run_events (type 'trace', kind + data jsonb), sharing the
-- run's seq space so SSE resume (Last-Event-ID), RLS (own_rows, SELECT-only for va_app) and ON DELETE CASCADE
-- with the investigation apply unchanged. Per-run caps are enforced by the callback handler.
ALTER TABLE "run_events" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "run_events" ADD COLUMN "data" jsonb;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_trace_check" CHECK (("run_events"."type" = 'trace') = ("run_events"."kind" IS NOT NULL AND "run_events"."data" IS NOT NULL));