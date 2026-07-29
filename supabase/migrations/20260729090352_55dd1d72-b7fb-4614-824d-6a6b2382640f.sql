CREATE OR REPLACE FUNCTION public.invoke_billing_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  cfg record;
BEGIN
  SELECT enabled, base_url, secret INTO cfg
    FROM public.job_runner_settings WHERE id = 1;
  IF cfg IS NULL OR NOT cfg.enabled OR COALESCE(btrim(cfg.base_url), '') = '' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'net' AND p.proname = 'http_post'
  ) THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := rtrim(cfg.base_url, '/') || '/api/public/billing-cron',
    body := jsonb_build_object('leadDays', 3),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-billing-cron-secret', cfg.secret
    ),
    timeout_milliseconds := 25000
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$fn$;

REVOKE ALL ON FUNCTION public.invoke_billing_cron() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_billing_cron() TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron niedostepny - billing-cron nie zostanie zaplanowany.';
    RETURN;
  END IF;
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron nie jest zainstalowany - billing-cron nie zostanie zaplanowany.';
    RETURN;
  END IF;
  PERFORM cron.schedule('billing-reminders', '10 7 * * *', 'SELECT public.invoke_billing_cron()');
END $$;