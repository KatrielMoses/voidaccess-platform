ALTER TABLE "run_events" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_status_check" CHECK ("run_events"."status" IS NULL OR "run_events"."status" IN ('start', 'end', 'skipped', 'failed'));
--> statement-breakpoint
-- H1-4 data migration: stage events used to be stored as type `stage` (start) or `stage_<status>`. They are now
-- type `stage` + status. Idempotent: after the first run no row has a `stage_*` type or a NULL stage status.
UPDATE run_events
SET type = 'stage',
    status = CASE type WHEN 'stage_end' THEN 'end' WHEN 'stage_skipped' THEN 'skipped' ELSE 'failed' END
WHERE type IN ('stage_end', 'stage_skipped', 'stage_failed');
--> statement-breakpoint
UPDATE run_events SET status = 'start' WHERE type = 'stage' AND status IS NULL;
