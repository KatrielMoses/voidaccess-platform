-- Roles. va_app = what the running app connects as (subject to RLS, not owner, no BYPASSRLS).
-- va_system = reached only through SET LOCAL ROLE inside withSystem(); va_app is a member WITHOUT inherit,
-- so system policies never apply to a plain va_app session. Passwords/LOGIN are set by ops (or the test harness).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'va_app') THEN CREATE ROLE va_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'va_system') THEN CREATE ROLE va_system NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE; END IF;
END $$;
--> statement-breakpoint
GRANT va_system TO va_app WITH INHERIT FALSE, SET TRUE;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO va_app, va_system;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
--> statement-breakpoint
GRANT ALL ON ALL TABLES IN SCHEMA public TO va_system;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO va_system;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON credit_ledger FROM va_system;
--> statement-breakpoint
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_user_id() TO va_app, va_system;
--> statement-breakpoint
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON sessions AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON accounts AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE investigations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON investigations AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE run_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON run_events AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE inv_entities ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON inv_entities AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE inv_relationships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON inv_relationships AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE inv_actors ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON inv_actors AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE inv_sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON inv_sources AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE inv_summary ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON inv_summary AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE inv_exports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON inv_exports AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON credit_ledger AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE topup_lots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON topup_lots AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON subscriptions AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON payments AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE founding_notices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON founding_notices AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE verifications ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON verifications AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON events AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE abuse_flags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON abuse_flags AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON audit_log AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE run_costs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON run_costs AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE credential_vault ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON credential_vault AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON users AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE founding_seats ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY system_all ON founding_seats AS PERMISSIVE FOR ALL TO va_system USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY own_rows ON sessions AS PERMISSIVE FOR ALL TO va_app USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY own_rows ON accounts AS PERMISSIVE FOR ALL TO va_app USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY own_rows ON investigations AS PERMISSIVE FOR ALL TO va_app USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY own_rows ON run_events AS PERMISSIVE FOR ALL TO va_app USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY own_rows ON inv_entities AS PERMISSIVE FOR ALL TO va_app USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY own_rows ON inv_relationships AS PERMISSIVE FOR ALL TO va_app USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY own_rows ON inv_actors AS PERMISSIVE FOR ALL TO va_app USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY own_rows ON inv_sources AS PERMISSIVE FOR ALL TO va_app USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY own_rows ON inv_summary AS PERMISSIVE FOR ALL TO va_app USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY own_rows ON inv_exports AS PERMISSIVE FOR ALL TO va_app USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY own_rows ON credit_ledger AS PERMISSIVE FOR ALL TO va_app USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY own_rows ON topup_lots AS PERMISSIVE FOR ALL TO va_app USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY own_rows ON subscriptions AS PERMISSIVE FOR ALL TO va_app USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY own_rows ON payments AS PERMISSIVE FOR ALL TO va_app USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY own_rows ON founding_notices AS PERMISSIVE FOR ALL TO va_app USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY own_row ON users AS PERMISSIVE FOR ALL TO va_app USING (id = app_user_id()) WITH CHECK (id = app_user_id());
--> statement-breakpoint
CREATE POLICY own_seat ON founding_seats AS PERMISSIVE FOR SELECT TO va_app USING (holder_user_id = app_user_id());
--> statement-breakpoint
DROP POLICY own_rows ON credit_ledger;
--> statement-breakpoint
CREATE POLICY own_read ON credit_ledger AS PERMISSIVE FOR SELECT TO va_app USING (user_id = app_user_id());
--> statement-breakpoint
CREATE POLICY own_reserve ON credit_ledger AS PERMISSIVE FOR INSERT TO va_app
  WITH CHECK (user_id = app_user_id() AND reason = 'reserve' AND amount < 0
    AND (investigation_id IS NULL OR EXISTS (SELECT 1 FROM investigations i WHERE i.id = investigation_id)));
--> statement-breakpoint
GRANT SELECT ON users TO va_app;
--> statement-breakpoint
GRANT UPDATE (name, image, profile_role, profile_use_case, aup_accepted_at) ON users TO va_app;
--> statement-breakpoint
GRANT SELECT ON sessions TO va_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON investigations TO va_app;
--> statement-breakpoint
GRANT SELECT ON run_events, inv_entities, inv_relationships, inv_actors, inv_sources, inv_summary, inv_exports TO va_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON credit_ledger TO va_app;
--> statement-breakpoint
GRANT SELECT ON topup_lots, subscriptions, payments, founding_seats, founding_notices TO va_app;
--> statement-breakpoint
GRANT SELECT ON archive_entities, archive_sources, archive_observations, archive_relationships, archive_aliases TO va_app;
--> statement-breakpoint
CREATE VIEW credit_balances WITH (security_invoker = true) AS
SELECT u.id AS user_id,
  COALESCE(SUM(l.amount) FILTER (WHERE l.bucket = 'grant'), 0)::int AS grant_balance,
  COALESCE(SUM(l.amount) FILTER (WHERE l.bucket = 'topup'), 0)::int AS topup_balance,
  COALESCE(SUM(l.amount), 0)::int AS total
FROM users u LEFT JOIN credit_ledger l ON l.user_id = u.id
GROUP BY u.id;
--> statement-breakpoint
GRANT SELECT ON credit_balances TO va_app, va_system;
--> statement-breakpoint
CREATE FUNCTION credit_ledger_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE bal integer;
BEGIN
  -- serialise all balance-affecting writes per user; this lock is what makes parallel reserves safe
  PERFORM pg_advisory_xact_lock(hashtextextended('credits:' || NEW.user_id::text, 0));
  IF NEW.bucket = 'grant' THEN
    SELECT COALESCE(SUM(amount), 0) INTO bal FROM credit_ledger WHERE user_id = NEW.user_id AND bucket = 'grant';
    IF bal + NEW.amount < 0 THEN
      RAISE EXCEPTION 'insufficient_credits: grant bucket would go negative' USING ERRCODE = '23514';
    END IF;
  ELSE
    -- topup_lots has CHECK (remaining >= 0 AND remaining <= credits_initial)
    UPDATE topup_lots SET remaining = remaining + NEW.amount WHERE id = NEW.lot_id AND user_id = NEW.user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'unknown lot for ledger row' USING ERRCODE = '23503'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER credit_ledger_guard BEFORE INSERT ON credit_ledger FOR EACH ROW EXECUTE FUNCTION credit_ledger_guard();
--> statement-breakpoint
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% on % is not allowed (append-only / immutable)', TG_OP, TG_TABLE_NAME USING ERRCODE = '55000'; END $$;
--> statement-breakpoint
CREATE TRIGGER credit_ledger_append_only BEFORE UPDATE OR DELETE ON credit_ledger FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER credit_ledger_no_truncate BEFORE TRUNCATE ON credit_ledger FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER inv_entities_immutable BEFORE UPDATE ON inv_entities FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER inv_relationships_immutable BEFORE UPDATE ON inv_relationships FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER inv_actors_immutable BEFORE UPDATE ON inv_actors FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER inv_sources_immutable BEFORE UPDATE ON inv_sources FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER inv_summary_immutable BEFORE UPDATE ON inv_summary FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER inv_exports_immutable BEFORE UPDATE ON inv_exports FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
--> statement-breakpoint
INSERT INTO founding_seats (seat_no) SELECT generate_series(1, 100);
--> statement-breakpoint
CREATE FUNCTION founding_seats_available() RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT count(*)::int FROM founding_seats WHERE holder_user_id IS NULL $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION founding_seats_available() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION founding_seats_available() TO va_app, va_system;
