-- Performance: evaluate app_user_id() once per statement, not once per row. Since H1 it verifies an HMAC and reads
-- app_ctx_key, so a bare `col = app_user_id()` in a policy can run per row on large scans. Wrapping it as
-- (SELECT app_user_id()) makes Postgres plan it as an InitPlan (one call per statement). Security is unchanged:
-- the same function, the same comparison. Rewrites every policy in public that references app_user_id();
-- idempotent (policies already wrapped are skipped).
DO $$
DECLARE
  p record;
  q text;
  c text;
  stmt text;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (coalesce(qual, '') LIKE '%app_user_id()%' OR coalesce(with_check, '') LIKE '%app_user_id()%')
  LOOP
    q := p.qual;
    c := p.with_check;
    IF q IS NOT NULL AND q NOT LIKE '%SELECT app_user_id()%' THEN
      q := replace(q, 'app_user_id()', '(SELECT app_user_id())');
    END IF;
    IF c IS NOT NULL AND c NOT LIKE '%SELECT app_user_id()%' THEN
      c := replace(c, 'app_user_id()', '(SELECT app_user_id())');
    END IF;
    IF q IS NOT DISTINCT FROM p.qual AND c IS NOT DISTINCT FROM p.with_check THEN
      CONTINUE;
    END IF;
    stmt := format('ALTER POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
    IF q IS NOT NULL THEN stmt := stmt || format(' USING (%s)', q); END IF;
    IF c IS NOT NULL THEN stmt := stmt || format(' WITH CHECK (%s)', c); END IF;
    EXECUTE stmt;
  END LOOP;
END $$;
