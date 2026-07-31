-- ============================================================================
-- Pojednanie DWÓCH równoległych telemetrii runnera zadań tła.
--
-- Dwie zmiany weszły niezależnie tego samego dnia i obie przepisały
-- public.invoke_jobs_tick():
--
--   * 20260731110000 (harmonogram doręczeń): SAMOZBROJENIE dziewiczego wiersza
--     konfiguracji, stempel `last_invoked_at` i nagłówek `x-cron-source`
--     (dzięki niemu przebieg loguje się jako 'pg_cron', a nie 'external').
--   * 20260731081100 + 20260731120000 (poczta): telemetria
--     `last_tick_at` / `last_tick_status` / `last_tick_error` / `tick_count`
--     z jawnymi powodami pominięcia oraz resolver `job_runner_base_url()`.
--
-- Migracje są forward-only, więc wygrała OSTATNIA - i wraz z nią wróciła
-- pierwotna awaria: bez samozbrojenia dziewiczy wiersz zostaje
-- `enabled=false`, `invoke_jobs_tick()` wychodzi w pierwszym IF-ie, kolejka
-- push znowu stoi. Jednocześnie zniknął `last_invoked_at`, czyli lewa strona
-- diagnozy „cron puka, aplikacja nie odpowiada".
--
-- Ta migracja składa JEDNĄ funkcję z obu wkładów i domyka rozjazd:
--
--   1. `job_runner_base_url()` - kanoniczny resolver (jeden), utwardzony o
--      odrzucanie hostów lokalnych: cron bazy produkcyjnej nie ma po co pukać
--      do `localhost`, a przy takim adresie panel pokazywał „skonfigurowany".
--   2. `resolve_job_runner_base_url()` - alias delegujący (bez własnej logiki),
--      żeby dwie nazwy nigdy nie rozjechały się w zachowaniu.
--   3. `invoke_jobs_tick()` - samozbrojenie + telemetria + `last_invoked_at` +
--      `x-cron-source`. Stan „wyłączony" też stempluje status (`disabled`),
--      więc panel odpowiada, DLACZEGO nie ma ticku, zamiast milczeć.
--   4. `invoke_billing_cron()` - ten sam resolver co tick (był na surowym
--      `base_url`, więc przy pustej kolumnie nie ruszał, mimo działającego crona).
--   5. `job_scheduler_health()` - dorzuca telemetrię crona do sekcji `runner`
--      (status/powód/licznik), a `app_unreachable` liczy z `last_invoked_at`
--      LUB `last_tick_at` (wiersze sprzed pojednania mają tylko jedno z nich)
--      i porównuje je z ostatnim przebiegiem ZE ŹRÓDŁA 'pg_cron', nie z
--      globalnym heartbeatem: ten stempluje każde źródło, więc scheduler repo
--      maskowałby martwą ścieżkę podstawową.
--
-- Idempotentne. Bez pg_cron/pg_net wszystko jest fail-open.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Kanoniczny resolver adresu (utwardzony o hosty lokalne)
-- ----------------------------------------------------------------------------
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
  -- Host lokalny to nie adres publiczny: pg_net w projekcie Supabase i tak go
  -- nie dosięgnie, a niepusta wartość udawała w panelu poprawną konfigurację.
  SELECT CASE
           WHEN url IS NULL THEN NULL
           WHEN url ~* '^https?://(localhost|127\.|0\.0\.0\.0|\[)' THEN NULL
           ELSE url
         END
    FROM candidate;
$fn$;

REVOKE ALL ON FUNCTION public.job_runner_base_url() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_runner_base_url() TO service_role;

-- Alias bez własnej logiki - dwie nazwy, jedno zachowanie.
CREATE OR REPLACE FUNCTION public.resolve_job_runner_base_url()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT public.job_runner_base_url();
$fn$;

REVOKE ALL ON FUNCTION public.resolve_job_runner_base_url() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_job_runner_base_url() TO service_role;

