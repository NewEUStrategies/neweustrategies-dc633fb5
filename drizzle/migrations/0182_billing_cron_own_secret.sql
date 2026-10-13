ALTER TABLE public.job_runner_settings
  ADD COLUMN IF NOT EXISTS billing_secret text NOT NULL
    DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

COMMENT ON COLUMN public.job_runner_settings.billing_secret IS
  'Sekret pg_cron -> /api/public/billing-cron (x-billing-cron-secret). WYLACZNIE service_role; rozny od secret (sekretu runnera, ktory otwiera community-cron i jobs-tick).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.job_runner_settings'::regclass
       AND conname = 'job_runner_settings_billing_secret_own'
  ) THEN
    ALTER TABLE public.job_runner_settings
      ADD CONSTRAINT job_runner_settings_billing_secret_own
      CHECK (length(billing_secret) >= 32 AND billing_secret <> secret);
  END IF;
END $$;

REVOKE ALL ON public.job_runner_settings FROM PUBLIC, anon, authenticated;
REVOKE ALL (billing_secret) ON public.job_runner_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.job_runner_settings TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_billing_cron()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  cfg record;
  v_url text;
BEGIN
  SELECT enabled, billing_secret INTO cfg FROM public.job_runner_settings WHERE id = 1;
  IF cfg IS NULL OR NOT cfg.enabled OR COALESCE(cfg.billing_secret, '') = '' THEN
    RETURN;
  END IF;
  v_url := public.job_runner_base_url();
  IF COALESCE(btrim(v_url), '') = '' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'net' AND p.proname = 'http_post'
  ) THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/api/public/billing-cron',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-billing-cron-secret', cfg.billing_secret,
      'x-cron-source', 'pg_cron'
    ),
    timeout_milliseconds := 60000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'invoke_billing_cron: %', SQLERRM;
END;
$fn$;

REVOKE ALL ON FUNCTION public.invoke_billing_cron() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_billing_cron() TO service_role;