ALTER TABLE public.job_runner_settings
  ADD COLUMN IF NOT EXISTS last_invoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_armed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_app_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_app_ok_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_app_error text,
  ADD COLUMN IF NOT EXISTS failure_streak integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.job_runner_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL
    CHECK (source IN ('pg_cron', 'github_actions', 'external', 'admin', 'dev')),
  job text NOT NULL DEFAULT 'all',
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  actor_id uuid,
  ok boolean NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0,
  result jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS job_runner_runs_recent_idx
  ON public.job_runner_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS job_runner_runs_source_recent_idx
  ON public.job_runner_runs (source, created_at DESC);
CREATE INDEX IF NOT EXISTS job_runner_runs_failures_idx
  ON public.job_runner_runs (created_at DESC) WHERE NOT ok;

ALTER TABLE public.job_runner_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.job_runner_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.job_runner_runs TO service_role;

CREATE OR REPLACE FUNCTION public.job_runner_base_url()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  WITH candidate AS (
    SELECT COALESCE(
      NULLIF(rtrim(btrim((SELECT s.base_url FROM public.job_runner_settings s WHERE s.id = 1)), '/'), ''),
      (SELECT 'https://' || lower(btrim(t.domain)) FROM public.tenants t
        WHERE t.is_default AND COALESCE(btrim(t.domain), '') <> '' LIMIT 1),
      (SELECT 'https://' || lower(btrim(t.domain)) FROM public.tenants t
        WHERE COALESCE(btrim(t.domain), '') <> ''
          AND (SELECT count(*) FROM public.tenants) = 1 LIMIT 1)
    ) AS url
  )
  SELECT CASE
           WHEN url IS NULL THEN NULL
           WHEN url ~* '^https?://(localhost|127\.|0\.0\.0\.0|\[)' THEN NULL
           ELSE url
         END
    FROM candidate;
$fn$;

REVOKE ALL ON FUNCTION public.job_runner_base_url() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_runner_base_url() TO service_role;

CREATE OR REPLACE FUNCTION public.resolve_job_runner_base_url()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT public.job_runner_base_url();
$fn$;

REVOKE ALL ON FUNCTION public.resolve_job_runner_base_url() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_job_runner_base_url() TO service_role;