-- ----------------------------------------------------------------------------
-- 2) Jedno puknięcie z crona: samozbrojenie + telemetria + heartbeat
-- ----------------------------------------------------------------------------
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

  -- SAMOZBROJENIE (raz w życiu wiersza): dziewiczy wiersz = domyślny
  -- enabled=false + base_url='' + brak stempla. To nie decyzja operatora, tylko
  -- brak konfiguracji, a jej skutkiem jest martwy harmonogram. Po stemplu
  -- auto_armed_at NIE zbroimy nigdy więcej, więc świadome wyłączenie runnera
  -- zostaje wyłączone.
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
      RAISE NOTICE 'job runner uzbrojony automatycznie: %', v_url;
    END IF;
  END IF;

  -- Wyłączony runner też raportuje POWÓD - inaczej panel pokazuje „brak ticku"
  -- bez wskazania, że to świadome wyłączenie.
  IF NOT cfg.enabled THEN
    UPDATE public.job_runner_settings
       SET last_tick_at = now(),
           last_tick_status = 'skipped',
           last_tick_error = 'disabled'
     WHERE id = 1;
    RETURN;
  END IF;

  IF COALESCE(cfg.secret, '') = '' THEN
    UPDATE public.job_runner_settings
       SET last_tick_at = now(),
           last_tick_status = 'skipped',
           last_tick_error = 'no_secret'
     WHERE id = 1;
    RETURN;
  END IF;

  v_url := public.job_runner_base_url();
  IF COALESCE(btrim(v_url), '') = '' THEN
    UPDATE public.job_runner_settings
       SET last_tick_at = now(),
           last_tick_status = 'skipped',
           last_tick_error = 'no_base_url'
     WHERE id = 1;
    RETURN;
  END IF;

  -- pg_net może nie istnieć (środowiska bez rozszerzenia) - fail-open.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'net' AND p.proname = 'http_post'
  ) THEN
    UPDATE public.job_runner_settings
       SET last_tick_at = now(),
           last_tick_status = 'skipped',
           last_tick_error = 'pg_net_unavailable'
     WHERE id = 1;
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/api/public/jobs-tick',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-jobs-secret', cfg.secret,
      -- Bez tego nagłówka przebieg loguje się jako 'external' i panel twierdzi,
      -- że ścieżka podstawowa (pg_cron) nie żyje.
      'x-cron-source', 'pg_cron'
    ),
    timeout_milliseconds := 25000
  );

  -- Dwa stemple, dwie różne prawdy: `last_invoked_at` mówi „cron wystrzelił
  -- HTTP", `last_app_run_at` (record_job_run) mówi „aplikacja odpowiedziała".
  -- Ich rozjazd to jedyna diagnoza złego adresu/sekretu i leżącego wdrożenia,
  -- bo pg_net jest fire-and-forget.
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
       SET last_tick_at = now(),
           last_tick_status = 'error',
           last_tick_error = left(SQLERRM, 500)
     WHERE id = 1;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$fn$;

REVOKE ALL ON FUNCTION public.invoke_jobs_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_jobs_tick() TO service_role;

-- ----------------------------------------------------------------------------
-- 3) Puknięcie rozliczeń na tym samym resolverze
-- ----------------------------------------------------------------------------
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
  -- Wcześniej czytał surowy base_url, więc przy pustej kolumnie (adres z domeny
  -- tenanta) nie ruszał, mimo że tick doręczeń działał.
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

-- ----------------------------------------------------------------------------
-- 4) Zdrowie harmonogramu: telemetria crona obok heartbeatu aplikacji
-- ----------------------------------------------------------------------------
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

  -- Wiersze sprzed pojednania mają tylko jeden ze stempli puknięcia.
  v_last_ping := GREATEST(
    COALESCE(cfg.last_invoked_at, cfg.last_tick_at),
    COALESCE(cfg.last_tick_at, cfg.last_invoked_at)
  );

  -- Ostatni przebieg WYWOŁANY PRZEZ CRON BAZY, nie dowolny. Heartbeat
  -- `last_app_run_at` stempluje KAŻDE źródło, więc scheduler repo (co 5 min)
  -- albo ręczny tick z panelu utrzymywałby go świeżym także wtedy, gdy pg_cron
  -- puka pod zły adres lub z odrzuconym sekretem - i alert o awarii ścieżki
  -- PODSTAWOWEJ nigdy by nie zapalił.
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
      -- Telemetria SAMEGO crona (kto pukał i z jakim skutkiem) - mówi wprost,
      -- dlaczego puknięcia nie było: disabled / no_secret / no_base_url /
      -- pg_net_unavailable / error.
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

-- ----------------------------------------------------------------------------
-- 5) Rejestr pg_cron (po pojednaniu obie ścieżki mają swoje wpisy)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron niedostępny - harmonogram bazy pominięty (ścieżka repo: scheduler.yml).';
    RETURN;
  END IF;
  PERFORM cron.schedule('jobs-tick', '* * * * *', 'SELECT public.invoke_jobs_tick()');
  PERFORM cron.schedule('billing-cron-daily', '25 4 * * *', 'SELECT public.invoke_billing_cron()');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'harmonogram pg_cron: % (fail-open)', SQLERRM;
END $$;
