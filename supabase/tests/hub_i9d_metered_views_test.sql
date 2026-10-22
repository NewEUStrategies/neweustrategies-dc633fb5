-- pgTAP: retencja odczytów licznika artykułów (I9d-Y1, Z-I9c-07; migracje
-- 20261020161700 i rdzeń katalogu 20261020162200; decyzja właściciela
-- 2026-10-20: 3 mies., zakres 2-13, art. 9 RODO - minimalizacja).
--
-- CO PRZYPINA:
--   * pulpit monetyzacji (odczyty: razem, członkowie, goście; zdarzenia
--     licznika) i lejek (konta aktywne, uderzenia) okna starszego niż okres
--     - TEN SAM wynik przed czyszczeniem i po nim (agregat dobowy
--     `metered_views_daily` + pieczęć lejka);
--   * usuwane wyłącznie odczyty starsze niż próg - nigdy bieżący okres
--     licznika; `entity_id` (CO przeczytano) w dzienniku licznika
--     i uderzeniach starszych niż próg -> NULL, reszta wiersza zostaje;
--   * najemca w karencji: przebieg liczy, nic nie usuwa;
--   * uzupełnienie agregatu dni zapieczętowanych przed I9d (bez nadpisania);
--   * powtórka = 0; ACL funkcji i tabeli agregatu.
--
-- Uruchamianie: PGTAP_DIR=... PGTAP_PORT=... bash scripts/pgtap-local/run.sh test hub_i9d_metered_views
BEGIN;
SELECT plan(15);

-- ── Fikstura ─────────────────────────────────────────────────────────────────
ALTER TABLE auth.users DISABLE TRIGGER USER;

-- A: po karencji (wykonanie); B: w karencji (podgląd); C: uzupełnienie.
INSERT INTO public.tenants (id, slug, name, created_at) VALUES
  ('19d20000-0000-4000-8000-0000000000a0', 'i9d-licznik-a', 'I9d Licznik A', now() - interval '30 days'),
  ('19d20000-0000-4000-8000-0000000000b0', 'i9d-licznik-b', 'I9d Licznik B', now()),
  ('19d20000-0000-4000-8000-0000000000c0', 'i9d-licznik-c', 'I9d Licznik C', now() - interval '30 days');
