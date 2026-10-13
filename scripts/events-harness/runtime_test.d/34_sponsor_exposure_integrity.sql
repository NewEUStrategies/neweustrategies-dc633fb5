-- ============================================================================
-- 34 INTEGRALNOSC POMIARU EKSPOZYCJI SPONSOROW (OPS-09)
--
-- Migracja `20261013111400_event_sponsor_exposure_integrity`. Defekt: liczba
-- unikalnych wyswietlen sponsora = liczba roznych identyfikatorow sesji, a te
-- wymyslal KLIENT - skrypt rotujacy identyfikator nabijal raport, na ktorym
-- organizator rozlicza sponsora. Plik sprawdza:
--   * podpis sesji (HMAC kluczem najemcy, klucz zakladany leniwie, inny
--     najemca = inny podpis, zly nonce = NULL);
--   * wydanie sesji przez serwer (paczka bez sesji), ponowne uzycie bez
--     nowego unikalnego, sesje niepodpisane/podrobione/obcego najemcy w
--     kubelku zrodla (jeden unikalny na adres i dzien) z anomalia;
--   * KRYTERIUM AUDYTU: 1000 sesji z jednego adresu daje najwyzej N = 50
--     unikalnych (49 sesji + kubelek), a odrzucone limitem zapytan i zwiniete
--     ponad limit sesji sa zapisane jako anomalie z dokladnymi licznikami;
--   * odrzucenie bez zapisu: zrodlo spoza ksztaltu (surowy adres, NULL);
--   * stara sygnatura usunieta, granty, RLS, brak dostepu klienckiego;
--   * RPC panelu `admin_event_sponsor_exposure_anomalies`: bramka roli,
--     izolacja najemcy, filtr sponsora (z poziomem wydarzenia), zakres dni;
--   * retencja (rejestr sesji 2 dni, anomalie jak ekspozycje) i kaskada;
--   * `event_home_ad_track` dalej pusta zaslepka (nie ma czego utwardzac).
--
-- `now()` jest STALE w transakcji, wiec okno `rate_limit_hit` (minuta) tez -
-- liczniki limitu zapytan sa tu deterministyczne.
--
-- CZEGO NIE SPRAWDZA: endpointu HTTP (sol skrotu adresu, odpowiedz z sesja)
-- i przegladarki (przechowanie sesji) - to vitest (`-sponsor-event.test.ts`,
-- `sponsorTracking.test.ts`); wspolbieznosci blokady doradczej (jedna sesja
-- psql).
--
-- SPRZATANIE: jedna transakcja zakonczona ROLLBACK-iem.
-- ============================================================================

\echo '== 34 integralnosc pomiaru ekspozycji sponsorow =='

BEGIN;

-- ---------------------------------------------------------------------------
-- SEKCJA 1: SCENOGRAFIA
-- Najemca A = publiczny najemca harnessu, najemca B nowy. a1 admin A,
-- a2 redaktor A, b1 admin B. E1 opublikowane (A), EB opublikowane (B).
-- Sponsorzy E1: S1 i S2 (opublikowani). Reklama strony glownej bez sponsora.
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('34000000-0000-0000-0000-0000000000b0', 'Tenant B (integralnosc pomiaru)', 'tb-sxi');

INSERT INTO auth.users (id, email) VALUES
  ('34a00000-0000-0000-0000-0000000000a1', 'sxi.admin.a@example.org'),
  ('34a00000-0000-0000-0000-0000000000a2', 'sxi.editor.a@example.org'),
  ('34a00000-0000-0000-0000-0000000000b1', 'sxi.admin.b@example.org');

INSERT INTO public.user_roles (user_id, role) VALUES
  ('34a00000-0000-0000-0000-0000000000a1', 'admin'),
  ('34a00000-0000-0000-0000-0000000000a2', 'editor');
INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('34a00000-0000-0000-0000-0000000000b1', 'admin', '34000000-0000-0000-0000-0000000000b0');

INSERT INTO public.profiles (id, tenant_id) VALUES
  ('34a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111'),
  ('34a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111'),
  ('34a00000-0000-0000-0000-0000000000b1', '34000000-0000-0000-0000-0000000000b0');

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, timezone, status,
   registration_mode, registration_flow)
