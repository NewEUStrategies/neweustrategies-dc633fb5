ALTER TABLE public.job_runner_settings
  ADD COLUMN IF NOT EXISTS community_last_tick_at timestamptz,
  ADD COLUMN IF NOT EXISTS community_last_tick_status text,
  ADD COLUMN IF NOT EXISTS community_last_tick_error text,
  ADD COLUMN IF NOT EXISTS community_tick_count bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.job_runner_settings.community_last_tick_at IS
  'Ostatnia proba pukniecia community-cron z pg_cron (takze pominieta - patrz status).';
COMMENT ON COLUMN public.job_runner_settings.community_last_tick_status IS
  'Wynik ostatniej proby: dispatched | skipped | error.';
COMMENT ON COLUMN public.job_runner_settings.community_last_tick_error IS
  'Powod pominiecia/bledu: disabled | no_secret | no_base_url | pg_net_unavailable | SQLERRM.';
COMMENT ON COLUMN public.job_runner_settings.community_tick_count IS
  'Licznik wystrzelonych pukniec community-cron (tylko dispatched).';

CREATE OR REPLACE FUNCTION public.job_runner_autoarm()
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  cfg record;
  v_url text;
BEGIN
  SELECT enabled, base_url, auto_armed_at INTO cfg
    FROM public.job_runner_settings WHERE id = 1;
  IF cfg IS NULL
     OR cfg.auto_armed_at IS NOT NULL
     OR cfg.enabled
     OR COALESCE(btrim(cfg.base_url), '') <> ''
  THEN
    RETURN false;
  END IF;

  v_url := public.job_runner_base_url();
  IF v_url IS NULL OR length(v_url) <= 8 THEN
    RETURN false;
  END IF;

  UPDATE public.job_runner_settings
     SET enabled = true,
         base_url = v_url,
         auto_armed_at = now()
   WHERE id = 1 AND auto_armed_at IS NULL;
  IF FOUND THEN
    RAISE NOTICE 'job runner uzbrojony automatycznie: %', v_url;
  END IF;
  RETURN FOUND;
END;
$fn$;

COMMENT ON FUNCTION public.job_runner_autoarm() IS
  'Jednorazowe samozbrojenie dziewiczego wiersza job_runner_settings; wspolne dla invoke_jobs_tick i invoke_community_cron.';

REVOKE ALL ON FUNCTION public.job_runner_autoarm() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_runner_autoarm() TO service_role;

CREATE OR REPLACE FUNCTION public.invoke_jobs_tick()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  cfg record;
  v_url text;
BEGIN
  PERFORM public.job_runner_autoarm();

  SELECT enabled, base_url, secret, auto_armed_at INTO cfg
    FROM public.job_runner_settings WHERE id = 1;
  IF cfg IS NULL THEN
    RETURN;
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

CREATE OR REPLACE FUNCTION public.invoke_community_cron(p_job text DEFAULT 'all')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  cfg record;
  v_url text;
  v_job text := CASE
    WHEN p_job IN ('all', 'push', 'digest-daily', 'digest-weekly',
                   'event-reminders', 'crm-task-reminders')
    THEN p_job
    ELSE 'all'
  END;