INSERT INTO auth.users (id, email) VALUES
  ('19d20000-0000-4000-8000-00000000a001', 'admin@i9d-licznik.test'),
  ('19d20000-0000-4000-8000-00000000e001', 'czytelnik1@i9d-licznik.test'),
  ('19d20000-0000-4000-8000-00000000e002', 'czytelnik2@i9d-licznik.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('19d20000-0000-4000-8000-00000000a001', 'admin@i9d-licznik.test', 'Admin', '19d20000-0000-4000-8000-0000000000a0');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('19d20000-0000-4000-8000-00000000a001', 'admin', '19d20000-0000-4000-8000-0000000000a0');

CREATE FUNCTION pg_temp.day(p_days integer) RETURNS timestamptz LANGUAGE sql STABLE AS $$
  -- Południe UTC dnia sprzed p_days dni - wiersz zawsze w środku doby.
  SELECT ((now() AT TIME ZONE 'UTC')::date - p_days)::timestamp AT TIME ZONE 'UTC' + interval '12 hours'
$$;
CREATE FUNCTION pg_temp.as_user(p_uid text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;

-- Odczyty: dni 150 i 140 (starsze niż 3 mies.), dzień 30 (w okresie),
-- bieżący okres. Konto czyta tylko jednego dnia - wynik okna z agregatu
-- dobowego równa się surowemu.
CREATE FUNCTION pg_temp.view(p_tenant text, p_user text, p_visitor text, p_days integer, p_period date DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.metered_views (tenant_id, user_id, visitor_id, entity_type, entity_id, period_month, created_at)
  VALUES (p_tenant::uuid, p_user::uuid, p_visitor::uuid, 'post', gen_random_uuid(),
          COALESCE(p_period, date_trunc('month', pg_temp.day(p_days) AT TIME ZONE 'UTC')::date), pg_temp.day(p_days))
$$;
SELECT pg_temp.view(t, '19d20000-0000-4000-8000-00000000e001', NULL, 150),
       pg_temp.view(t, NULL, '19d20000-0000-4000-8000-0000000000f1', 150),
       pg_temp.view(t, NULL, '19d20000-0000-4000-8000-0000000000f2', 150),
       pg_temp.view(t, '19d20000-0000-4000-8000-00000000e002', NULL, 140),
       pg_temp.view(t, '19d20000-0000-4000-8000-00000000e002', NULL, 140),
       pg_temp.view(t, NULL, '19d20000-0000-4000-8000-0000000000f3', 140),
       pg_temp.view(t, '19d20000-0000-4000-8000-00000000e001', NULL, 30),
       pg_temp.view(t, NULL, '19d20000-0000-4000-8000-0000000000f4', 30),
       pg_temp.view(t, '19d20000-0000-4000-8000-00000000e002', NULL, 0)
  FROM (VALUES ('19d20000-0000-4000-8000-0000000000a0'), ('19d20000-0000-4000-8000-0000000000b0')) x(t);
-- Bezpiecznik bieżącego okresu: stary wiersz z okresem = bieżący miesiąc.
SELECT pg_temp.view('19d20000-0000-4000-8000-0000000000a0', NULL, '19d20000-0000-4000-8000-0000000000f5', 150,
                    date_trunc('month', now())::date);

-- Dziennik licznika i uderzenia w paywall z treścią (stare i świeże).
INSERT INTO public.metering_event_log (tenant_id, occurred_at, user_id, entity_type, entity_id, outcome)
SELECT t, pg_temp.day(d), '19d20000-0000-4000-8000-00000000e001', 'post', gen_random_uuid(), o
  FROM (VALUES ('19d20000-0000-4000-8000-0000000000a0'::uuid), ('19d20000-0000-4000-8000-0000000000b0'::uuid)) x(t)
 CROSS JOIN (VALUES (150, 'consumed'), (140, 'denied'), (30, 'consumed')) y(d, o);
INSERT INTO public.paywall_hits (tenant_id, day, user_id, entity_type, entity_id, reason, first_at, last_at)
SELECT t, (pg_temp.day(d) AT TIME ZONE 'UTC')::date, '19d20000-0000-4000-8000-00000000e001', 'post',
       gen_random_uuid(), 'paid', pg_temp.day(d), pg_temp.day(d)
  FROM (VALUES ('19d20000-0000-4000-8000-0000000000a0'::uuid), ('19d20000-0000-4000-8000-0000000000b0'::uuid)) x(t)
 CROSS JOIN (VALUES (150), (30)) y(d);

-- Odczyt okna [dzień 160, dzień 130) - pulpit (admin z sesji) i lejek.
CREATE FUNCTION pg_temp.window_read(p_tenant text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_dash jsonb;
  v_funnel jsonb;
BEGIN
  PERFORM pg_temp.as_user('19d20000-0000-4000-8000-00000000a001');
  v_dash := public.monetization_dashboard(pg_temp.day(160) - interval '12 hours', pg_temp.day(130) - interval '12 hours',
                                          NULL, NULL);
  PERFORM set_config('request.jwt.claims', '', true);
  v_funnel := public._funnel_counts(p_tenant::uuid, pg_temp.day(160) - interval '12 hours',
                                    pg_temp.day(130) - interval '12 hours', 'all');
  RETURN jsonb_build_object(
    'views', v_dash -> 'metered_views', 'events', v_dash -> 'metering_events',
    'active_accounts', v_funnel -> 'active_accounts', 'paywall_hit_accounts', v_funnel -> 'paywall_hit_accounts',
    'paywall_hits', v_funnel -> 'paywall_hits');
END;
$$;

CREATE TEMP TABLE r (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
INSERT INTO r SELECT 'before', pg_temp.window_read('19d20000-0000-4000-8000-0000000000a0');

-- 1. Fikstura: okno widzi 7 odczytów (3 członków, 4 gości), 2 konta aktywne.
SELECT is(
  (SELECT v FROM r WHERE k = 'before') - 'events' - 'paywall_hits' - 'paywall_hit_accounts',
  '{"views": {"total": 7, "members": 3, "anonymous": 4}, "active_accounts": 2}'::jsonb,
  'fikstura: okno sprzed progu liczone z surowych - 7 odczytów (3 członków, 4 gości), 2 konta aktywne');

-- ── Karencja (B): podgląd ─────────────────────────────────────────────────────
INSERT INTO r SELECT 'b', public._data_retention_run_tenant('19d20000-0000-4000-8000-0000000000b0', 'schedule', 1000);
SELECT ok(
  (SELECT v -> 'metered_views' ->> 'mode' = 'preview' FROM r WHERE k = 'b')
  AND (SELECT count(*) = 9 FROM public.metered_views WHERE tenant_id = '19d20000-0000-4000-8000-0000000000b0')
  AND (SELECT count(*) = 3 FROM public.metering_event_log
        WHERE tenant_id = '19d20000-0000-4000-8000-0000000000b0' AND entity_id IS NOT NULL
          AND occurred_at < now() - interval '1 day')
  AND NOT EXISTS (SELECT 1 FROM public.paywall_hits WHERE tenant_id = '19d20000-0000-4000-8000-0000000000b0'
                   AND entity_id IS NULL),
  'najemca w karencji: przebieg w trybie podglądu liczy, odczyty i treść w dziennikach zostają');

-- ── Wykonanie (A): pieczęć do progu, potem czyszczenie ───────────────────────
DO $$
BEGIN
  -- Pierwszy przebieg dopieczętowuje lejek po 31 dni na kategorię - zaległość
  -- (`backlog`) przez kilka przebiegów jest oczekiwana.
  FOR i IN 1..15 LOOP
    INSERT INTO r VALUES ('run' || i,
      public._data_retention_run_tenant('19d20000-0000-4000-8000-0000000000a0', 'schedule', 1000))
    ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v;
    EXIT WHEN (SELECT (v -> 'metered_views' ->> 'backlog')::boolean IS FALSE FROM r WHERE k = 'run' || i);
  END LOOP;
END $$;

SELECT ok(
  (SELECT bool_or((v -> 'metered_views' ->> 'backlog')::boolean IS FALSE AND v -> 'metered_views' ->> 'mode' = 'execute')
     FROM r WHERE k LIKE 'run%')
  AND NOT EXISTS (SELECT 1 FROM public.data_retention_runs
                   WHERE tenant_id = '19d20000-0000-4000-8000-0000000000a0' AND error_code IS NOT NULL),
  'wykonanie: zaległość pieczęci domknięta w kilku przebiegach, bez błędów');

INSERT INTO r SELECT 'after', pg_temp.window_read('19d20000-0000-4000-8000-0000000000a0');
SELECT is((SELECT v FROM r WHERE k = 'after'), (SELECT v FROM r WHERE k = 'before'),
  'pulpit i lejek okna sprzed progu: ten sam wynik przed czyszczeniem i po nim (odczyty, zdarzenia, konta, uderzenia)');

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.metered_views WHERE tenant_id = '19d20000-0000-4000-8000-0000000000a0'
               AND created_at < now() - interval '3 months' AND period_month < date_trunc('month', now())::date)
  AND (SELECT count(*) = 3 FROM public.metered_views WHERE tenant_id = '19d20000-0000-4000-8000-0000000000a0'
         AND created_at >= now() - interval '3 months')
  AND EXISTS (SELECT 1 FROM public.metered_views WHERE tenant_id = '19d20000-0000-4000-8000-0000000000a0'
               AND visitor_id = '19d20000-0000-4000-8000-0000000000f5'),
  'odczyty: starsze niż próg usunięte; świeże i wiersz bieżącego okresu licznika zostają');

SELECT ok(
  (SELECT count(*) = 2 AND bool_and(entity_id IS NULL AND user_id IS NOT NULL AND outcome IN ('consumed', 'denied'))
     FROM public.metering_event_log
    WHERE tenant_id = '19d20000-0000-4000-8000-0000000000a0' AND occurred_at < now() - interval '3 months')
  AND NOT EXISTS (SELECT 1 FROM public.metering_event_log
                   WHERE tenant_id = '19d20000-0000-4000-8000-0000000000a0'
                     AND occurred_at >= now() - interval '3 months' AND entity_id IS NULL),
  'dziennik licznika: treść starszych wpisów -> NULL (wynik, konto, czas zostają), świeże nietknięte');

SELECT ok(
  (SELECT entity_id IS NULL AND user_id IS NOT NULL AND reason = 'paid' AND hits = 1 FROM public.paywall_hits
    WHERE tenant_id = '19d20000-0000-4000-8000-0000000000a0' AND day < (now() - interval '3 months')::date)
  AND (SELECT entity_id IS NOT NULL FROM public.paywall_hits
        WHERE tenant_id = '19d20000-0000-4000-8000-0000000000a0' AND day >= (now() - interval '3 months')::date),
  'uderzenia: treść starszego uderzenia -> NULL (konto, powód, liczba zostają), świeże nietknięte');

SELECT results_eq(
  $$ SELECT ((now() AT TIME ZONE 'UTC')::date - day)::int, members, anonymous, accounts FROM public.metered_views_daily
      WHERE tenant_id = '19d20000-0000-4000-8000-0000000000a0' ORDER BY day $$,
  $$ VALUES (150, 1, 3, 1), (140, 2, 1, 1) $$,
  'agregat dobowy: dni sprzed progu - członkowie, goście, konta czytające (bez identyfikatorów)');

SELECT ok(
  (SELECT purged_before = (now() - interval '3 months')::date AND sealed_through >= purged_before - 1
     FROM public.data_retention_state
    WHERE tenant_id = '19d20000-0000-4000-8000-0000000000a0' AND scope = 'funnel')
  AND public._data_retention_funnel_cut('19d20000-0000-4000-8000-0000000000a0') = (now() - interval '3 months')::date,
  'granica odczytu z agregatu = próg odczytów licznika (3 mies.), nie lejka (13 mies.)');

SELECT pg_temp.as_user('19d20000-0000-4000-8000-00000000a001');
SELECT is(
  public.monetization_dashboard(now() - interval '1 year', now(), NULL, NULL) ->> 'aggregate_before',
  ((now() - interval '3 months')::date)::text,
  'pulpit: aggregate_before = pierwszy dzień liczony z surowych (dymek panelu)');
SELECT set_config('request.jwt.claims', '', true);

INSERT INTO r SELECT 'again', public._data_retention_run_tenant('19d20000-0000-4000-8000-0000000000a0', 'schedule', 1000);
SELECT is((SELECT (v -> 'metered_views' ->> 'affected')::int FROM r WHERE k = 'again'), 0,
  'idempotencja: powtórka nic nie usuwa ani nie redaguje');

-- ── Uzupełnienie dni zapieczętowanych przed I9d (C) ──────────────────────────
SELECT pg_temp.view('19d20000-0000-4000-8000-0000000000c0', '19d20000-0000-4000-8000-00000000e001', NULL, 150),
       pg_temp.view('19d20000-0000-4000-8000-0000000000c0', NULL, '19d20000-0000-4000-8000-0000000000f6', 150),
       pg_temp.view('19d20000-0000-4000-8000-0000000000c0', NULL, '19d20000-0000-4000-8000-0000000000f7', 140),
       pg_temp.view('19d20000-0000-4000-8000-0000000000c0', NULL, '19d20000-0000-4000-8000-0000000000f8', 100);
INSERT INTO public.data_retention_state (tenant_id, scope, sealed_through)
VALUES ('19d20000-0000-4000-8000-0000000000c0', 'funnel', (pg_temp.day(140) AT TIME ZONE 'UTC')::date);
-- Dzień 150 policzony już przez pieczęć (wartość inna niż z surowych).
INSERT INTO public.metered_views_daily (tenant_id, day, members, anonymous, accounts)
VALUES ('19d20000-0000-4000-8000-0000000000c0', (pg_temp.day(150) AT TIME ZONE 'UTC')::date, 9, 9, 9);
SELECT is(public._data_retention_backfill_metered_views('19d20000-0000-4000-8000-0000000000c0'), 1,
  'uzupełnienie: jeden dzień zapieczętowany bez agregatu (140); dzień po pieczęci (100) - nie');
SELECT results_eq(
  $$ SELECT ((now() AT TIME ZONE 'UTC')::date - day)::int, members, anonymous FROM public.metered_views_daily
      WHERE tenant_id = '19d20000-0000-4000-8000-0000000000c0' ORDER BY day $$,
  $$ VALUES (150, 9, 9), (140, 0, 1) $$,
  'uzupełnienie nie nadpisuje dnia policzonego przez pieczęć');

-- ── Schemat i ACL ────────────────────────────────────────────────────────────
SELECT ok(
  (SELECT is_nullable = 'YES' FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'paywall_hits' AND column_name = 'entity_id')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.metered_views_daily'::regclass)
  AND NOT has_table_privilege('anon', 'public.metered_views_daily', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.metered_views_daily', 'SELECT'),
  'schemat: entity_id uderzeń NULL-owalny (redakcja); agregat z RLS, bez dostępu anon/authenticated');
SELECT ok(
  NOT EXISTS (
    SELECT 1
      FROM unnest(ARRAY[
             'public._data_retention_metered_views(uuid, timestamptz, boolean, integer)',
             'public._data_retention_backfill_metered_views(uuid)',
             'public._data_retention_seal_funnel(uuid, date, integer)', 'public._data_retention_funnel_cut(uuid)']) f,
           unnest(ARRAY['anon', 'authenticated', 'service_role']) r
     WHERE has_function_privilege(r, f, 'EXECUTE'))
  AND has_function_privilege('authenticated', 'public.monetization_dashboard(timestamptz, timestamptz, uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.monetization_dashboard(timestamptz, timestamptz, uuid, uuid)', 'EXECUTE'),
  'acl: funkcje kategorii, pieczęci i uzupełnienia wewnętrzne; pulpit - authenticated, bez anon');

SELECT * FROM finish();
ROLLBACK;
