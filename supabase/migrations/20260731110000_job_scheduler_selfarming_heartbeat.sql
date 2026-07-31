-- ============================================================================
-- Harmonogram zadań tła: SAMOZBROJENIE, HEARTBEAT i OBSERWOWALNOŚĆ.
--
-- PRZYCZYNA ŹRÓDŁOWA (klasa błędu "kod jest, nikt go nie woła"): migracja
-- 20260713170000 zakłada zadanie pg_cron 'jobs-tick' (co minutę), ale
-- invoke_jobs_tick() wychodzi NATYCHMIAST, dopóki job_runner_settings ma
-- enabled=false i base_url='' - a to są WARTOŚCI DOMYŚLNE świeżo zasianego
-- wiersza. Efekt na produkcji: cron tyka, żaden HTTP nie leci,
-- notification_push_queue rośnie w 'pending', digesty i przypomnienia stoją.
-- Bez logu przebiegów nie da się nawet odróżnić "harmonogram jest martwy" od
-- "kolejka jest pusta" - jedno i drugie wygląda jak zero wysyłek.
--
-- Ta migracja domyka harmonogram po stronie bazy:
--
--   1) public.job_runner_runs - append-only log przebiegów dyspozytora (kto
--      wołał, jaki job, ile trwał, co zrobił). JEDYNE źródło prawdy o tym, czy
--      wysyłki faktycznie biegną; panel admina i alerty czytają tylko to.
--
--   2) Heartbeat na job_runner_settings: last_invoked_at (cron wystrzelił
--      HTTP) obok last_app_run_at / last_app_ok_at / last_app_error /
--      failure_streak (aplikacja odpowiedziała i zaraportowała wynik).
--      Rozjazd tych dwóch stempli to diagnoza "cron puka, aplikacja nie
--      odpowiada" - zły base_url, zły sekret albo leżący deploy. pg_net jest
--      fire-and-forget, więc sama baza inaczej tego nie wie.
--
--   3) resolve_job_runner_base_url() + SAMOZBROJENIE: dziewiczy wiersz
--      konfiguracji sam ustawia base_url z domeny domyślnego tenanta i włącza
--      runner, stemplując auto_armed_at. Decyzja operatora jest nienaruszalna:
--      po stemplu (albo po ręcznej zmianie) NIGDY nie zbroimy ponownie, więc
--      świadome wyłączenie runnera zostaje wyłączone.
--
--   4) record_job_run() - RPC dla aplikacji (service role): wpis do logu,
--      stempel heartbeatu, licznik kolejnych porażek i rotacja logu.
--
--   5) job_scheduler_health() - JEDEN round-trip dla panelu admina i alertów:
--      stan zadań crona, świeżość heartbeatu, głębokość kolejki push i wiek
--      najstarszego 'pending' (tenant wołającego), digesty na wejściu,
--      ostatnie przebiegi per źródło.
--
--   6) invoke_billing_cron() + wpis pg_cron: /api/public/billing-cron przyjmuje
--      sekret runnera z tej tabeli (billing-cron.ts, dbSecretMatches) od
--      20260721 - tylko nikt go nigdy nie wołał, więc przypomnienia o
--      odnowieniu i domknięcia karencji miejsc stały tak samo jak push.
--
--   7) Naprawa samego harmonogramu: projekt, w którym pg_cron włączono PO
--      20260713170000, nigdy nie dostał wpisu 'jobs-tick' (blok DO cicho
--      wychodził). Tu zakładamy go ponownie i reaktywujemy wpis wyłączony
--      ręcznie.
--
-- Idempotentne. Bez pg_cron/pg_net wszystko jest fail-open - ścieżka repo
-- (.github/workflows/scheduler.yml -> POST /api/public/community-cron) tyka
-- niezależnie i raportuje do tego samego logu.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Heartbeat konfiguracji runnera
-- ----------------------------------------------------------------------------
ALTER TABLE public.job_runner_settings
  ADD COLUMN IF NOT EXISTS last_invoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_armed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_app_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_app_ok_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_app_error text,
  ADD COLUMN IF NOT EXISTS failure_streak integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.job_runner_settings.last_invoked_at IS
  'Kiedy pg_cron wystrzelił net.http_post do aplikacji (puknięcie, nie wynik).';
