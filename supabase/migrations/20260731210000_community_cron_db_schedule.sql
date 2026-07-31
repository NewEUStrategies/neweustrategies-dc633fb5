-- ============================================================================
-- Harmonogram kanałów społeczności: puknięcie z BAZY do community-cron.
--
-- PRZYCZYNA ŹRÓDŁOWA (audyt "Scheduler push + digest", P0): kolejka, konsument
-- i gating są gotowe, ale /api/public/community-cron nie miał ŻADNEGO wołacza
-- po stronie bazy - jedynym harmonogramem był scheduler repo
-- (.github/workflows/scheduler.yml), a GitHub wyłącza zaplanowane workflow po
-- 60 dniach braku aktywności i wymaga pary APP_BASE_URL + COMMUNITY_CRON_SECRET
-- w ustawieniach Actions. Bez niej z repo push i digesty NIE wychodzą, a jedyna
-- pozostała ścieżka (pg_cron -> /jobs-tick) drenuje kanały społeczności dopiero
-- PO newsletterze i drenie poczty w tym samym budżecie 25 s - duża kampania
-- potrafi zagłodzić push do "skipped_time_budget" minuta po minucie.
--
-- Ta migracja domyka lukę wzorem invoke_jobs_tick() (20260731130000):
--
--   1) public.job_runner_autoarm() - WYCIĄGNIĘTE samozbrojenie dziewiczego
--      wiersza konfiguracji. Dotąd żyło inline w invoke_jobs_tick(); drugi
--      wołacz oznaczałby drugą kopię, a dwie równoległe kopie tej logiki to
--      dokładnie klasa awarii, którą 20260731130000 właśnie pojednało. Jedna
--      funkcja, dwóch wołaczy, zero dryfu.
--
--   2) public.invoke_community_cron(p_job) - puknięcie HTTP do
--      /api/public/community-cron z sekretem runnera (endpoint przyjmuje go
--      od zawsze: runnerSecretMatches) i nagłówkiem x-cron-source: pg_cron.
--      Własna telemetria community_last_tick_* na job_runner_settings mówi
--      wprost, DLACZEGO puknięcia nie było (disabled / no_secret / no_base_url
--      / pg_net_unavailable) - ta sama filozofia co telemetria jobs-tick.
--
--   3) invoke_jobs_tick() - bez zmian zachowania; jedynie blok samozbrojenia
--      deleguje do job_runner_autoarm() (punkt 1).
--
--   4) job_scheduler_health() - sekcja runner.community_cron (status/powód/
--      licznik), a alert app_unreachable liczy puknięcia OBU ścieżek bazy:
--      jeśli którakolwiek wystrzeliła HTTP, a żaden przebieg 'pg_cron' nie
--      wrócił w 10 minut, aplikacja jest nieosiągalna.
--
--   5) Wpis pg_cron 'community-cron' co 5 minut z PRZESUNIĘCIEM (minuty
--      2,7,12,...): jobs-tick zagląda do digestów w minutach podzielnych
--      przez 5 (everyNthMinute), więc przesunięte okna przeplatają się
--      zamiast dublować claimy w tej samej minucie. Claimy są atomowe
--      (SKIP LOCKED), więc nakładka i tak niczego nie dubluje - przeplot
--      jedynie skraca najgorszy czas oczekiwania digestu o połowę.
--
-- Idempotentne. Bez pg_cron/pg_net wszystko jest fail-open - scheduler repo
-- i ręczny tick z panelu raportują do tego samego logu (job_runner_runs).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Telemetria puknięcia community (osobna od jobs-tick: rozjazd tych dwóch
--    statusów to diagnoza "minutowy tick żyje, siatka społeczności nie")
-- ----------------------------------------------------------------------------
ALTER TABLE public.job_runner_settings
  ADD COLUMN IF NOT EXISTS community_last_tick_at timestamptz,
  ADD COLUMN IF NOT EXISTS community_last_tick_status text,
  ADD COLUMN IF NOT EXISTS community_last_tick_error text,
  ADD COLUMN IF NOT EXISTS community_tick_count bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.job_runner_settings.community_last_tick_at IS
  'Ostatnia próba puknięcia community-cron z pg_cron (także pominięta - patrz status).';
COMMENT ON COLUMN public.job_runner_settings.community_last_tick_status IS
  'Wynik ostatniej próby: dispatched | skipped | error.';