VALUES
  ('34e00000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111',
   'sxi-forum', 'Forum pomiaru', 'Measurement forum',
   now() - interval '1 day', now() + interval '1 day', 'Europe/Warsaw', 'published', 'rsvp', 'instant'),
  ('34e00000-0000-0000-0000-0000000000eb', '34000000-0000-0000-0000-0000000000b0',
   'sxi-forum-b', 'Forum B', 'Forum B',
   now() - interval '1 day', NULL, 'Europe/Warsaw', 'published', 'rsvp', 'instant');

INSERT INTO public.crm_companies (id, tenant_id, name) VALUES
  ('34c00000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'Alfa 34'),
  ('34c00000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111', 'Beta 34')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_sponsors
  (id, tenant_id, event_id, company_id, role, is_published, snapshot_name)
VALUES
  ('34500000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '34e00000-0000-0000-0000-0000000000e1', '34c00000-0000-0000-0000-0000000000c1',
   'partner', true, 'Alfa'),
  ('34500000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '34e00000-0000-0000-0000-0000000000e1', '34c00000-0000-0000-0000-0000000000c2',
   'partner', true, 'Beta');

INSERT INTO public.event_home_ads (id, tenant_id, event_id, image_url, is_active) VALUES
  ('34d00000-0000-0000-0000-0000000000a0', '11111111-1111-1111-1111-111111111111',
   '34e00000-0000-0000-0000-0000000000e1', 'https://cdn.example.org/sxi-0.png', true);

-- Zrodla (to, co endpoint podaje z `requestRateSubject`: `ip:` + 32 hex).
CREATE TEMP TABLE sxi_q (k text PRIMARY KEY, t text) ON COMMIT DROP;
INSERT INTO sxi_q (k, t) VALUES
  ('src_a', 'ip:' || md5('34-zrodlo-a')),
  ('src_b', 'ip:' || md5('34-zrodlo-b')),
  ('src_c', 'ip:' || md5('34-zrodlo-c-tysiac')),
  ('src_d', 'ip:' || md5('34-zrodlo-d'));

CREATE FUNCTION pg_temp.sxi_src(_k text) RETURNS text LANGUAGE sql AS $$
  SELECT t FROM sxi_q WHERE k = _k
$$;

-- Jedno wywolanie zapisu (harness gra role `service_role` endpointu).
CREATE FUNCTION pg_temp.sxi_ingest(
  _source text,
  _session text,
  _items jsonb,
  _slug text DEFAULT 'sxi-forum',
  _tenant uuid DEFAULT '11111111-1111-1111-1111-111111111111'
) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.event_sponsor_exposure_ingest(
    _tenant, _source,
    jsonb_strip_nulls(jsonb_build_object('event_slug', _slug, 'session', _session, 'items', _items)))
$$;

CREATE FUNCTION pg_temp.sxi_item(_sponsor text, _placement text, _kind text, _ad text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('sponsor_id', _sponsor, 'placement', _placement,
    'kind', _kind, 'home_ad_id', _ad))
$$;

CREATE FUNCTION pg_temp.sxi_rows(_sponsor uuid, _placement text, _kind text) RETURNS integer
LANGUAGE sql AS $$
  SELECT count(*)::integer FROM public.event_sponsor_exposures x
   WHERE x.event_id = '34e00000-0000-0000-0000-0000000000e1'
     AND x.sponsor_id IS NOT DISTINCT FROM _sponsor AND x.placement = _placement AND x.kind = _kind
$$;

CREATE FUNCTION pg_temp.sxi_anomaly(_reason text, _sponsor uuid, _source_key text DEFAULT NULL)
RETURNS integer LANGUAGE sql AS $$
  SELECT COALESCE(sum(a.hits), 0)::integer FROM public.event_sponsor_exposure_anomalies a
   WHERE a.event_id = '34e00000-0000-0000-0000-0000000000e1'
     AND a.reason = _reason AND a.sponsor_id IS NOT DISTINCT FROM _sponsor
     AND (_source_key IS NULL OR a.source_hash = encode(public.digest(
       'src:11111111-1111-1111-1111-111111111111:34e00000-0000-0000-0000-0000000000e1:'
       || pg_temp.sxi_src(_source_key) || ':' || ((now() AT TIME ZONE 'Europe/Warsaw')::date)::text,
       'sha256'), 'hex'))
$$;

-- ---------------------------------------------------------------------------
-- SEKCJA 2: PODPIS SESJI
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  a constant uuid := '11111111-1111-1111-1111-111111111111';
  b constant uuid := '34000000-0000-0000-0000-0000000000b0';
  n constant text := md5('34-nonce');
  v_tok text;
BEGIN
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.event_sponsor_exposure_keys k WHERE k.tenant_id = b),
    '34/podpis: najemca B nie ma klucza, dopoki nikt nie podpisal jego sesji');
  v_tok := public._event_sponsor_exposure_token(b, n);
  PERFORM pg_temp.assert(
    (SELECT k.secret ~ '^[0-9a-f]{64}$' FROM public.event_sponsor_exposure_keys k WHERE k.tenant_id = b),
    '34/podpis: klucz zakladany leniwie, 256 bitow hex');
  PERFORM pg_temp.assert(
    v_tok ~ '^[0-9a-f]{64}$' AND left(v_tok, 32) = n
    AND public._event_sponsor_exposure_token(b, n) = v_tok,
    '34/podpis: sesja = nonce + 32 hex HMAC, deterministyczna dla nonce i najemcy');
  PERFORM pg_temp.assert(
    public._event_sponsor_exposure_token(a, n) <> v_tok,
    '34/podpis: ten sam nonce u innego najemcy ma INNY podpis (klucz per najemca)');
  PERFORM pg_temp.assert(
    public._event_sponsor_exposure_token(a, 'za-krotki') IS NULL
    AND public._event_sponsor_exposure_token(a, upper(n)) IS NULL
    AND public._event_sponsor_exposure_token(NULL, n) IS NULL,
    '34/podpis: zly nonce albo brak najemcy - NULL');
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 3: SESJA WYDAWANA PRZEZ SERWER
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  s1 constant text := '34500000-0000-0000-0000-000000000001';
  ad0 constant text := '34d00000-0000-0000-0000-0000000000a0';
  a constant uuid := '11111111-1111-1111-1111-111111111111';
  v_res jsonb;
  v_tok text;
  v_bad text;
