-- 1. Uruchomienie harmonogramu zadań tła (push, digesty, przypomnienia, billing)
UPDATE public.job_runner_settings
SET enabled = true,
    base_url = 'https://neweuropeanstrategies.com',
    secret = CASE
      WHEN COALESCE(btrim(secret), '') = '' THEN encode(extensions.gen_random_bytes(32), 'hex')
      ELSE secret
    END
WHERE id = 1;

INSERT INTO public.job_runner_settings (id, enabled, base_url, secret)
SELECT 1, true, 'https://neweuropeanstrategies.com', encode(extensions.gen_random_bytes(32), 'hex')
WHERE NOT EXISTS (SELECT 1 FROM public.job_runner_settings WHERE id = 1);

-- 2. Funkcja pukająca po HTTP do ticku zadań tła
CREATE OR REPLACE FUNCTION public.invoke_jobs_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cfg record;
BEGIN
  SELECT enabled, base_url, secret INTO cfg
    FROM public.job_runner_settings WHERE id = 1;
  IF cfg IS NULL OR NOT cfg.enabled
     OR COALESCE(btrim(cfg.base_url), '') = ''
     OR COALESCE(btrim(cfg.secret), '') = '' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'net' AND p.proname = 'http_post'
  ) THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := rtrim(cfg.base_url, '/') || '/api/public/jobs-tick',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-jobs-secret', cfg.secret
    ),
    timeout_milliseconds := 25000
  );
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.invoke_jobs_tick() FROM PUBLIC, anon, authenticated;

-- 3. Harmonogram: tick co minutę
SELECT cron.unschedule('jobs-tick') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jobs-tick');
SELECT cron.schedule('jobs-tick', '* * * * *', $$SELECT public.invoke_jobs_tick()$$);