COMMENT ON COLUMN public.job_runner_settings.auto_armed_at IS
  'Kiedy runner sam się uzbroił z domeny domyślnego tenanta; stempel blokuje ponowne samozbrojenie.';
COMMENT ON COLUMN public.job_runner_settings.last_app_run_at IS
  'Ostatni przebieg zaraportowany przez aplikację (record_job_run) - dowolne źródło.';
COMMENT ON COLUMN public.job_runner_settings.last_app_ok_at IS
  'Ostatni UDANY przebieg zaraportowany przez aplikację - podstawa alertu o zastoju.';
COMMENT ON COLUMN public.job_runner_settings.failure_streak IS
  'Liczba kolejnych nieudanych przebiegów; zerowana pierwszym udanym.';

-- ----------------------------------------------------------------------------
-- 2) Log przebiegów dyspozytora
-- ----------------------------------------------------------------------------
-- tenant_id/actor_id są wypełniane TYLKO dla przebiegów ręcznych z panelu
-- (ślad audytowy: kto i z jakiego tenanta wymusił tick). Przebieg cronowy jest
-- z natury międzytenantowy - drenuje kolejki wszystkich tenantów jednym
-- claimem SKIP LOCKED - więc tam tenant_id zostaje NULL i tak ma być.
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

COMMENT ON TABLE public.job_runner_runs IS
  'Append-only log przebiegów dyspozytora zadań tła (push/digesty/przypomnienia). Rotacja 14 dni.';

CREATE INDEX IF NOT EXISTS job_runner_runs_recent_idx
  ON public.job_runner_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS job_runner_runs_source_recent_idx
  ON public.job_runner_runs (source, created_at DESC);
CREATE INDEX IF NOT EXISTS job_runner_runs_failures_idx
  ON public.job_runner_runs (created_at DESC) WHERE NOT ok;

ALTER TABLE public.job_runner_runs ENABLE ROW LEVEL SECURITY;
-- Brak polityk klienckich: log infrastrukturalny czyta wyłącznie service role
-- (dyspozytor) i staff przez job_scheduler_health() (SECURITY DEFINER).
REVOKE ALL ON public.job_runner_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.job_runner_runs TO service_role;

-- ----------------------------------------------------------------------------
-- 3) Rozstrzyganie bazowego URL-a (konfiguracja -> domena domyślnego tenanta)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_job_runner_base_url()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT COALESCE(
    NULLIF(rtrim(btrim((SELECT s.base_url FROM public.job_runner_settings s WHERE s.id = 1)), '/'), ''),
    (
      SELECT 'https://' || lower(btrim(t.domain))
        FROM public.tenants t
       WHERE t.domain IS NOT NULL
         AND btrim(t.domain) <> ''
         -- localhost/adresy prywatne nie są celem dla crona bazy produkcyjnej.
         AND lower(btrim(t.domain)) NOT LIKE 'localhost%'
         AND lower(btrim(t.domain)) NOT LIKE '127.%'
       ORDER BY t.is_default DESC, t.created_at ASC
       LIMIT 1
    )
  );
$fn$;

REVOKE ALL ON FUNCTION public.resolve_job_runner_base_url() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_job_runner_base_url() TO service_role;

-- Uzbrojenie runnera adresem, który zna WYŁĄCZNIE aplikacja (origin żądania
-- albo PUBLIC_SITE_URL). Domena tenanta bywa pusta w instalacji jednodomenowej
-- - routing publiczny działa wtedy przez fallback do tenanta domyślnego - więc
-- baza sama nie ma z czego zbudować URL-a. Dowolna ścieżka ticku (repo cron
-- -> community-cron, ręczny tick z panelu) przekazuje tu swój origin i tym
-- samym ożywia ścieżkę PODSTAWOWĄ: pg_cron co minutę, bez GitHuba.
--
-- Zbroimy tylko wiersz DZIEWICZY (brak stempla + wyłączony + pusty URL) i
-- tylko adresem https bez hosta lokalnego; sekret dosypujemy, gdy go brak.
-- search_path zawiera `extensions`, bo dosypanie sekretu woła gen_random_bytes()
-- z pgcrypto, a na Supabase pgcrypto siedzi w schemacie `extensions`. Przy
-- `SET search_path = public` funkcja kompiluje się bez szemrania i wywala się
-- dopiero przy wywołaniu (42883) - czyli w chwili samozbrojenia runnera.
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