BEGIN
  -- Paczka BEZ sesji: serwer wydaje sesje i liczy pod nia te paczke.
  v_res := pg_temp.sxi_ingest(pg_temp.sxi_src('src_a'), NULL,
    jsonb_build_array(pg_temp.sxi_item(s1, 'home_strip', 'view')));
  v_tok := v_res->>'session';
  PERFORM pg_temp.assert(
    (v_res->>'written')::integer = 1 AND v_res->'collapsed' = 'null'::jsonb
    AND v_tok ~ '^[0-9a-f]{64}$'
    AND public._event_sponsor_exposure_token(a, left(v_tok, 32)) = v_tok,
    '34/sesja: paczka bez sesji dostaje PODPISANA sesje serwera i jest pod nia zapisana');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_sponsor_exposure_sessions s
      WHERE s.event_id = '34e00000-0000-0000-0000-0000000000e1') = 1
    AND position(left(v_tok, 32) IN (SELECT string_agg(s.session_hash, ',')
      FROM public.event_sponsor_exposure_sessions s)) = 0,
    '34/sesja: rejestr zrodla ma jedna sesje, zapisana tylko jako skrot');

  -- Ta sama sesja: bez nowego unikalnego, bez nowej sesji w odpowiedzi.
  v_res := pg_temp.sxi_ingest(pg_temp.sxi_src('src_a'), v_tok,
    jsonb_build_array(pg_temp.sxi_item(s1, 'home_strip', 'view')));
  PERFORM pg_temp.assert(
    (v_res->>'written')::integer = 1 AND v_res->'session' = 'null'::jsonb
    AND v_res->'collapsed' = 'null'::jsonb
    AND pg_temp.sxi_rows(s1::uuid, 'home_strip', 'view') = 1
    AND (SELECT x.hits FROM public.event_sponsor_exposures x
          WHERE x.sponsor_id = s1::uuid AND x.placement = 'home_strip' AND x.kind = 'view') = 2,
    '34/sesja: podpisana sesja wraca - hits rosnie, unikalne bez zmian');

  -- Ta sama sesja z INNEGO adresu (telefon zmienil siec): nadal ta sama osoba.
  v_res := pg_temp.sxi_ingest(pg_temp.sxi_src('src_b'), v_tok,
    jsonb_build_array(pg_temp.sxi_item(s1, 'home_strip', 'view')));
  PERFORM pg_temp.assert(
    v_res->'collapsed' = 'null'::jsonb AND pg_temp.sxi_rows(s1::uuid, 'home_strip', 'view') = 1,
    '34/sesja: zmiana adresu nie robi z tej samej sesji nowej osoby');

  -- Podrobiony podpis: kubelek zrodla, anomalia, NOWA sesja w odpowiedzi.
  v_bad := left(v_tok, 63) || CASE WHEN right(v_tok, 1) = '0' THEN '1' ELSE '0' END;
  v_res := pg_temp.sxi_ingest(pg_temp.sxi_src('src_a'), v_bad,
    jsonb_build_array(pg_temp.sxi_item(s1, 'partners_tab', 'click')));
  PERFORM pg_temp.assert(
    (v_res->>'written')::integer = 1 AND v_res->>'collapsed' = 'invalid_session'
    AND (v_res->>'session') ~ '^[0-9a-f]{64}$' AND v_res->>'session' <> v_tok
    AND public._event_sponsor_exposure_token(a, left(v_res->>'session', 32)) = v_res->>'session',
    '34/sesja/podrobka: zly podpis liczy sie do kubelka; odpowiedz niesie nowa, wazna sesje');
  PERFORM pg_temp.assert(
    pg_temp.sxi_anomaly('invalid_session', s1::uuid, 'src_a') = 1,
    '34/sesja/podrobka: anomalia invalid_session przypisana sponsorowi i zrodlu');

  -- Stary klient (32 hex z przegladarki) i sesja obcego najemcy: kubelek.
  -- Dwa ROZNE niepodpisane identyfikatory z jednego adresu = JEDEN unikalny.
  PERFORM pg_temp.sxi_ingest(pg_temp.sxi_src('src_a'), md5('34-stary-klient-1'),
    jsonb_build_array(pg_temp.sxi_item(s1, 'partners_section', 'view')));
  PERFORM pg_temp.sxi_ingest(pg_temp.sxi_src('src_a'), md5('34-stary-klient-2'),
    jsonb_build_array(pg_temp.sxi_item(s1, 'partners_section', 'view')));
  PERFORM pg_temp.sxi_ingest(pg_temp.sxi_src('src_a'),
    public._event_sponsor_exposure_token('34000000-0000-0000-0000-0000000000b0', md5('34-obcy')),
    jsonb_build_array(pg_temp.sxi_item(s1, 'partners_section', 'view')));
  PERFORM pg_temp.assert(
    pg_temp.sxi_rows(s1::uuid, 'partners_section', 'view') = 1
    AND (SELECT x.hits FROM public.event_sponsor_exposures x
          WHERE x.sponsor_id = s1::uuid AND x.placement = 'partners_section') = 3,
    '34/sesja/stary klient: niepodpisane i obce sesje z jednego adresu = jeden unikalny (hits 3)');
  PERFORM pg_temp.assert(
    pg_temp.sxi_anomaly('invalid_session', s1::uuid, 'src_a') = 4,
    '34/sesja/stary klient: kazda zwinieta pozycja doliczona do anomalii');
  -- Kontrapunkt: ten sam niepodpisany identyfikator z INNEGO adresu to inny kubelek.
  PERFORM pg_temp.sxi_ingest(pg_temp.sxi_src('src_b'), md5('34-stary-klient-1'),
    jsonb_build_array(pg_temp.sxi_item(s1, 'partners_section', 'view')));
  PERFORM pg_temp.assert(
    pg_temp.sxi_rows(s1::uuid, 'partners_section', 'view') = 2,
    '34/sesja/stary klient: kubelek jest per zrodlo - inny adres to inny unikalny');

  -- Reklama bez sponsora: anomalia na poziomie wydarzenia (sponsor NULL).
  PERFORM pg_temp.sxi_ingest(pg_temp.sxi_src('src_a'), md5('34-stary-klient-3'),
    jsonb_build_array(pg_temp.sxi_item(NULL, 'home_ad', 'view', ad0)));
  PERFORM pg_temp.assert(
    pg_temp.sxi_anomaly('invalid_session', NULL, 'src_a') = 1,
    '34/sesja: zwinieta reklama bez sponsora to anomalia poziomu wydarzenia');
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 4: ODRZUCENIA BEZ ZAPISU
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  s1 constant text := '34500000-0000-0000-0000-000000000001';
  v_before integer := (SELECT count(*) FROM public.event_sponsor_exposures);
  v_anom integer := (SELECT count(*) FROM public.event_sponsor_exposure_anomalies);
