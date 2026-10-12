-- H1-1: split the app's login from the system login.
--   va_app    : user-facing work only (withUser). After this migration it is a member of NO role, so it can
--               no longer `SET ROLE va_system`.
--   va_worker : the login for system work (withSystem, Better Auth). It inherits va_system (policies + table
--               grants), so it owns no privileges of its own. Created NOLOGIN; ops/harness sets LOGIN PASSWORD.
--   va_system : unchanged, still NOLOGIN, still the role the system policies are written for.
-- Idempotent and safe on a live database: no data is touched.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'va_worker') THEN
    CREATE ROLE va_worker NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$;
--> statement-breakpoint
REVOKE va_system FROM va_app;
--> statement-breakpoint
GRANT va_system TO va_worker WITH INHERIT TRUE, SET TRUE;
--> statement-breakpoint
-- H1-1 (tamper-proof tenant context). `app.user_id` alone is a plain GUC that any statement run as va_app can
-- overwrite (select set_config('app.user_id', '<victim>', true)), which would defeat every own_rows policy for
-- an SQL-injection attacker. withUser now also sets `app.user_sig` = HMAC-SHA256(key, user id), and
-- app_user_id() only returns the id when the signature verifies against a key that lives in a table nobody but
-- the owner can read (the function is SECURITY DEFINER). The app holds the same key in RLS_CONTEXT_KEY, which
-- an injected query cannot read. No key installed = app_user_id() is NULL = nothing matches (fail closed).
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TABLE app_ctx_key (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  key text NOT NULL CHECK (length(key) >= 32),
  rotated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE app_ctx_key ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- default privileges gave va_system ALL on new tables, and va_worker inherits it: take it back.
REVOKE ALL ON app_ctx_key FROM PUBLIC, va_app, va_system, va_worker;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  uid text := nullif(current_setting('app.user_id', true), '');
  sig text := nullif(current_setting('app.user_sig', true), '');
  k text;
BEGIN
  IF uid IS NULL OR sig IS NULL THEN RETURN NULL; END IF;
  SELECT key INTO k FROM app_ctx_key;
  IF k IS NULL THEN RETURN NULL; END IF;
  IF sig = encode(hmac(lower(uid), k, 'sha256'), 'hex') THEN RETURN uid::uuid; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_user_id() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_user_id() TO va_app, va_system;