CREATE OR REPLACE FUNCTION public.arm_job_runner(p_base_url text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions
AS $fn$
DECLARE
  v_url text := rtrim(btrim(COALESCE(p_base_url, '')), '/');
  v_armed boolean := false;
BEGIN
  IF v_url !~* '^https://[a-z0-9.-]+(:[0-9]+)?$'
     OR v_url ~* '^https://(localhost|127\.|0\.0\.0\.0|\[)'
  THEN
    RETURN jsonb_build_object('armed', false, 'reason', 'invalid_base_url');
  END IF;

  UPDATE public.job_runner_settings
     SET enabled = true,
         base_url = v_url,
         secret = CASE
                    WHEN COALESCE(secret, '') = '' THEN encode(gen_random_bytes(24), 'hex')
                    ELSE secret
                  END,
         auto_armed_at = now()
   WHERE id = 1
     AND auto_armed_at IS NULL
     AND NOT enabled
     AND COALESCE(btrim(base_url), '') = '';

  v_armed := FOUND;
  RETURN jsonb_build_object(
    'armed', v_armed,
    'reason', CASE WHEN v_armed THEN 'armed' ELSE 'already_configured' END,
    'base_url', (SELECT base_url FROM public.job_runner_settings WHERE id = 1)
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.arm_job_runner(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arm_job_runner(text) TO service_role;

CREATE OR REPLACE FUNCTION public.record_job_run(
  p_source text,
  p_job text DEFAULT 'all',
  p_ok boolean DEFAULT true,
  p_duration_ms integer DEFAULT 0,
  p_result jsonb DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_tenant_id uuid DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_source text := CASE
    WHEN p_source IN ('pg_cron', 'github_actions', 'external', 'admin', 'dev') THEN p_source
    ELSE 'external'
  END;
  v_id bigint;
BEGIN
  INSERT INTO public.job_runner_runs
    (source, job, tenant_id, actor_id, ok, duration_ms, result, error)
  VALUES (
    v_source,
    COALESCE(NULLIF(btrim(p_job), ''), 'all'),
    p_tenant_id,
    p_actor_id,
    COALESCE(p_ok, false),
    GREATEST(0, COALESCE(p_duration_ms, 0)),
    p_result,
    left(NULLIF(btrim(COALESCE(p_error, '')), ''), 2000)
  )
  RETURNING id INTO v_id;

  UPDATE public.job_runner_settings
     SET last_app_run_at = now(),
         last_app_ok_at = CASE WHEN COALESCE(p_ok, false) THEN now() ELSE last_app_ok_at END,
         last_app_error = CASE
                            WHEN COALESCE(p_ok, false) THEN NULL
                            ELSE left(NULLIF(btrim(COALESCE(p_error, '')), ''), 2000)
                          END,
         failure_streak = CASE WHEN COALESCE(p_ok, false) THEN 0 ELSE failure_streak + 1 END
   WHERE id = 1;

  IF (v_id % 250) = 0 THEN
    DELETE FROM public.job_runner_runs WHERE created_at < now() - interval '14 days';
  END IF;

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.record_job_run(text, text, boolean, integer, jsonb, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_job_run(text, text, boolean, integer, jsonb, text, uuid, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_jobs_tick()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  cfg record;
  v_url text;
BEGIN
  SELECT enabled, base_url, secret, auto_armed_at INTO cfg
    FROM public.job_runner_settings WHERE id = 1;
  IF cfg IS NULL THEN
    RETURN;
  END IF;

  IF cfg.auto_armed_at IS NULL
     AND NOT cfg.enabled
     AND COALESCE(btrim(cfg.base_url), '') = ''
  THEN
    v_url := public.job_runner_base_url();
    IF v_url IS NOT NULL AND length(v_url) > 8 THEN
      UPDATE public.job_runner_settings
         SET enabled = true,
             base_url = v_url,
             auto_armed_at = now()
       WHERE id = 1 AND auto_armed_at IS NULL;
      SELECT enabled, base_url, secret, auto_armed_at INTO cfg
        FROM public.job_runner_settings WHERE id = 1;
    END IF;
  END IF;

  IF NOT cfg.enabled THEN
    UPDATE public.job_runner_settings
       SET last_tick_at = now(), last_tick_status = 'skipped', last_tick_error = 'disabled'
     WHERE id = 1;
    RETURN;
  END IF;

  IF COALESCE(cfg.secret, '') = '' THEN
    UPDATE public.job_runner_settings
       SET last_tick_at = now(), last_tick_status = 'skipped', last_tick_error = 'no_secret'
     WHERE id = 1;
    RETURN;
  END IF;

  v_url := public.job_runner_base_url();
  IF COALESCE(btrim(v_url), '') = '' THEN
    UPDATE public.job_runner_settings
       SET last_tick_at = now(), last_tick_status = 'skipped', last_tick_error = 'no_base_url'
     WHERE id = 1;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'net' AND p.proname = 'http_post'
  ) THEN
    UPDATE public.job_runner_settings
       SET last_tick_at = now(), last_tick_status = 'skipped', last_tick_error = 'pg_net_unavailable'
     WHERE id = 1;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/api/public/jobs-tick',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-jobs-secret', cfg.secret,
      'x-cron-source', 'pg_cron'
    ),
    timeout_milliseconds := 25000
  );

  UPDATE public.job_runner_settings
     SET last_invoked_at = now(),
         last_tick_at = now(),
         last_tick_status = 'dispatched',
         last_tick_error = NULL,
         tick_count = tick_count + 1
   WHERE id = 1;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    UPDATE public.job_runner_settings
       SET last_tick_at = now(), last_tick_status = 'error', last_tick_error = left(SQLERRM, 500)
     WHERE id = 1;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$fn$;

REVOKE ALL ON FUNCTION public.invoke_jobs_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_jobs_tick() TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_billing_cron()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  cfg record;
  v_url text;
BEGIN
  SELECT enabled, secret INTO cfg FROM public.job_runner_settings WHERE id = 1;
  IF cfg IS NULL OR NOT cfg.enabled OR COALESCE(cfg.secret, '') = '' THEN
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
      'x-billing-cron-secret', cfg.secret,
      'x-cron-source', 'pg_cron'
    ),
    timeout_milliseconds := 25000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'invoke_billing_cron: %', SQLERRM;
END;
$fn$;

REVOKE ALL ON FUNCTION public.invoke_billing_cron() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_billing_cron() TO service_role;

CREATE OR REPLACE FUNCTION public.job_scheduler_health()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  cfg record;
  v_cron jsonb := '[]'::jsonb;
  v_runs jsonb := '[]'::jsonb;
  v_sources jsonb := '[]'::jsonb;
  v_last_ping timestamptz;
  v_last_pg_cron_run timestamptz;
BEGIN
  IF v_uid IS NULL OR NOT (
       public.has_role(v_uid, 'admin')
    OR public.has_role(v_uid, 'super_admin')
    OR public.has_role(v_uid, 'editor')
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT enabled, base_url, auto_armed_at, last_invoked_at, last_app_run_at,
         last_app_ok_at, last_app_error, failure_streak,
         last_tick_at, last_tick_status, last_tick_error, tick_count,
         COALESCE(secret, '') <> '' AS secret_set
    INTO cfg
    FROM public.job_runner_settings WHERE id = 1;

  v_last_ping := GREATEST(
    COALESCE(cfg.last_invoked_at, cfg.last_tick_at),
    COALESCE(cfg.last_tick_at, cfg.last_invoked_at)
  );

  SELECT max(created_at) INTO v_last_pg_cron_run
    FROM public.job_runner_runs WHERE source = 'pg_cron';

  IF to_regclass('cron.job') IS NOT NULL THEN
    BEGIN
      EXECUTE $q$
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'name', j.jobname,
                 'schedule', j.schedule,
                 'active', j.active
               ) ORDER BY j.jobname), '[]'::jsonb)
          FROM cron.job j
      $q$ INTO v_cron;
    EXCEPTION WHEN OTHERS THEN
      v_cron := '[]'::jsonb;
    END;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', r.id,
           'source', r.source,
           'job', r.job,
           'ok', r.ok,
           'duration_ms', r.duration_ms,
           'error', r.error,
           'result', r.result,
           'created_at', r.created_at
         ) ORDER BY r.id DESC), '[]'::jsonb)
    INTO v_runs
    FROM (
      SELECT * FROM public.job_runner_runs ORDER BY id DESC LIMIT 20
    ) r;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'source', s.source,
           'last_at', s.last_at,
           'last_ok_at', s.last_ok_at,
           'runs_24h', s.runs_24h,
           'failures_24h', s.failures_24h
         ) ORDER BY s.source), '[]'::jsonb)
    INTO v_sources
    FROM (
      SELECT source,
             max(created_at) AS last_at,
             max(created_at) FILTER (WHERE ok) AS last_ok_at,
             count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS runs_24h,
             count(*) FILTER (WHERE created_at > now() - interval '24 hours' AND NOT ok) AS failures_24h
        FROM public.job_runner_runs
       GROUP BY source
    ) s;

  RETURN jsonb_build_object(
    'runner', jsonb_build_object(
      'enabled', COALESCE(cfg.enabled, false),
      'base_url', COALESCE(cfg.base_url, ''),
      'resolved_base_url', COALESCE(public.job_runner_base_url(), ''),
      'secret_set', COALESCE(cfg.secret_set, false),
      'auto_armed_at', cfg.auto_armed_at,
      'last_invoked_at', v_last_ping,
      'last_app_run_at', cfg.last_app_run_at,
      'last_app_ok_at', cfg.last_app_ok_at,
      'last_app_error', cfg.last_app_error,
      'failure_streak', COALESCE(cfg.failure_streak, 0),
      'last_tick_status', cfg.last_tick_status,
      'last_tick_error', cfg.last_tick_error,
      'tick_count', COALESCE(cfg.tick_count, 0)
    ),
    'capabilities', jsonb_build_object(
      'pg_cron', to_regclass('cron.job') IS NOT NULL,
      'pg_net', EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'net' AND p.proname = 'http_post'
      )
    ),
    'app_unreachable', (
      v_last_ping IS NOT NULL
      AND v_last_ping > now() - interval '10 minutes'
      AND cfg.last_tick_status = 'dispatched'
      AND (v_last_pg_cron_run IS NULL OR v_last_pg_cron_run < now() - interval '10 minutes')
    ),
    'cron_jobs', v_cron,
    'recent_runs', v_runs,
    'sources', v_sources,
    'queue', jsonb_build_object(
      'push_pending', (
        SELECT count(*) FROM public.notification_push_queue
         WHERE tenant_id = v_tenant AND status = 'pending'
      ),
      'push_due_now', (
        SELECT count(*) FROM public.notification_push_queue
         WHERE tenant_id = v_tenant AND status = 'pending' AND next_attempt_at <= now()
      ),
      'push_sent_24h', (
        SELECT count(*) FROM public.notification_push_queue
         WHERE tenant_id = v_tenant AND status = 'sent' AND sent_at > now() - interval '24 hours'
      ),
      'push_dead', (
        SELECT count(*) FROM public.notification_push_queue
         WHERE tenant_id = v_tenant AND status = 'dead'
      ),
      'push_oldest_pending_seconds', (
        SELECT COALESCE(EXTRACT(EPOCH FROM (now() - min(created_at)))::integer, 0)
          FROM public.notification_push_queue
         WHERE tenant_id = v_tenant AND status = 'pending'
      ),
      'push_subscriptions_active', (
        SELECT count(*) FROM public.push_subscriptions
         WHERE tenant_id = v_tenant AND failed_at IS NULL
      ),
      'digest_due_daily', (
        SELECT count(*) FROM public.notification_preferences np
         WHERE np.tenant_id = v_tenant AND np.email_digest = 'daily'
           AND (np.digest_last_sent_at IS NULL
                OR np.digest_last_sent_at < now() - interval '20 hours')
      ),
      'digest_due_weekly', (
        SELECT count(*) FROM public.notification_preferences np
         WHERE np.tenant_id = v_tenant AND np.email_digest = 'weekly'
           AND (np.digest_last_sent_at IS NULL
                OR np.digest_last_sent_at < now() - interval '6 days')
      )
    )
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.job_scheduler_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_scheduler_health() TO authenticated, service_role;

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron niedostepny';
    RETURN;
  END IF;
  PERFORM cron.schedule('jobs-tick', '* * * * *', 'SELECT public.invoke_jobs_tick()');
  PERFORM cron.schedule('billing-cron-daily', '25 4 * * *', 'SELECT public.invoke_billing_cron()');
  PERFORM cron.schedule(
    'prune-job-runner-runs',
    '40 3 * * *',
    $sql$DELETE FROM public.job_runner_runs WHERE created_at < now() - interval '14 days'$sql$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'harmonogram pg_cron: % (fail-open)', SQLERRM;
END $$;