BEGIN
  PERFORM pg_temp.assert(
    (pg_temp.sxi_ingest('203.0.113.7', NULL, jsonb_build_array(pg_temp.sxi_item(s1, 'home_strip', 'view')))->>'written')::integer = 0
    AND (pg_temp.sxi_ingest(NULL, NULL, jsonb_build_array(pg_temp.sxi_item(s1, 'home_strip', 'view')))->>'written')::integer = 0
    AND (pg_temp.sxi_ingest('ip:' || repeat('g', 32), NULL, jsonb_build_array(pg_temp.sxi_item(s1, 'home_strip', 'view')))->>'written')::integer = 0,
    '34/odmowa: zrodlo spoza ksztaltu (surowy adres, NULL, nie-hex) nie zapisuje niczego');
  PERFORM pg_temp.assert(
    (pg_temp.sxi_ingest(pg_temp.sxi_src('src_a'), 'krotka', jsonb_build_array(pg_temp.sxi_item(s1, 'home_strip', 'view')))->>'written')::integer = 0
    AND pg_temp.sxi_ingest(pg_temp.sxi_src('src_a'), NULL, jsonb_build_array(pg_temp.sxi_item(s1, 'home_strip', 'view')), 'nie-ma-takiego')->'session' = 'null'::jsonb,
    '34/odmowa: sesja spoza ksztaltu i nieznane wydarzenie - bez zapisu i bez wydania sesji');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_sponsor_exposures) = v_before
    AND (SELECT count(*) FROM public.event_sponsor_exposure_anomalies) = v_anom,
    '34/odmowa: odrzucenia nie zostawiaja ani ekspozycji, ani anomalii');
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 5: KRYTERIUM AUDYTU - 1000 SESJI Z JEDNEGO ADRESU
--
-- Skrypt nie przechowuje sesji: kazda paczka idzie BEZ sesji, wiec serwer
-- wydaje nowa za kazdym razem. Limit zapytan przepuszcza 300 paczek w oknie
-- (now() stale w transakcji), z nich 49 dostaje wlasna sesje, 251 zwija sie
-- do kubelka zrodla (N = 50 unikalnych, kubelek wliczony); 700 odrzuca limit.
-- S2 / home_strip jest uzywane tylko tutaj, wiec liczba wierszy = liczba
-- unikalnych wyswietlen S2.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  s2 constant text := '34500000-0000-0000-0000-000000000002';
  v_res jsonb;
  v_issued integer := 0;
  v_last jsonb;
  i integer;