BEGIN
  PERFORM public.job_runner_autoarm();

  SELECT enabled, secret INTO cfg
    FROM public.job_runner_settings WHERE id = 1;
  IF cfg IS NULL THEN
    RETURN;
  END IF;

  IF NOT cfg.enabled THEN
    UPDATE public.job_runner_settings
       SET community_last_tick_at = now(),
           community_last_tick_status = 'skipped',
           community_last_tick_error = 'disabled'
     WHERE id = 1;
    RETURN;
  END IF;

  IF COALESCE(cfg.secret, '') = '' THEN
    UPDATE public.job_runner_settings
       SET community_last_tick_at = now(),
           community_last_tick_status = 'skipped',
           community_last_tick_error = 'no_secret'
     WHERE id = 1;
    RETURN;
  END IF;

  v_url := public.job_runner_base_url();
  IF COALESCE(btrim(v_url), '') = '' THEN
    UPDATE public.job_runner_settings
       SET community_last_tick_at = now(),
           community_last_tick_status = 'skipped',
           community_last_tick_error = 'no_base_url'
     WHERE id = 1;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'net' AND p.proname = 'http_post'
  ) THEN
    UPDATE public.job_runner_settings
       SET community_last_tick_at = now(),
           community_last_tick_status = 'skipped',
           community_last_tick_error = 'pg_net_unavailable'
     WHERE id = 1;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/api/public/community-cron?job=' || v_job,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-community-cron-secret', cfg.secret,
      'x-cron-source', 'pg_cron'
    ),
    timeout_milliseconds := 30000
  );

  UPDATE public.job_runner_settings
     SET community_last_tick_at = now(),
         community_last_tick_status = 'dispatched',
         community_last_tick_error = NULL,
         community_tick_count = community_tick_count + 1
   WHERE id = 1;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    UPDATE public.job_runner_settings
       SET community_last_tick_at = now(),
           community_last_tick_status = 'error',
           community_last_tick_error = left(SQLERRM, 500)
     WHERE id = 1;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$fn$;

COMMENT ON FUNCTION public.invoke_community_cron(text) IS
  'Pukniecie pg_cron do /api/public/community-cron (push/digesty/przypomnienia); telemetria w job_runner_settings.community_last_tick_*.';

REVOKE ALL ON FUNCTION public.invoke_community_cron(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_community_cron(text) TO service_role;

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
  v_last_stamp timestamptz;
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
         community_last_tick_at, community_last_tick_status,
         community_last_tick_error, community_tick_count,
         COALESCE(secret, '') <> '' AS secret_set
    INTO cfg
    FROM public.job_runner_settings WHERE id = 1;

  v_last_ping := GREATEST(
    CASE WHEN cfg.last_tick_status = 'dispatched'
         THEN COALESCE(cfg.last_invoked_at, cfg.last_tick_at) END,
    CASE WHEN cfg.community_last_tick_status = 'dispatched'
         THEN cfg.community_last_tick_at END
  );
  v_last_stamp := GREATEST(cfg.last_invoked_at, cfg.last_tick_at, cfg.community_last_tick_at);

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
      'last_invoked_at', v_last_stamp,
      'last_app_run_at', cfg.last_app_run_at,
      'last_app_ok_at', cfg.last_app_ok_at,
      'last_app_error', cfg.last_app_error,
      'failure_streak', COALESCE(cfg.failure_streak, 0),
      'last_tick_status', cfg.last_tick_status,
      'last_tick_error', cfg.last_tick_error,
      'tick_count', COALESCE(cfg.tick_count, 0),
      'community_cron', jsonb_build_object(
        'last_tick_at', cfg.community_last_tick_at,
        'last_tick_status', cfg.community_last_tick_status,
        'last_tick_error', cfg.community_last_tick_error,
        'tick_count', COALESCE(cfg.community_tick_count, 0)
      )
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
DECLARE
  v_job record;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron niedostepny - community-cron pominiety.';
    RETURN;
  END IF;

  PERFORM cron.schedule('community-cron', '2-59/5 * * * *', 'SELECT public.invoke_community_cron()');

  FOR v_job IN
    EXECUTE $q$
      SELECT jobid, jobname FROM cron.job
       WHERE jobname = 'community-cron' AND NOT active
    $q$
  LOOP
    BEGIN
      EXECUTE format('SELECT cron.alter_job(%s, active := true)', v_job.jobid);
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        EXECUTE format('UPDATE cron.job SET active = true WHERE jobid = %s', v_job.jobid);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'nie udalo sie reaktywowac %: %', v_job.jobname, SQLERRM;
      END;
    END;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'harmonogram pg_cron: % (fail-open)', SQLERRM;
END $$;