COMMENT ON COLUMN public.job_runner_settings.community_last_tick_error IS
  'Powód pominięcia/błędu: disabled | no_secret | no_base_url | pg_net_unavailable | SQLERRM.';
COMMENT ON COLUMN public.job_runner_settings.community_tick_count IS
  'Licznik wystrzelonych puknięć community-cron (tylko dispatched).';

-- ----------------------------------------------------------------------------
-- 2) Samozbrojenie jako JEDNA funkcja (dotąd inline w invoke_jobs_tick)
-- ----------------------------------------------------------------------------
-- Zbroi wyłącznie wiersz DZIEWICZY (brak stempla auto_armed_at + wyłączony +
-- pusty base_url) adresem z kanonicznego resolvera. Po stemplu - nigdy więcej,
-- więc świadome wyłączenie runnera przez operatora zostaje wyłączone.
-- Zwraca true tylko, gdy TO wywołanie uzbroiło runner (wołacz odświeża wtedy
-- swój odczyt konfiguracji).
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

  -- Warunek na stempel powtórzony w UPDATE: dwa równoległe puknięcia (jobs-tick
  -- co minutę, community co 5 minut) nie uzbroją wiersza podwójnie.
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
  'Jednorazowe samozbrojenie dziewiczego wiersza job_runner_settings; wspólne dla invoke_jobs_tick i invoke_community_cron.';

REVOKE ALL ON FUNCTION public.job_runner_autoarm() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.job_runner_autoarm() TO service_role;

-- ----------------------------------------------------------------------------
-- 3) invoke_jobs_tick: zachowanie z 20260731130000, samozbrojenie z helpera
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoke_jobs_tick()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  cfg record;
  v_url text;
BEGIN
  -- Samozbrojenie w jednej funkcji dla obu puknięć (patrz job_runner_autoarm);
  -- konfigurację czytamy PO próbie zbrojenia, więc świeżo uzbrojony wiersz
  -- działa już w tym samym przebiegu.
  PERFORM public.job_runner_autoarm();

  SELECT enabled, base_url, secret, auto_armed_at INTO cfg
    FROM public.job_runner_settings WHERE id = 1;
  IF cfg IS NULL THEN
    RETURN;
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
-- 4) Puknięcie kanałów społeczności: push + digesty + przypomnienia
-- ----------------------------------------------------------------------------
-- Endpoint biegnie WYŁĄCZNIE przez kanoniczny dispatcher powiadomień, więc to
-- puknięcie drenuje kanały społeczności nawet wtedy, gdy budżet jobs-tick
-- zjadła kampania newslettera. Sekret to job_runner_settings.secret - endpoint
-- przyjmuje go równolegle z env COMMUNITY_CRON_SECRET (jeden sekret operatora
-- dla wszystkich ścieżek). p_job spoza kontraktu spada do 'all' zamiast
-- wystrzelić 400 na zawsze - literówka w ręcznym wpisie crona ma drenować
-- wszystko, a nie nic.
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
  -- To samo samozbrojenie co jobs-tick: pierwsza ścieżka, która ruszy po
  -- świeżym wdrożeniu, ożywia OBIE (wspólny wiersz konfiguracji).
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

  -- pg_net może nie istnieć (środowiska bez rozszerzenia) - fail-open.
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
    -- `?job=` zamiast body: kontrakt endpointu daje query pierwszeństwo,
    -- a v_job przeszedł przez białą listę, więc sklejenie jest bezpieczne.
    url := rtrim(v_url, '/') || '/api/public/community-cron?job=' || v_job,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-community-cron-secret', cfg.secret,
      'x-cron-source', 'pg_cron'
    ),
    -- Budżet endpointu to 25 s (COMMUNITY_CRON_DEADLINE_MS) - 30 s zostawia
    -- zapas na sieć, żeby pg_net nie ucinał przebiegu, który właśnie kończy.
    timeout_milliseconds := 30000
  );

  UPDATE public.job_runner_settings
     SET community_last_tick_at = now(),
         community_last_tick_status = 'dispatched',
         community_last_tick_error = NULL,
         community_tick_count = community_tick_count + 1
   WHERE id = 1;
EXCEPTION WHEN OTHERS THEN
  -- Puknięcie jest best-effort; błąd HTTP/konfiguracji nie może wysypać crona.
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
  'Puknięcie pg_cron do /api/public/community-cron (push/digesty/przypomnienia); telemetria w job_runner_settings.community_last_tick_*.';