BEGIN
  FOR i IN 1..1000 LOOP
    v_res := pg_temp.sxi_ingest(pg_temp.sxi_src('src_c'), NULL,
      jsonb_build_array(pg_temp.sxi_item(s2, 'home_strip', 'view')));
    IF v_res->>'session' IS NOT NULL THEN
      v_issued := v_issued + 1;
    END IF;
    v_last := v_res;
  END LOOP;

  PERFORM pg_temp.assert(
    pg_temp.sxi_rows(s2::uuid, 'home_strip', 'view') <= 50,
    format('34/AUDYT: 1000 sesji z jednego adresu daje najwyzej N = 50 unikalnych wyswietlen (jest %s)',
      pg_temp.sxi_rows(s2::uuid, 'home_strip', 'view')));
  PERFORM pg_temp.assert(
    pg_temp.sxi_rows(s2::uuid, 'home_strip', 'view') = 50,
    '34/AUDYT: dokladnie 49 sesji zrodla + 1 kubelek - limit nie zjada pierwszych 49 osob');
  PERFORM pg_temp.assert(
    (SELECT sum(x.hits) FROM public.event_sponsor_exposures x
      WHERE x.sponsor_id = s2::uuid AND x.placement = 'home_strip') = 300,
    '34/AUDYT: suma wyswietlen = 300 paczek przepuszczonych przez limit zapytan');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_sponsor_exposure_sessions s
      WHERE s.source_hash = encode(public.digest(
        'src:11111111-1111-1111-1111-111111111111:34e00000-0000-0000-0000-0000000000e1:'
        || pg_temp.sxi_src('src_c') || ':' || ((now() AT TIME ZONE 'Europe/Warsaw')::date)::text,
        'sha256'), 'hex')) = 49,
    '34/AUDYT: rejestr zrodla trzyma dokladnie 49 sesji');
  PERFORM pg_temp.assert(
    pg_temp.sxi_anomaly('session_cap', s2::uuid, 'src_c') = 251,
    '34/AUDYT: 251 pozycji ponad limit sesji zapisane jako anomalia session_cap');
  PERFORM pg_temp.assert(
    pg_temp.sxi_anomaly('rate_limited', NULL, 'src_c') = 700,
    '34/AUDYT: 700 paczek odrzuconych limitem zapytan zapisane jako anomalia rate_limited');
  PERFORM pg_temp.assert(
    v_issued = 300 AND v_last->>'collapsed' = 'rate_limited' AND v_last->'session' = 'null'::jsonb
    AND (v_last->>'written')::integer = 0,
    '34/AUDYT: odrzucona paczka nie dostaje sesji i niczego nie zapisuje');

  -- Kontrapunkt: inny adres nie dzieli limitu skryptu.
  v_res := pg_temp.sxi_ingest(pg_temp.sxi_src('src_d'), NULL,
    jsonb_build_array(pg_temp.sxi_item(s2, 'home_strip', 'view')));
  PERFORM pg_temp.assert(
    v_res->'collapsed' = 'null'::jsonb AND pg_temp.sxi_rows(s2::uuid, 'home_strip', 'view') = 51,
    '34/AUDYT: inny adres liczy sie normalnie (limit jest per zrodlo)');