-- ----------------------------------------------------------------------------
-- 4) Raport przebiegu z aplikacji (heartbeat + log + rotacja)
-- ----------------------------------------------------------------------------
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

  -- Rotacja bez własnego zadania crona: co 250. wpis (log jest jednorodny,
  -- więc to ~raz na kilka godzin przy ticku co minutę).
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

-- ----------------------------------------------------------------------------
-- 5) Puknięcie z crona: samozbrojenie + stempel + POST
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoke_jobs_tick()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  cfg record;
  v_resolved text;
BEGIN
  SELECT enabled, base_url, secret, auto_armed_at INTO cfg
    FROM public.job_runner_settings WHERE id = 1;
  IF cfg IS NULL THEN
    RETURN;
  END IF;

  -- SAMOZBROJENIE (raz w życiu wiersza): wiersz dziewiczy = domyślny
  -- enabled=false + base_url='' + brak stempla. Taki stan to nie decyzja
  -- operatora, tylko brak konfiguracji - a jego skutkiem jest martwy
  -- harmonogram. Zbrojimy z domeny domyślnego tenanta i stemplujemy, więc
  -- późniejsze wyłączenie runnera przez człowieka zostaje wyłączone.
  IF cfg.auto_armed_at IS NULL
     AND NOT cfg.enabled
     AND COALESCE(btrim(cfg.base_url), '') = ''
  THEN
    v_resolved := public.resolve_job_runner_base_url();
    IF v_resolved IS NOT NULL AND length(v_resolved) > 8 THEN
      UPDATE public.job_runner_settings
         SET enabled = true,
             base_url = v_resolved,
             auto_armed_at = now()
       WHERE id = 1 AND auto_armed_at IS NULL;
      SELECT enabled, base_url, secret, auto_armed_at INTO cfg
        FROM public.job_runner_settings WHERE id = 1;
      RAISE NOTICE 'job runner uzbrojony automatycznie: %', v_resolved;
    END IF;
  END IF;

  IF NOT cfg.enabled OR COALESCE(btrim(cfg.base_url), '') = '' OR COALESCE(cfg.secret, '') = '' THEN
    RETURN;
  END IF;

  -- pg_net może nie istnieć (środowiska bez rozszerzenia) - fail-open.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'net' AND p.proname = 'http_post'
  ) THEN
    RETURN;
  END IF;

  -- Stempel PRZED wysyłką: to znacznik "cron puknął". Jeśli aplikacja nie
  -- zaraportuje przebiegu (record_job_run), job_scheduler_health() zobaczy
  -- rozjazd i powie wprost, że puknięcia lecą w próżnię.
  UPDATE public.job_runner_settings SET last_invoked_at = now() WHERE id = 1;

  PERFORM net.http_post(
    url := rtrim(cfg.base_url, '/') || '/api/public/jobs-tick',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-jobs-secret', cfg.secret,
      'x-cron-source', 'pg_cron'
    ),
    timeout_milliseconds := 25000
  );
EXCEPTION WHEN OTHERS THEN
  -- Tick jest best-effort; błąd HTTP/konfiguracji nie może wysypać crona.
  RAISE WARNING 'invoke_jobs_tick: %', SQLERRM;
END;
$fn$;

REVOKE ALL ON FUNCTION public.invoke_jobs_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invoke_jobs_tick() TO service_role;