REVOKE ALL ON FUNCTION public.invoke_community_cron(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_community_cron(text) TO service_role;

-- ----------------------------------------------------------------------------
-- 5) Zdrowie harmonogramu: telemetria community obok telemetrii jobs-tick
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

  -- Dwa stemple o różnych rolach (GREATEST ignoruje NULL-e):
  --   * v_last_ping (ALERT) - ostatni WYSTRZELONY HTTP z którejkolwiek ścieżki
  --     bazy (jobs-tick co minutę, community co 5 minut). Pominięta próba
  --     (status inny niż 'dispatched') nie jest puknięciem - cron, który
  --     świadomie nie strzela, nie może zapalić alertu o nieosiągalnej
  --     aplikacji.
  --   * v_last_stamp (PANEL) - ostatnia AKTYWNOŚĆ crona, łącznie z pominięciami;
  --     bez niej wyłączenie runnera kasowałoby w panelu całą historię puknięć
  --     („cron nigdy nie puknął" tuż po tygodniu poprawnej pracy).
  v_last_ping := GREATEST(
    CASE WHEN cfg.last_tick_status = 'dispatched'
         THEN COALESCE(cfg.last_invoked_at, cfg.last_tick_at) END,
    CASE WHEN cfg.community_last_tick_status = 'dispatched'
         THEN cfg.community_last_tick_at END
  );
  v_last_stamp := GREATEST(cfg.last_invoked_at, cfg.last_tick_at, cfg.community_last_tick_at);

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
      'last_invoked_at', v_last_stamp,
      'last_app_run_at', cfg.last_app_run_at,
      'last_app_ok_at', cfg.last_app_ok_at,
      'last_app_error', cfg.last_app_error,
      'failure_streak', COALESCE(cfg.failure_streak, 0),
      -- Telemetria SAMEGO crona (kto pukał i z jakim skutkiem) - mówi wprost,
      -- dlaczego puknięcia nie było: disabled / no_secret / no_base_url /
      -- pg_net_unavailable / error.
      'last_tick_status', cfg.last_tick_status,
      'last_tick_error', cfg.last_tick_error,
      'tick_count', COALESCE(cfg.tick_count, 0),
      -- Puknięcie siatki społeczności (community-cron co 5 minut) - osobno od
      -- jobs-tick, bo rozjazd tych statusów lokalizuje awarię konkretnej ścieżki.
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

-- ----------------------------------------------------------------------------
-- 6) Rejestr pg_cron: siatka społeczności co 5 minut, z przeplotem
-- ----------------------------------------------------------------------------
-- Minuty 2,7,12,... zamiast 0,5,10,...: jobs-tick zagląda do digestów w
-- minutach podzielnych przez 5, więc przesunięcie przeplata okna obu ścieżek
-- (digest ma szansę wyjść co ~2-3 minuty, a nie dwa razy w tej samej).
DO $$
DECLARE
  v_job record;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron niedostępny - community-cron pominięty (ścieżki zapasowe: jobs-tick, scheduler repo).';
    RETURN;
  END IF;

  PERFORM cron.schedule('community-cron', '2-59/5 * * * *', 'SELECT public.invoke_community_cron()');

  -- Wpis wyłączony ręcznie reaktywujemy przy wdrożeniu - martwy harmonogram
  -- jest jedyną awarią, której nie widać (ta sama zasada co w 20260731110000).
  FOR v_job IN
    EXECUTE $q$
      SELECT jobid, jobname FROM cron.job
       WHERE jobname = 'community-cron' AND NOT active
    $q$
  LOOP
    BEGIN
      EXECUTE format('SELECT cron.alter_job(%s, active := true)', v_job.jobid);
      RAISE NOTICE 'reaktywowano zadanie crona %', v_job.jobname;
    EXCEPTION WHEN OTHERS THEN
      -- Starsze pg_cron bez alter_job: flaga siedzi w tabeli.
      BEGIN
        EXECUTE format('UPDATE cron.job SET active = true WHERE jobid = %s', v_job.jobid);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'nie udało się reaktywować %: %', v_job.jobname, SQLERRM;
      END;
    END;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'harmonogram pg_cron: % (fail-open)', SQLERRM;
END $$;