END
$do$;

-- ---------------------------------------------------------------------------
-- SEKCJA 6: SYGNATURA, GRANTY, RLS
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  to_regprocedure('public.event_sponsor_exposure_ingest(uuid, jsonb)') IS NULL
  AND to_regprocedure('public.event_sponsor_exposure_ingest(uuid, text, jsonb)') IS NOT NULL,
  '34/sygnatura: stara (bez zrodla) usunieta - brak przeciazenia omijajacego limit');
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.event_sponsor_exposure_ingest(uuid, text, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.event_sponsor_exposure_ingest(uuid, text, jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.event_sponsor_exposure_ingest(uuid, text, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_sponsor_exposure_token(uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_sponsor_exposure_token(uuid, text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_sponsor_exposure_token(uuid, text)', 'EXECUTE'),
  '34/granty: zapis i podpis sesji wylacznie dla service_role');
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.admin_event_sponsor_exposure_anomalies(uuid, uuid, date, date)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_sponsor_exposure_anomalies(uuid, uuid, date, date)', 'EXECUTE'),
  '34/granty: RPC anomalii dla zalogowanych (bramka roli w srodku), nie dla anonima');
SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relrowsecurity
      AND c.relname IN ('event_sponsor_exposure_keys', 'event_sponsor_exposure_sessions',
                        'event_sponsor_exposure_anomalies')) = 3
  AND (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('event_sponsor_exposure_keys', 'event_sponsor_exposure_sessions',
                            'event_sponsor_exposure_anomalies')) = 0,
  '34/RLS: trzy nowe tabele z RLS i bez zadnej polityki');

SET ROLE authenticated;
SELECT pg_temp.assert_raises_like('SELECT count(*) FROM public.event_sponsor_exposure_keys',
  'permission denied', '34/RLS: zalogowany nie czyta kluczy podpisu');
SELECT pg_temp.assert_raises_like('SELECT count(*) FROM public.event_sponsor_exposure_sessions',
  'permission denied', '34/RLS: zalogowany nie czyta rejestru sesji');
SELECT pg_temp.assert_raises_like('SELECT count(*) FROM public.event_sponsor_exposure_anomalies',
  'permission denied', '34/RLS: zalogowany nie czyta anomalii wprost');
SELECT pg_temp.assert_raises_like($q$SELECT public.event_sponsor_exposure_ingest(
    '11111111-1111-1111-1111-111111111111', 'ip:' || md5('x'), '{}'::jsonb)$q$,
  'permission denied', '34/granty: zalogowany nie wola zapisu ekspozycji');
RESET ROLE;
SET ROLE anon;
SELECT pg_temp.assert_raises_like('SELECT count(*) FROM public.event_sponsor_exposure_keys',
  'permission denied', '34/RLS: anonim nie czyta kluczy podpisu');
SELECT pg_temp.assert_raises_like($q$SELECT public._event_sponsor_exposure_token(
    '11111111-1111-1111-1111-111111111111', md5('x'))$q$,
  'permission denied', '34/granty: anonim nie podpisze sobie sesji');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- SEKCJA 7: RPC PANELU - ANOMALIE W RAPORCIE SPONSORA
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('34a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
-- Wiersz panelu = dzien x powod; suma po dniach (tu jeden dzien).
CREATE FUNCTION pg_temp.sxi_panel(_reason text, _sponsor uuid DEFAULT NULL)
RETURNS TABLE (hits integer, sources integer, days integer) LANGUAGE sql AS $$
  SELECT sum(r.hits)::integer, sum(r.sources)::integer, count(*)::integer
    FROM public.admin_event_sponsor_exposure_anomalies('34e00000-0000-0000-0000-0000000000e1', _sponsor) r
   WHERE r.reason = _reason
$$;
DO $do$
DECLARE
  e1 constant uuid := '34e00000-0000-0000-0000-0000000000e1';
  s1 constant uuid := '34500000-0000-0000-0000-000000000001';
  s2 constant uuid := '34500000-0000-0000-0000-000000000002';
BEGIN
  PERFORM pg_temp.assert(
    (SELECT p.hits = 700 AND p.sources = 1 FROM pg_temp.sxi_panel('rate_limited') p)
    AND (SELECT p.hits = 251 AND p.sources = 1 AND p.days = 1 FROM pg_temp.sxi_panel('session_cap') p)
    AND (SELECT r.day FROM public.admin_event_sponsor_exposure_anomalies(e1) r
          WHERE r.reason = 'session_cap') = (now() AT TIME ZONE 'Europe/Warsaw')::date,
    '34/panel: admin widzi anomalie wydarzenia z licznikami, liczba zrodel i dniem w strefie wydarzenia');
  PERFORM pg_temp.assert(
    (SELECT p.hits = 6 AND p.sources = 2 FROM pg_temp.sxi_panel('invalid_session') p),
    '34/panel: niepodpisane - 6 pozycji (5 sponsora S1 + reklama), dwa zrodla bez dublowania adresu');
  PERFORM pg_temp.assert(
    (SELECT p.hits = 6 FROM pg_temp.sxi_panel('invalid_session', s1) p)
    AND (SELECT p.hits IS NULL FROM pg_temp.sxi_panel('session_cap', s1) p)
    AND (SELECT p.hits = 700 FROM pg_temp.sxi_panel('rate_limited', s1) p),
    '34/panel: filtr S1 - jego zwiniecia i poziom wydarzenia, bez limitu sesji sponsora S2');
  PERFORM pg_temp.assert(
    (SELECT p.hits = 251 FROM pg_temp.sxi_panel('session_cap', s2) p)
    AND (SELECT p.hits = 1 FROM pg_temp.sxi_panel('invalid_session', s2) p),
    '34/panel: filtr S2 - jego limit sesji, a z niepodpisanych tylko reklama bez sponsora');
END
$do$;
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.admin_event_sponsor_exposure_anomalies(
    '34e00000-0000-0000-0000-0000000000e1', NULL, current_date + 5, current_date + 6)),
  '34/panel: zakres dni bez anomalii - pusto');