-- ----------------------------------------------------------------------------
-- 6) Puknięcie dobowe rozliczeń (endpoint przyjmuje sekret runnera)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoke_billing_cron()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  cfg record;
BEGIN
  SELECT enabled, base_url, secret INTO cfg
    FROM public.job_runner_settings WHERE id = 1;
  IF cfg IS NULL OR NOT cfg.enabled
     OR COALESCE(btrim(cfg.base_url), '') = ''
     OR COALESCE(cfg.secret, '') = ''
  THEN
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
-- 7) Zdrowie harmonogramu - jeden round-trip dla panelu i alertów
-- ----------------------------------------------------------------------------
-- Autoryzacja i zakres danych liczone są TYM SAMYM tenantem
-- (current_tenant_id() + has_role), więc nagłówek x-tenant-host nie otwiera
-- cudzych liczników (inwariant z 20260724091000, gate check:sql-tenant-scope).
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
         COALESCE(secret, '') <> '' AS secret_set
    INTO cfg
    FROM public.job_runner_settings WHERE id = 1;

  -- Rejestr zadań crona (nazwa/harmonogram/aktywność). Dynamicznie, bo
  -- cron.job nie istnieje bez pg_cron, a ciało plpgsql nie jest parsowane
  -- przy CREATE - statyczne odwołanie wywaliłoby się dopiero w runtime.
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

  -- Ostatni przebieg per źródło: od razu widać, która ścieżka żyje (pg_cron,
  -- GitHub Actions, ręczny tick z panelu).
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
      'resolved_base_url', COALESCE(public.resolve_job_runner_base_url(), ''),
      'secret_set', COALESCE(cfg.secret_set, false),
      'auto_armed_at', cfg.auto_armed_at,
      'last_invoked_at', cfg.last_invoked_at,
      'last_app_run_at', cfg.last_app_run_at,
      'last_app_ok_at', cfg.last_app_ok_at,
      'last_app_error', cfg.last_app_error,
      'failure_streak', COALESCE(cfg.failure_streak, 0)
    ),
    'capabilities', jsonb_build_object(
      'pg_cron', to_regclass('cron.job') IS NOT NULL,
      'pg_net', EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'net' AND p.proname = 'http_post'
      )
    ),
    -- Cron puka (świeży last_invoked_at), ale aplikacja nie raportuje: zły
    -- base_url, zły sekret albo leżący deploy. Bez tego porównania pg_net
    -- (fire-and-forget) milczy o każdej z tych awarii.
    'app_unreachable', (
      cfg.last_invoked_at IS NOT NULL
      AND cfg.last_invoked_at > now() - interval '10 minutes'
      AND (cfg.last_app_run_at IS NULL OR cfg.last_app_run_at < now() - interval '10 minutes')
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
-- 8) Naprawa i domknięcie rejestru pg_cron
-- ----------------------------------------------------------------------------
-- Zakładamy 'jobs-tick' ponownie (idempotentnie): projekt, w którym pg_cron
-- włączono PO 20260713170000, nigdy go nie dostał. Dokładamy dobowe puknięcie
-- rozliczeń oraz rotację logu przebiegów, a wpisy wyłączone ręcznie
-- reaktywujemy - martwy harmonogram jest tu jedyną awarią, której nie widać.
DO $$
DECLARE
  v_job record;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron niedostępny - harmonogram bazy pominięty (ścieżka repo: scheduler.yml).';
    RETURN;
  END IF;

  PERFORM cron.schedule('jobs-tick', '* * * * *', 'SELECT public.invoke_jobs_tick()');
  PERFORM cron.schedule('billing-cron-daily', '25 4 * * *', 'SELECT public.invoke_billing_cron()');
  PERFORM cron.schedule(
    'prune-job-runner-runs',
    '40 3 * * *',
    $sql$DELETE FROM public.job_runner_runs WHERE created_at < now() - interval '14 days'$sql$
  );

  FOR v_job IN
    EXECUTE $q$
      SELECT jobid, jobname FROM cron.job
       WHERE jobname IN ('jobs-tick', 'billing-cron-daily', 'prune-job-runner-runs')
         AND NOT active
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