SELECT pg_temp.assert_raises_like($q$SELECT * FROM public.admin_event_sponsor_exposure_anomalies(
    '34e00000-0000-0000-0000-0000000000e1', NULL, current_date, current_date - 1)$q$,
  'invalid_range', '34/panel/ODMOWA: poczatek zakresu po koncu');
SELECT pg_temp.assert_raises_like($q$SELECT * FROM public.admin_event_sponsor_exposure_anomalies(
    '34e00000-0000-0000-0000-0000000000eb')$q$,
  'not_found', '34/panel/izolacja: admin A nie czyta anomalii wydarzenia najemcy B');

SELECT pg_temp.act_as('34a00000-0000-0000-0000-0000000000b1', '34000000-0000-0000-0000-0000000000b0');
SELECT pg_temp.assert_raises_like($q$SELECT * FROM public.admin_event_sponsor_exposure_anomalies(
    '34e00000-0000-0000-0000-0000000000e1')$q$,
  'not_found', '34/panel/izolacja: admin B nie czyta anomalii wydarzenia najemcy A');

SELECT pg_temp.act_as('34a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises($q$SELECT * FROM public.admin_event_sponsor_exposure_anomalies(
    '34e00000-0000-0000-0000-0000000000e1')$q$,
  '34/panel/ODMOWA: redaktor nie czyta anomalii (bramka admina wydarzen)');

SELECT pg_temp.act_as();
SELECT pg_temp.assert_raises_like($q$SELECT * FROM public.admin_event_sponsor_exposure_anomalies(
    '34e00000-0000-0000-0000-0000000000e1')$q$,
  'forbidden', '34/panel/ODMOWA: anonim nie czyta anomalii');

-- ---------------------------------------------------------------------------
-- SEKCJA 8: RETENCJA, KASKADA, ZASLEPKA REKLAMY
-- ---------------------------------------------------------------------------
INSERT INTO public.event_sponsor_exposure_sessions (tenant_id, event_id, day, source_hash, session_hash)
VALUES ('11111111-1111-1111-1111-111111111111', '34e00000-0000-0000-0000-0000000000e1',
        current_date - 5, repeat('c', 64), repeat('d', 64));
INSERT INTO public.event_sponsor_exposure_anomalies
  (tenant_id, event_id, sponsor_id, day, reason, source_hash, hits, first_at, last_at)
VALUES ('11111111-1111-1111-1111-111111111111', '34e00000-0000-0000-0000-0000000000e1',
        NULL, current_date - 500, 'rate_limited', repeat('e', 64), 9,
        now() - interval '500 days', now() - interval '500 days');
DO $do$
DECLARE
  v_fresh_sessions integer := (SELECT count(*) FROM public.event_sponsor_exposure_sessions s
                                WHERE s.day >= current_date - 1);
  v_fresh_anomalies integer := (SELECT count(*) FROM public.event_sponsor_exposure_anomalies a
                                 WHERE a.day >= current_date - 30);
BEGIN
  PERFORM public.event_sponsor_exposures_prune();
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.event_sponsor_exposure_sessions s WHERE s.session_hash = repeat('d', 64))
    AND NOT EXISTS (SELECT 1 FROM public.event_sponsor_exposure_anomalies a WHERE a.source_hash = repeat('e', 64)),
    '34/retencja: rejestr sesji starszy niz 2 dni i anomalie starsze niz horyzont usuniete');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_sponsor_exposure_sessions s WHERE s.day >= current_date - 1) = v_fresh_sessions
    AND (SELECT count(*) FROM public.event_sponsor_exposure_anomalies a WHERE a.day >= current_date - 30) = v_fresh_anomalies
    AND v_fresh_sessions > 0 AND v_fresh_anomalies > 0,
    '34/retencja: dzisiejszy rejestr sesji i swieze anomalie zostaja');
END
$do$;

DELETE FROM public.event_sponsors s WHERE s.id = '34500000-0000-0000-0000-000000000002';
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.event_sponsor_exposure_anomalies a
               WHERE a.sponsor_id = '34500000-0000-0000-0000-000000000002')
  AND EXISTS (SELECT 1 FROM public.event_sponsor_exposure_anomalies a
               WHERE a.event_id = '34e00000-0000-0000-0000-0000000000e1' AND a.sponsor_id IS NULL),
  '34/kaskada: usuniecie przypiecia sponsora zabiera jego anomalie, poziom wydarzenia zostaje');

SELECT pg_temp.assert(
  public.event_home_ad_track('34d00000-0000-0000-0000-0000000000a0', 'view', md5('34-reklama')) = false
  AND NOT EXISTS (SELECT 1 FROM public.event_home_ad_events v
                   WHERE v.ad_id = '34d00000-0000-0000-0000-0000000000a0'),
  '34/reklama: event_home_ad_track to nadal pusta zaslepka - nie ma czego nabic');

ROLLBACK;

\echo '== 34 integralnosc pomiaru ekspozycji sponsorow: koniec =='
