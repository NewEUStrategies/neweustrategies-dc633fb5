-- ============================================================================
-- 42_cfp - NABOR PRELEGENTOW: ZGLOSZENIE, OCENA, DECYZJA, PRZYJECIE, PANEL
--
-- PO CO TEN PLIK ISTNIEJE
-- Migracja 20260926100000_event_cfp.sql stawia siedem tabel i kilkadziesiat
-- funkcji na czterech plaszczyznach (panel, tresc, wlasna, recenzent).
-- Bramki tekstowe widza tylko KSZTALT tych funkcji. To, czy recenzent nie
-- ocenia wlasnego zgloszenia, czy ocena w ciemno naprawde ukrywa tozsamosc,
-- czy limit zgloszen dziala, czy przyjecie trafia do TEGO SAMEGO rejestru
-- prelegentow co reszta modulu i czy CRM dostaje tylko to, co wolno - widac
-- dopiero przy WYKONANIU. Kazda z tych obietnic ma tu dowod z oboma bokami.
--
-- CZEGO TU DOWODZIMY
--   (a) katalog: RLS na kazdej tabeli, polityki tylko do odczytu (admin OR
--       super_admin, bez editor), brak grantow zapisu i odczytu dla anon,
--       funkcje wewnetrzne niewykonywalne dla klienta;
--   (b) bramki panelu: anonim, redaktor i admin obcego najemcy odbijaja sie;
--   (c) ustawienia: wartosci domyslne bez zapisu, walidacja kazdego pola,
--       PATCH po obecnosci klucza, fazy liczone zegarem bazy;
--   (d) pytania formularza: klucz, typ, etykiety, opcje, kolejnosc;
--   (e) strona publiczna: szkic naboru nic nie zdradza, obcy host nic nie widzi;
--   (f) zgloszenie: kartoteka po koncie, odpowiedzi, wspolprelegenci, limit,
--       zamkniety nabor, walidacja wyslania, zdarzenie domenowe, CRM;
--   (g) recenzent: czlonkostwo, zakres sciezek, ocena w ciemno, wlasne
--       zgloszenie wykluczone, walidacja oceny, pierwsza ocena -> under_review;
--   (h) panel: lista bez szkicow, agregaty, szczegol, liczniki;
--   (i) decyzja: notatka przy odrzuceniu, poprawki -> ponowne wyslanie, CRM
--       tylko wzbogaca i nie dostaje notatki;
--   (j) przyjecie: rejestr prelegentow, kartoteka wspolprelegenta, grupa,
--       zapis, szkic sesji z obsada, CRM speaker, kolizja sali cofa wszystko;
--   (k) odpowiedz prelegenta, panel prelegenta, profil, materialy;
--   (l) powiadomienia, wycofanie, recenzent z ocenami tylko dezaktywowany;
--   (m) RLS przez SET ROLE i izolacja najemcow;
--   (n) eksport RODO wolajacego: zakres i wylaczenia.
--
-- CZEGO NIE SPRAWDZA: wysylki poczty (funkcje serwerowe - testy vitest).
--
-- DLACZEGO CZESC ASERCJI CZYTA KATALOG. Harness pracuje jako wlasciciel bazy,
-- a wlasciciel omija RLS - polityki sprawdzamy katalogiem i dodatkowo
-- wykonaniem pod `SET ROLE authenticated` (sekcja m).
--
-- SPRZATANIE. Caly plik pracuje w transakcji zakonczonej ROLLBACK-iem.
-- ============================================================================

\echo '== 42 nabor prelegentow: zgloszenia, ocena, decyzja, panel prelegenta =='

BEGIN;

-- ---------------------------------------------------------------------------
-- ATRAPY SPOZA MODULU (w tej transakcji, cofane ROLLBACK-iem)
--
-- `rate_limit_hit` (bramka czestotliwosci szkicu i wyslania) - ksztalt jak
-- w 20_registration (20260724221149), zakladany tylko gdy go nie ma.
-- `speaker_profiles` w harness.sql jest wezszy od produkcji - dokladamy
-- kolumny, ktore czyta panel prelegenta i przyjecie (20260727200000).
-- ---------------------------------------------------------------------------
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'rate_limit_hit') THEN
    CREATE TABLE public.rate_limits (
      scope        text NOT NULL,
      subject_id   text NOT NULL,
      window_start timestamptz NOT NULL,
      count        integer NOT NULL DEFAULT 0,
      PRIMARY KEY (scope, subject_id, window_start)
    );
    CREATE FUNCTION public.rate_limit_hit(
      _scope text, _subject text, _max integer, _window_minutes integer DEFAULT 1
    ) RETURNS TABLE(allowed boolean, hits integer, bucket_start timestamptz)
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $rl$
    DECLARE
      v_win integer := GREATEST(1, COALESCE(_window_minutes, 1));
      v_sec integer := v_win * 60;
      v_start timestamptz := to_timestamp(
        (floor(extract(epoch FROM now()) / v_sec) * v_sec)::double precision);
      v_count integer;
    BEGIN
      INSERT INTO public.rate_limits AS rl (scope, subject_id, window_start, count)
      VALUES (_scope, _subject, v_start, 1)
      ON CONFLICT (scope, subject_id, window_start) DO UPDATE SET count = rl.count + 1
      RETURNING rl.count INTO v_count;
      RETURN QUERY SELECT (v_count <= GREATEST(1, _max)), v_count, v_start;
    END $rl$;
  END IF;
END
$do$;

ALTER TABLE public.speaker_profiles
  ADD COLUMN IF NOT EXISTS topics_pl text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS topics_en text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS languages text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS crm_lead_id uuid;

-- ---------------------------------------------------------------------------
-- SCENOGRAFIA
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('42000000-0000-0000-0000-0000000000b0', 'Tenant 42 B', 't42b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('42a00000-0000-0000-0000-0000000000a1', 'cfp.admin@example.org'),
  ('42a00000-0000-0000-0000-0000000000a2', 'cfp.redaktor@example.org'),
  ('42a00000-0000-0000-0000-000000000051', 'Prelegent.Jeden@Example.org'),
  ('42a00000-0000-0000-0000-000000000052', 'inny.uzytkownik@example.org'),
  ('42a00000-0000-0000-0000-000000000061', 'recenzent.jeden@example.org'),
  ('42a00000-0000-0000-0000-000000000062', 'recenzent.dwa@example.org'),
  ('42a00000-0000-0000-0000-000000000063', 'wspolprelegent@example.org'),
  ('42a00000-0000-0000-0000-0000000000b1', 'cfp.admin.b@example.org'),
  ('42a00000-0000-0000-0000-0000000000b2', 'uzytkownik.b@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('42a00000-0000-0000-0000-0000000000a1', 'admin', '11111111-1111-1111-1111-111111111111'),
  ('42a00000-0000-0000-0000-0000000000a2', 'editor', '11111111-1111-1111-1111-111111111111'),
  ('42a00000-0000-0000-0000-0000000000b1', 'admin', '42000000-0000-0000-0000-0000000000b0')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, slug) VALUES
  ('42a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Admin 42', 'cfp-admin'),
  ('42a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Redaktor 42', 'cfp-redaktor'),
  ('42a00000-0000-0000-0000-000000000051', '11111111-1111-1111-1111-111111111111', 'Prelegent 42', 'cfp-prelegent'),
  ('42a00000-0000-0000-0000-000000000052', '11111111-1111-1111-1111-111111111111', 'Inny 42', 'cfp-inny'),
  ('42a00000-0000-0000-0000-000000000061', '11111111-1111-1111-1111-111111111111', 'Recenzent Jeden', 'cfp-rec-1'),
  ('42a00000-0000-0000-0000-000000000062', '11111111-1111-1111-1111-111111111111', 'Recenzent Dwa', 'cfp-rec-2'),
  ('42a00000-0000-0000-0000-000000000063', '11111111-1111-1111-1111-111111111111', 'Wspol 42', 'cfp-wspol'),
  ('42a00000-0000-0000-0000-0000000000b1', '42000000-0000-0000-0000-0000000000b0', 'Admin 42 B', 'cfp-admin-b'),
  ('42a00000-0000-0000-0000-0000000000b2', '42000000-0000-0000-0000-0000000000b0', 'Uzytkownik 42 B', 'cfp-user-b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, status) VALUES
  ('42e00000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111',
   'cfp-42', 'Kongres 42', 'Congress 42', now() + interval '30 days', now() + interval '32 days', 'published'),
  ('42e00000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111',
   'cfp-42-szkic', 'Szkic 42', 'Draft 42', now() + interval '60 days', NULL, 'draft'),
  ('42e00000-0000-0000-0000-0000000000b1', '42000000-0000-0000-0000-0000000000b0',
   'cfp-42', 'Kongres B', 'Congress B', now() + interval '30 days', NULL, 'published')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_tracks (id, tenant_id, event_id, key, name_pl, name_en) VALUES
  ('42700000-0000-0000-0000-000000000071', '11111111-1111-1111-1111-111111111111',
   '42e00000-0000-0000-0000-0000000000e1', 'energia', 'Energia', 'Energy'),
  ('42700000-0000-0000-0000-000000000072', '11111111-1111-1111-1111-111111111111',
   '42e00000-0000-0000-0000-0000000000e1', 'finanse', 'Finanse', 'Finance'),
  ('42700000-0000-0000-0000-000000000079', '11111111-1111-1111-1111-111111111111',
   '42e00000-0000-0000-0000-0000000000e2', 'obca', 'Obca sciezka', 'Foreign track')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_rooms (id, tenant_id, event_id, name) VALUES
  ('42800000-0000-0000-0000-000000000081', '11111111-1111-1111-1111-111111111111',
   '42e00000-0000-0000-0000-0000000000e1', 'Sala A')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_ticket_types (id, tenant_id, event_id, key, name_pl, name_en) VALUES
  ('42900000-0000-0000-0000-000000000091', '11111111-1111-1111-1111-111111111111',
   '42e00000-0000-0000-0000-0000000000e1', 'prelegent', 'Prelegent', 'Speaker')
ON CONFLICT (id) DO NOTHING;

-- Identyfikatory powstajace w trakcie (zgloszenia, oceny) - miedzy blokami DO.
CREATE TEMP TABLE t42 (name text PRIMARY KEY, id uuid NOT NULL) ON COMMIT DROP;

-- ---------------------------------------------------------------------------
-- (a) KATALOG: RLS, POLITYKI, GRANTY, FUNKCJE WEWNETRZNE
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relrowsecurity
      AND c.relname IN ('event_cfp_settings', 'event_cfp_fields', 'event_cfp_submissions',
        'event_cfp_submission_speakers', 'event_cfp_reviewers', 'event_cfp_reviews',
        'event_speaker_materials')) = 7,
  '42/(a): RLS wlaczone na wszystkich siedmiu tabelach naboru');

SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename IN ('event_cfp_settings', 'event_cfp_fields', 'event_cfp_submissions',
        'event_cfp_submission_speakers', 'event_cfp_reviewers', 'event_cfp_reviews',
        'event_speaker_materials')
      AND p.cmd = 'SELECT' AND p.roles = '{authenticated}'
      AND p.qual LIKE '%current_tenant_id%' AND p.qual LIKE '%is_super_admin%'
      AND p.qual NOT LIKE '%editor%') = 7,
  '42/(a): kazda tabela ma polityke odczytu admin/super_admin najemcy, bez redaktora');

SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename IN ('event_cfp_settings', 'event_cfp_fields', 'event_cfp_submissions',
        'event_cfp_submission_speakers', 'event_cfp_reviewers', 'event_cfp_reviews',
        'event_speaker_materials')
      AND p.cmd <> 'SELECT'),
  '42/(a): zadnej polityki zapisu - zapis wylacznie przez SECURITY DEFINER');

SELECT pg_temp.assert(
  NOT has_table_privilege('anon', 'public.event_cfp_submissions', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.event_cfp_submissions', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.event_cfp_reviews', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.event_speaker_materials', 'DELETE')
  AND has_table_privilege('authenticated', 'public.event_cfp_settings', 'SELECT'),
  '42/(a): anon bez odczytu, klient bez zapisu, odczyt tylko przez polityke');

SELECT pg_temp.assert(
  NOT has_function_privilege('authenticated', 'public._event_cfp_resolve_person(uuid, uuid, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_speaker_roster_add(uuid, uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_cfp_crm_status(uuid, uuid, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_cfp_reviewable(uuid, uuid, uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public._event_cfp_clean_answers(uuid, uuid, jsonb)', 'EXECUTE'),
  '42/(a): funkcje wewnetrzne niewykonywalne dla klienta');

SELECT pg_temp.assert(
  has_function_privilege('anon', 'public.event_cfp_public(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.event_cfp_submission_save(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admin_event_cfp_settings_save(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.event_cfp_review_save(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.event_cfp_review_save(jsonb)', 'EXECUTE'),
  '42/(a): strona naboru dla anonima; zapisy tylko dla zalogowanych');

-- ---------------------------------------------------------------------------
-- (b) BRAMKI PANELU
-- ---------------------------------------------------------------------------
DO $do$
BEGIN
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_get('42e00000-0000-0000-0000-0000000000e1')$$,
    'forbidden', '42/(b): anonim nie czyta ustawien naboru');

  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_save('{"event_id":"42e00000-0000-0000-0000-0000000000e1","status":"open"}')$$,
    'forbidden', '42/(b): redaktor nie zapisze ustawien naboru');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT * FROM public.admin_event_cfp_submissions_list('{"event_id":"42e00000-0000-0000-0000-0000000000e1"}')$$,
    'forbidden', '42/(b): redaktor nie widzi listy zgloszen');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_reviewer_set('{"event_id":"42e00000-0000-0000-0000-0000000000e1","user_id":"42a00000-0000-0000-0000-0000000000a2"}')$$,
    'forbidden', '42/(b): redaktor nie mianuje sie recenzentem');

  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000052');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_submissions_counts('42e00000-0000-0000-0000-0000000000e1')$$,
    'forbidden', '42/(b): zwykly uzytkownik nie widzi licznikow panelu');

  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-0000000000b1', '42000000-0000-0000-0000-0000000000b0');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_get('42e00000-0000-0000-0000-0000000000e1')$$,
    'not_found', '42/(b): admin najemcy B nie widzi wydarzenia najemcy A');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_save('{"event_id":"42e00000-0000-0000-0000-0000000000e1","status":"open"}')$$,
    'not_found', '42/(b): admin najemcy B nie zapisze naboru najemcy A');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT * FROM public.admin_event_cfp_fields_list('42e00000-0000-0000-0000-0000000000e1')$$,
    'not_found', '42/(b): admin najemcy B nie czyta pytan najemcy A');
END
$do$;

-- ---------------------------------------------------------------------------
-- (c) USTAWIENIA NABORU
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v jsonb;
  v_speakers uuid;
BEGIN
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  SELECT g.id INTO v_speakers FROM public.event_groups g
   WHERE g.event_id = '42e00000-0000-0000-0000-0000000000e1' AND g.key = 'speakers';

  v := public.admin_event_cfp_settings_get('42e00000-0000-0000-0000-0000000000e1');
  PERFORM pg_temp.assert(
    (v->>'exists')::boolean = false AND v->>'status' = 'draft' AND v->>'phase' = 'none'
    AND (v->>'is_open')::boolean = false AND (v->>'score_max')::int = 5
    AND v_speakers IS NOT NULL AND (v->>'speaker_group_id')::uuid = v_speakers,
    '42/(c): brak wiersza = wartosci domyslne (szkic, grupa speakers) BEZ zapisu');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.event_cfp_settings s WHERE s.event_id = '42e00000-0000-0000-0000-0000000000e1'),
    '42/(c): odczyt ustawien niczego nie zapisuje');
  PERFORM pg_temp.assert(
    jsonb_array_length(v->'options'->'tracks') = 2 AND jsonb_array_length(v->'options'->'rooms') = 1
    AND jsonb_array_length(v->'options'->'tickets') = 1 AND jsonb_array_length(v->'options'->'groups') >= 1,
    '42/(c): listy wyboru niosa sciezki, sale, bilety i grupy TEGO wydarzenia');

  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_save('{"event_id":"42e00000-0000-0000-0000-0000000000e1","status":"wide_open"}')$$,
    'invalid_status', '42/(c): nieznany stan naboru odrzucony');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_save('{"event_id":"42e00000-0000-0000-0000-0000000000e1","opens_at":"2099-02-01T00:00:00Z","closes_at":"2099-01-01T00:00:00Z"}')$$,
    'invalid_window', '42/(c): zamkniecie przed otwarciem odrzucone');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_save('{"event_id":"42e00000-0000-0000-0000-0000000000e1","opens_at":"jutro"}')$$,
    'invalid_window', '42/(c): nieczytelna data odrzucona nazwanym bledem');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_save('{"event_id":"42e00000-0000-0000-0000-0000000000e1","formats":[{"key":"talk","label_pl":"Wyklad","label_en":"Talk","duration_min":2}]}')$$,
    'invalid_formats', '42/(c): forma krotsza niz 5 minut odrzucona');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_save('{"event_id":"42e00000-0000-0000-0000-0000000000e1","formats":[{"key":"talk","label_pl":"A","label_en":"A","duration_min":20},{"key":"talk","label_pl":"B","label_en":"B","duration_min":30}]}')$$,
    'invalid_formats', '42/(c): zdublowany klucz formy odrzucony');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_save('{"event_id":"42e00000-0000-0000-0000-0000000000e1","formats":{"key":"talk"}}')$$,
    'invalid_formats', '42/(c): formy nie jako lista odrzucone');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_save('{"event_id":"42e00000-0000-0000-0000-0000000000e1","review_criteria":[{"key":"tresc","label_pl":"Tresc","label_en":"Content","weight":11}]}')$$,
    'invalid_criteria', '42/(c): waga kryterium spoza 1-10 odrzucona');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_save('{"event_id":"42e00000-0000-0000-0000-0000000000e1","review_criteria":"tresc"}')$$,
    'invalid_criteria', '42/(c): kryteria nie jako lista odrzucone');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_save('{"event_id":"42e00000-0000-0000-0000-0000000000e1","track_ids":["42700000-0000-0000-0000-000000000079"]}')$$,
    'invalid_tracks', '42/(c): sciezka INNEGO wydarzenia odrzucona');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_save('{"event_id":"42e00000-0000-0000-0000-0000000000e1","track_ids":["nie-uuid"]}')$$,
    'invalid_tracks', '42/(c): identyfikator sciezki w zlym ksztalcie odrzucony nazwanym bledem');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_save('{"event_id":"42e00000-0000-0000-0000-0000000000e1","track_ids":"energia"}')$$,
    'invalid_tracks', '42/(c): sciezki nie jako lista odrzucone');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_save('{"event_id":"42e00000-0000-0000-0000-0000000000e1","max_per_submitter":0}')$$,
    'invalid_limit', '42/(c): limit zgloszen 0 odrzucony');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_save('{"event_id":"42e00000-0000-0000-0000-0000000000e1","score_max":11}')$$,
    'invalid_score_max', '42/(c): skala ocen 11 odrzucona');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_save('{"event_id":"42e00000-0000-0000-0000-0000000000e1","min_reviews":21}')$$,
    'invalid_min_reviews', '42/(c): minimum 21 ocen odrzucone');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_save('{"event_id":"42e00000-0000-0000-0000-0000000000e1","speaker_group_id":"42700000-0000-0000-0000-000000000071"}')$$,
    'invalid_group', '42/(c): grupa spoza wydarzenia odrzucona');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_save('{"event_id":"42e00000-0000-0000-0000-0000000000e1","speaker_ticket_type_id":"42700000-0000-0000-0000-000000000071"}')$$,
    'invalid_ticket', '42/(c): bilet spoza wydarzenia odrzucony');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_settings_save('{"event_id":"42e00000-0000-0000-0000-0000000000e1","intro_pl":"%s"}')$$, repeat('x', 8001)),
    'invalid_texts', '42/(c): tekst ponad 8000 znakow odrzucony');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_save('{"status":"open"}')$$,
    'invalid_payload', '42/(c): zapis bez wydarzenia odrzucony');

  v := public.admin_event_cfp_settings_save(jsonb_build_object(
    'event_id', '42e00000-0000-0000-0000-0000000000e1',
    'status', 'open',
    'opens_at', now() - interval '1 day',
    'closes_at', now() + interval '10 days',
    'intro_pl', 'Zapraszamy prelegentow.',
    'intro_en', 'Speakers welcome.',
    'formats', jsonb_build_array(
      jsonb_build_object('key', 'talk', 'label_pl', 'Wyklad', 'label_en', 'Talk', 'duration_min', 30),
      jsonb_build_object('key', 'panel', 'label_pl', 'Panel', 'label_en', 'Panel', 'duration_min', 60)),
    'track_ids', jsonb_build_array('42700000-0000-0000-0000-000000000071', '42700000-0000-0000-0000-000000000072'),
    'max_per_submitter', 2,
    'review_criteria', jsonb_build_array(
      jsonb_build_object('key', 'tresc', 'label_pl', 'Tresc', 'label_en', 'Content', 'weight', 3),
      jsonb_build_object('key', 'forma', 'label_pl', 'Forma', 'label_en', 'Form', 'weight', 1)),
    'speaker_ticket_type_id', '42900000-0000-0000-0000-000000000091'
  ));
  PERFORM pg_temp.assert(
    (v->>'exists')::boolean AND v->>'status' = 'open' AND v->>'phase' = 'open' AND (v->>'is_open')::boolean
    AND jsonb_array_length(v->'formats') = 2 AND jsonb_array_length(v->'track_ids') = 2
    AND (v->>'max_per_submitter')::int = 2 AND (v->>'speaker_group_id')::uuid = v_speakers
    AND (v->>'speaker_ticket_type_id')::uuid = '42900000-0000-0000-0000-000000000091',
    '42/(c): zapis ustawien: nabor otwarty, formy, sciezki, limit, grupa speakers, bilet');

  -- PATCH: brak klucza nie rusza pola.
  v := public.admin_event_cfp_settings_save(jsonb_build_object(
    'event_id', '42e00000-0000-0000-0000-0000000000e1', 'guidelines_pl', 'Zasady.'));
  PERFORM pg_temp.assert(
    v->>'intro_pl' = 'Zapraszamy prelegentow.' AND v->>'guidelines_pl' = 'Zasady.'
    AND jsonb_array_length(v->'formats') = 2 AND v->>'status' = 'open',
    '42/(c): klucz nieobecny zachowuje stan (PATCH), obecny zmienia');

  -- Fazy: otwarty, ale okno jeszcze nie ruszylo albo juz minelo - zegar BAZY.
  PERFORM pg_temp.assert(
    public._event_cfp_phase('open', now() + interval '1 hour', NULL) = 'scheduled'
    AND public._event_cfp_phase('open', NULL, now() - interval '1 hour') = 'closed'
    AND public._event_cfp_phase('closed', NULL, NULL) = 'closed'
    AND public._event_cfp_phase(NULL, NULL, NULL) = 'none'
    AND NOT public._event_cfp_is_open('open', now() + interval '1 hour', NULL)
    AND NOT public._event_cfp_is_open(NULL, NULL, NULL)
    AND public._event_cfp_is_open('open', now() - interval '1 hour', now() + interval '1 hour'),
    '42/(c): fazy naboru i otwarcie liczone zegarem bazy');
END
$do$;

-- ---------------------------------------------------------------------------
-- (d) PYTANIA FORMULARZA
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_text uuid;
  v_choice uuid;
  v_check uuid;
  v_tmp uuid;
BEGIN
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');

  v_text := public.admin_event_cfp_field_upsert(jsonb_build_object(
    'event_id', '42e00000-0000-0000-0000-0000000000e1', 'key', 'doswiadczenie', 'field_type', 'textarea',
    'label_pl', 'Doswiadczenie', 'label_en', 'Experience', 'is_required', true));
  v_choice := public.admin_event_cfp_field_upsert(jsonb_build_object(
    'event_id', '42e00000-0000-0000-0000-0000000000e1', 'key', 'poziom', 'field_type', 'select',
    'label_pl', 'Poziom', 'label_en', 'Level',
    'options', jsonb_build_array(
      jsonb_build_object('value', 'podstawowy', 'label_pl', 'Podstawowy', 'label_en', 'Basic'),
      jsonb_build_object('value', 'zaawansowany', 'label_pl', 'Zaawansowany', 'label_en', 'Advanced'))));
  v_check := public.admin_event_cfp_field_upsert(jsonb_build_object(
    'event_id', '42e00000-0000-0000-0000-0000000000e1', 'key', 'nagranie', 'field_type', 'checkbox',
    'label_pl', 'Zgoda na nagranie', 'label_en', 'Recording consent', 'is_required', true));
  INSERT INTO t42 VALUES ('field_text', v_text), ('field_choice', v_choice), ('field_check', v_check);

  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_cfp_fields_list('42e00000-0000-0000-0000-0000000000e1')) = 3
    AND (SELECT array_agg(f.key ORDER BY f.sort_order) FROM public.admin_event_cfp_fields_list('42e00000-0000-0000-0000-0000000000e1') f)
        = ARRAY['doswiadczenie', 'poziom', 'nagranie'],
    '42/(d): trzy pytania w kolejnosci dodania');

  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_field_upsert('{"event_id":"42e00000-0000-0000-0000-0000000000e1","key":"Zly Klucz","field_type":"text","label_pl":"A","label_en":"A"}')$$,
    'invalid_key', '42/(d): klucz w zlym ksztalcie odrzucony');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_field_upsert('{"event_id":"42e00000-0000-0000-0000-0000000000e1","key":"poziom","field_type":"text","label_pl":"A","label_en":"A"}')$$,
    'key_taken', '42/(d): zajety klucz odrzucony');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_field_upsert('{"event_id":"42e00000-0000-0000-0000-0000000000e1","key":"plik","field_type":"file","label_pl":"A","label_en":"A"}')$$,
    'invalid_field_type', '42/(d): typ spoza listy odrzucony (wrzut plikow poza wersja)');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_field_upsert('{"event_id":"42e00000-0000-0000-0000-0000000000e1","key":"bez_etykiety","field_type":"text","label_pl":"A","label_en":" "}')$$,
    'invalid_labels', '42/(d): brak etykiety EN odrzucony');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_field_upsert('{"event_id":"42e00000-0000-0000-0000-0000000000e1","key":"wybor","field_type":"select","label_pl":"A","label_en":"A","options":[]}')$$,
    'invalid_options', '42/(d): wybor bez opcji odrzucony');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_field_upsert('{"event_id":"42e00000-0000-0000-0000-0000000000e1","key":"wybor","field_type":"multiselect","label_pl":"A","label_en":"A","options":[{"value":"a","label_pl":"A","label_en":"A"},{"value":"a","label_pl":"B","label_en":"B"}]}')$$,
    'invalid_options', '42/(d): zdublowana wartosc opcji odrzucona');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_field_upsert('{"key":"sierota","field_type":"text","label_pl":"A","label_en":"A"}')$$,
    'not_found', '42/(d): pytanie bez wydarzenia odrzucone');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_field_upsert('{"id":"42000000-0000-0000-0000-00000000dead","label_pl":"A"}')$$,
    'not_found', '42/(d): zmiana nieistniejacego pytania = not_found');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_field_upsert('{"id":"%s","key":"inny_klucz"}')$$, v_choice),
    'key_immutable', '42/(d): klucz istniejacego pytania niezmienny');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_field_upsert('{"id":"%s","help_pl":"%s"}')$$, v_choice, repeat('x', 501)),
    'invalid_help', '42/(d): podpowiedz ponad 500 znakow odrzucona');

  -- PATCH istniejacego: zmiana etykiety bez ruszania opcji.
  PERFORM public.admin_event_cfp_field_upsert(jsonb_build_object('id', v_choice, 'label_pl', 'Poziom zaawansowania',
    'is_active', true, 'sort_order', 20));
  PERFORM pg_temp.assert(
    (SELECT f.label_pl = 'Poziom zaawansowania' AND jsonb_array_length(f.options) = 2 AND f.sort_order = 20
       FROM public.event_cfp_fields f WHERE f.id = v_choice),
    '42/(d): zmiana etykiety zostawia opcje');

  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_fields_reorder('{"event_id":"42e00000-0000-0000-0000-0000000000e1","ids":["%s"]}')$$, v_text),
    'invalid_order', '42/(d): kolejnosc bez kompletu pytan odrzucona');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_fields_reorder('{"event_id":"42e00000-0000-0000-0000-0000000000e1","ids":["x"]}')$$,
    'invalid_order', '42/(d): identyfikator w zlym ksztalcie odrzucony nazwanym bledem');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_fields_reorder('{"event_id":"42e00000-0000-0000-0000-0000000000e1","ids":"x"}')$$,
    'invalid_order', '42/(d): kolejnosc nie jako lista odrzucona');
  -- Wywolanie zapisujace i odczyt w OSOBNYCH instrukcjach: jedna instrukcja
  -- SELECT widzi migawke sprzed wlasnego zapisu.
  PERFORM pg_temp.assert(
    public.admin_event_cfp_fields_reorder(jsonb_build_object(
      'event_id', '42e00000-0000-0000-0000-0000000000e1',
      'ids', jsonb_build_array(v_check, v_text, v_choice))) = 3,
    '42/(d): kolejnosc obejmuje trzy pytania');
  PERFORM pg_temp.assert(
    (SELECT array_agg(f.key ORDER BY f.sort_order) FROM public.event_cfp_fields f
          WHERE f.event_id = '42e00000-0000-0000-0000-0000000000e1') = ARRAY['nagranie', 'doswiadczenie', 'poziom'],
    '42/(d): nowa kolejnosc pytan zapisana');

  v_tmp := public.admin_event_cfp_field_upsert(jsonb_build_object(
    'event_id', '42e00000-0000-0000-0000-0000000000e1', 'key', 'do_usuniecia', 'field_type', 'url',
    'label_pl', 'Adres', 'label_en', 'Link'));
  PERFORM pg_temp.assert(public.admin_event_cfp_field_delete(v_tmp), '42/(d): usuniecie pytania');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_field_delete('%s')$$, v_tmp),
    'not_found', '42/(d): ponowne usuniecie = not_found');

  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-0000000000b1', '42000000-0000-0000-0000-0000000000b0');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_field_delete('%s')$$, v_text),
    'not_found', '42/(d): admin najemcy B nie usunie pytania najemcy A');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_field_upsert('{"id":"%s","label_pl":"Przejete"}')$$, v_text),
    'not_found', '42/(d): admin najemcy B nie zmieni pytania najemcy A');
END
$do$;

-- ---------------------------------------------------------------------------
-- (e) STRONA PUBLICZNA NABORU
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v jsonb;
BEGIN
  PERFORM pg_temp.act_as();
  v := public.event_cfp_public('cfp-42');
  PERFORM pg_temp.assert(
    v->>'phase' = 'open' AND (v->>'is_open')::boolean AND v->>'intro_pl' = 'Zapraszamy prelegentow.'
    AND jsonb_array_length(v->'tracks') = 2 AND jsonb_array_length(v->'fields') = 3
    AND jsonb_array_length(v->'formats') = 2 AND (v->>'max_per_submitter')::int = 2,
    '42/(e): anonim widzi otwarty nabor z formami, sciezkami i pytaniami');
  PERFORM pg_temp.assert(public.event_cfp_public('cfp-42-szkic') IS NULL,
    '42/(e): nabor nieopublikowanego wydarzenia nie istnieje dla publicznosci');
  PERFORM pg_temp.assert(public.event_cfp_public('nie-ma-takiego') IS NULL,
    '42/(e): nieznany adres = NULL, nie blad');

  -- Obcy host: ten sam adres wydarzenia w najemcy B, a B nie ma naboru.
  PERFORM set_config('nes.public_tenant', '42000000-0000-0000-0000-0000000000b0', false);
  v := public.event_cfp_public('cfp-42');
  PERFORM pg_temp.assert(v->>'phase' = 'none' AND v->>'intro_pl' IS NULL
    AND (v->>'event_id')::uuid = '42e00000-0000-0000-0000-0000000000b1',
    '42/(e): host najemcy B widzi SWOJE wydarzenie bez naboru, nie teksty najemcy A');
  PERFORM set_config('nes.public_tenant', '', false);
END
$do$;

-- ---------------------------------------------------------------------------
-- (f) ZGLOSZENIE PRELEGENTA
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v jsonb;
  v_sub uuid;
  v_sub2 uuid;
  v_person uuid;
  v_lead uuid;
BEGIN
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.event_cfp_submission_save('{"slug":"cfp-42"}')$$,
    'auth_required', '42/(f): anonim nie zglosi wystapienia');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.event_my_cfp_submissions('cfp-42')$$,
    'auth_required', '42/(f): anonim nie ma listy zgloszen');

  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000051');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.event_cfp_submission_save('{"slug":"cfp-42"}')$$,
    'invalid_name', '42/(f): pierwsze zgloszenie bez imienia i nazwiska odrzucone');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.event_cfp_submission_save('{"slug":"cfp-42-szkic","speaker":{"first_name":"Piotr","last_name":"Prelegent"}}')$$,
    'not_found', '42/(f): wydarzenie nieopublikowane nie przyjmuje zgloszen');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_save('{"slug":"cfp-42","speaker":{"first_name":"%s","last_name":"P"}}')$$, repeat('x', 81)),
    'invalid_speaker', '42/(f): zbyt dlugie imie odrzucone nazwanym bledem');

  v := public.event_cfp_submission_save(jsonb_build_object(
    'slug', 'cfp-42',
    'speaker', jsonb_build_object('first_name', 'Piotr', 'last_name', 'Prelegent',
      'job_title', 'Analityk', 'company_text', 'Instytut', 'consent_marketing', true),
    'title_pl', 'Transformacja energetyczna', 'talk_language', 'pl', 'notify_lang', 'en',
    'format_key', 'talk', 'track_id', '42700000-0000-0000-0000-000000000071',
    'topics', jsonb_build_array(' energia ', 'OZE', ' '),
    'answers', jsonb_build_object('poziom', 'zaawansowany', 'nieznane', 'x', 'nagranie', 'true'),
    'co_speakers', jsonb_build_array(jsonb_build_object(
      'first_name', 'Wanda', 'last_name', 'Wspol', 'email', 'Wspolprelegent@Example.org', 'role', 'panelist'))
  ));
  v_sub := (v->>'id')::uuid;
  INSERT INTO t42 VALUES ('sub1', v_sub);
  PERFORM pg_temp.assert(v->>'status' = 'draft', '42/(f): pierwszy zapis tworzy SZKIC');

  SELECT s.person_id INTO v_person FROM public.event_cfp_submissions s WHERE s.id = v_sub;
  INSERT INTO t42 VALUES ('person1', v_person);
  PERFORM pg_temp.assert(
    (SELECT p.user_id = '42a00000-0000-0000-0000-000000000051' AND p.email_norm = 'prelegent.jeden@example.org'
        AND p.source = 'self_registration' AND p.consent_data_processing_at IS NOT NULL
        AND p.consent_marketing_at IS NOT NULL AND p.job_title = 'Analityk'
       FROM public.event_people p WHERE p.id = v_person),
    '42/(f): kartoteka zglaszajacego: konto, adres KONTA, stempel przetwarzania, zgoda z zaznaczenia');
  PERFORM pg_temp.assert(
    (SELECT s.duration_min = 30 AND s.topics = ARRAY['energia', 'OZE'] AND s.notify_lang = 'en'
        AND s.answers = '{"poziom":"zaawansowany","nagranie":true}'::jsonb
       FROM public.event_cfp_submissions s WHERE s.id = v_sub),
    '42/(f): czas z formy, tematy przyciete, odpowiedzi tylko na znane pytania i w ksztalcie typu');
  PERFORM pg_temp.assert(
    (SELECT count(*) = 2 AND count(*) FILTER (WHERE sp.is_primary AND sp.person_id = v_person) = 1
        AND count(*) FILTER (WHERE NOT sp.is_primary AND sp.person_id IS NULL
                             AND sp.email = 'wspolprelegent@example.org' AND sp.role = 'panelist') = 1
       FROM public.event_cfp_submission_speakers sp WHERE sp.submission_id = v_sub),
    '42/(f): zglaszajacy z kartoteka, wspolprelegent BEZ kartoteki (do decyzji)');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.event_people p WHERE p.email_norm = 'wspolprelegent@example.org'),
    '42/(f): szkic nie zaklada kartoteki osoby trzeciej');

  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_save('{"id":"%s","format_key":"warsztat"}')$$, v_sub),
    'invalid_format', '42/(f): forma spoza naboru odrzucona');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_save('{"id":"%s","track_id":"42700000-0000-0000-0000-000000000079"}')$$, v_sub),
    'invalid_track', '42/(f): sciezka spoza naboru odrzucona');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_save('{"id":"%s","answers":{"poziom":"ekspert"}}')$$, v_sub),
    'invalid_answers', '42/(f): opcja spoza listy odrzucona');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_save('{"id":"%s","answers":{"nagranie":"moze"}}')$$, v_sub),
    'invalid_answers', '42/(f): pole tak/nie przyjmuje tylko tak albo nie');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_save('{"id":"%s","answers":["x"]}')$$, v_sub),
    'invalid_answers', '42/(f): odpowiedzi nie jako obiekt odrzucone');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_save('{"id":"%s","answers":{"doswiadczenie":{"a":1}}}')$$, v_sub),
    'invalid_answers', '42/(f): pole tekstowe nie przyjmuje obiektu');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_save('{"id":"%s","talk_language":"de"}')$$, v_sub),
    'invalid_language', '42/(f): jezyk wystapienia spoza pl/en odrzucony');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_save('{"id":"%s","role":"gwiazda"}')$$, v_sub),
    'invalid_role', '42/(f): nieznana rola odrzucona');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_save('{"id":"%s","co_speakers":[{"first_name":"A","last_name":"B","email":"prelegent.jeden@example.org"}]}')$$, v_sub),
    'invalid_speakers', '42/(f): wspolprelegent z adresem zglaszajacego odrzucony');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_save('{"id":"%s","co_speakers":[{},{},{},{},{},{}]}')$$, v_sub),
    'too_many_speakers', '42/(f): ponad pieciu wspolprelegentow odrzuconych');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_save('{"id":"%s","topics":"energia"}')$$, v_sub),
    'invalid_topics', '42/(f): tematy nie jako lista odrzucone');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_save('{"id":"%s","title_pl":"%s"}')$$, v_sub, repeat('x', 201)),
    'invalid_title', '42/(f): tytul ponad 200 znakow odrzucony');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_save('{"id":"%s","abstract_en":"%s"}')$$, v_sub, repeat('x', 4001)),
    'invalid_abstract', '42/(f): streszczenie ponad 4000 znakow odrzucone');

  -- Wyslanie: kazda brakujaca czesc ma wlasny kod.
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_submit('{"id":"%s"}')$$, v_sub),
    'missing_abstract', '42/(f): wyslanie bez streszczenia odrzucone');
  PERFORM public.event_cfp_submission_save(jsonb_build_object('id', v_sub,
    'abstract_pl', 'Jak zmienia sie rynek energii w Europie Srodkowej.'));
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_submit('{"id":"%s"}')$$, v_sub),
    'missing_required_fields', '42/(f): wyslanie bez wymaganej odpowiedzi odrzucone');
  PERFORM public.event_cfp_submission_save(jsonb_build_object('id', v_sub,
    'answers', jsonb_build_object('doswiadczenie', 'Dziesiec lat w branzy.', 'poziom', 'zaawansowany', 'nagranie', false)));
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_submit('{"id":"%s"}')$$, v_sub),
    'missing_required_fields: nagranie', '42/(f): wymagane pole tak/nie musi byc PRAWDA');
  PERFORM public.event_cfp_submission_save(jsonb_build_object('id', v_sub,
    'answers', jsonb_build_object('doswiadczenie', 'Dziesiec lat w branzy.', 'poziom', 'zaawansowany', 'nagranie', true)));

  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000052');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_submit('{"id":"%s"}')$$, v_sub),
    'not_found', '42/(f): cudzy uzytkownik nie wysle cudzego zgloszenia');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_save('{"id":"%s","title_pl":"Przejete"}')$$, v_sub),
    'not_found', '42/(f): cudzy uzytkownik nie zmieni cudzego zgloszenia');

  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000051');
  v := public.event_cfp_submission_submit(jsonb_build_object('id', v_sub));
  PERFORM pg_temp.assert(v->>'status' = 'submitted'
    AND (SELECT s.status = 'submitted' AND s.submitted_at IS NOT NULL FROM public.event_cfp_submissions s WHERE s.id = v_sub),
    '42/(f): wyslanie przestawia na submitted ze stemplem');
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.domain_events d
             WHERE d.event_type = 'event_cfp_submission.submitted.v1' AND d.aggregate_id = v_sub::text
               AND d.payload->>'event_id' = '42e00000-0000-0000-0000-0000000000e1'
               AND d.actor_id = '42a00000-0000-0000-0000-000000000051'),
    '42/(f): zdarzenie domenowe wyslania z identyfikatorem wydarzenia i aktorem');
  SELECT k.crm_lead_id INTO v_lead FROM public.event_person_crm_links k WHERE k.person_id = v_person;
  PERFORM pg_temp.assert(
    (SELECT l.source_type = 'event_cfp' AND 'event:cfp-42' = ANY (l.tags) AND 'cfp:submitted' = ANY (l.tags)
        AND l.marketing_consent AND l.newsletter_status IS NULL
       FROM public.crm_leads l WHERE l.id = v_lead),
    '42/(f): kontakt CRM: segment event_cfp, tagi wydarzenia, zgoda z dowodu, bez newslettera');
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.audit_log a
             WHERE a.entity_id = v_lead AND a.action = 'event.cfp.submitted'
               AND a.metadata->>'summary_pl' LIKE U&'Zg\0142oszenie wyst\0105pienia: Transformacja energetyczna%'
               AND a.metadata->>'event_slug' = 'cfp-42' AND a.metadata->>'submission_id' = v_sub::text),
    '42/(f): wpis osi czasu CRM ze zdaniem PL (z polskimi literami) i kontraktem metadanych');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.crm_leads l WHERE lower(l.email) = 'wspolprelegent@example.org'),
    '42/(f): wspolprelegent NIE trafia do CRM przy wyslaniu');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_save('{"id":"%s","title_pl":"Zmiana"}')$$, v_sub),
    'not_editable', '42/(f): wyslanego zgloszenia nie da sie zmieniac');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_submit('{"id":"%s"}')$$, v_sub),
    'not_editable', '42/(f): powtorne wyslanie odrzucone');

  -- Drugie zgloszenie: limit 2 na osobe.
  v := public.event_cfp_submission_save(jsonb_build_object('slug', 'cfp-42', 'title_en', 'Second talk'));
  v_sub2 := (v->>'id')::uuid;
  INSERT INTO t42 VALUES ('sub2', v_sub2);
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.event_cfp_submission_save('{"slug":"cfp-42","title_en":"Third"}')$$,
    'limit_reached', '42/(f): trzecie zgloszenie ponad limit 2 odrzucone');
  PERFORM public.event_cfp_submission_save(jsonb_build_object('id', v_sub2,
    'abstract_en', 'A second talk about energy markets.',
    'answers', jsonb_build_object('doswiadczenie', 'Duzo.', 'nagranie', true)));
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_submit('{"id":"%s"}')$$, v_sub2),
    'missing_format', '42/(f): nabor z formami wymaga formy');
  PERFORM public.event_cfp_submission_save(jsonb_build_object('id', v_sub2, 'format_key', 'panel'));
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_submit('{"id":"%s"}')$$, v_sub2),
    'missing_track', '42/(f): nabor ze sciezkami wymaga sciezki');
  PERFORM public.event_cfp_submission_save(jsonb_build_object('id', v_sub2,
    'track_id', '42700000-0000-0000-0000-000000000072'));
  PERFORM public.event_cfp_submission_submit(jsonb_build_object('id', v_sub2));

  -- Zamkniety nabor: zapis nowego szkicu odrzucony, stan liczy baza.
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM public.admin_event_cfp_settings_save(jsonb_build_object(
    'event_id', '42e00000-0000-0000-0000-0000000000e1', 'status', 'closed'));
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000052');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.event_cfp_submission_save('{"slug":"cfp-42","speaker":{"first_name":"Inna","last_name":"Osoba"}}')$$,
    'cfp_closed', '42/(f): zamkniety nabor nie przyjmuje nowego szkicu');
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM public.admin_event_cfp_settings_save(jsonb_build_object(
    'event_id', '42e00000-0000-0000-0000-0000000000e1', 'status', 'open'));

  -- Zgloszenie innego uzytkownika (kolejka recenzenta, odrzucenie).
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000052');
  v := public.event_cfp_submission_save(jsonb_build_object('slug', 'cfp-42',
    'speaker', jsonb_build_object('first_name', 'Irena', 'last_name', 'Inna'),
    'title_pl', 'Finanse publiczne', 'abstract_pl', 'Budzet, dlug i inwestycje w regionie.',
    'format_key', 'talk', 'track_id', '42700000-0000-0000-0000-000000000072',
    'answers', jsonb_build_object('doswiadczenie', 'Tak.', 'nagranie', true)));
  INSERT INTO t42 VALUES ('sub3', (v->>'id')::uuid);
  PERFORM public.event_cfp_submission_submit(jsonb_build_object('id', (v->>'id')::uuid));
  -- I jej szkic (niewidoczny w panelu).
  v := public.event_cfp_submission_save(jsonb_build_object('slug', 'cfp-42', 'title_pl', 'Szkic'));
  INSERT INTO t42 VALUES ('draft3', (v->>'id')::uuid);
END
$do$;

-- ---------------------------------------------------------------------------
-- (g) RECENZENT
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v jsonb;
  v_r1 uuid;
  v_r2 uuid;
  v_r3 uuid;
  v_sub1 uuid := (SELECT id FROM t42 WHERE name = 'sub1');
  v_sub3 uuid := (SELECT id FROM t42 WHERE name = 'sub3');
BEGIN
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000061');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.event_cfp_review_queue('cfp-42')$$,
    'not_reviewer', '42/(g): konto bez czlonkostwa nie widzi kolejki');

  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_reviewer_set('{"event_id":"42e00000-0000-0000-0000-0000000000e1","user_id":"42a00000-0000-0000-0000-0000000000b2"}')$$,
    'reviewer_not_found', '42/(g): konto obcego najemcy nie zostanie recenzentem');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_reviewer_set('{"event_id":"42e00000-0000-0000-0000-0000000000e1","user_id":"42a00000-0000-0000-0000-000000000061","track_ids":["42700000-0000-0000-0000-000000000079"]}')$$,
    'invalid_tracks', '42/(g): zakres ze sciezka obcego wydarzenia odrzucony');
  v_r1 := public.admin_event_cfp_reviewer_set(jsonb_build_object(
    'event_id', '42e00000-0000-0000-0000-0000000000e1', 'user_id', '42a00000-0000-0000-0000-000000000061'));
  v_r2 := public.admin_event_cfp_reviewer_set(jsonb_build_object(
    'event_id', '42e00000-0000-0000-0000-0000000000e1', 'user_id', '42a00000-0000-0000-0000-000000000062',
    'track_ids', jsonb_build_array('42700000-0000-0000-0000-000000000072')));
  v_r3 := public.admin_event_cfp_reviewer_set(jsonb_build_object(
    'event_id', '42e00000-0000-0000-0000-0000000000e1', 'user_id', '42a00000-0000-0000-0000-000000000063'));
  INSERT INTO t42 VALUES ('r1', v_r1), ('r2', v_r2), ('r3', v_r3);
  PERFORM pg_temp.assert(
    public.admin_event_cfp_reviewer_set(jsonb_build_object(
      'event_id', '42e00000-0000-0000-0000-0000000000e1', 'user_id', '42a00000-0000-0000-0000-000000000061',
      'can_see_identity', true)) = v_r1,
    '42/(g): ponowne dodanie tego samego konta oddaje ten sam wiersz');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_cfp_reviewers_list('42e00000-0000-0000-0000-0000000000e1')) = 3
    AND (SELECT rl.display_name = 'Recenzent Jeden' AND rl.can_see_identity AND rl.track_ids = '{}'::uuid[]
           FROM public.admin_event_cfp_reviewers_list('42e00000-0000-0000-0000-0000000000e1') rl WHERE rl.id = v_r1),
    '42/(g): ponowne dodanie tego samego konta zmienia wiersz (PATCH), nie dubluje');

  -- Ocena w ciemno: tozsamosc ukryta, chyba ze recenzent ma wglad.
  PERFORM public.admin_event_cfp_settings_save(jsonb_build_object(
    'event_id', '42e00000-0000-0000-0000-0000000000e1', 'review_blind', true));

  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000061');
  v := public.event_cfp_review_queue('cfp-42');
  PERFORM pg_temp.assert(
    (v->>'identity_visible')::boolean AND jsonb_array_length(v->'items') = 3
    AND jsonb_typeof(v->'items'->0->'speakers') = 'array',
    '42/(g): recenzent z wgladem widzi trzy wyslane zgloszenia z nazwiskami (bez szkicu)');
  PERFORM pg_temp.assert(public.event_cfp_review_queue('cfp-42-szkic') IS NULL,
    '42/(g): kolejka nieopublikowanego wydarzenia = NULL');

  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000062');
  v := public.event_cfp_review_queue('cfp-42');
  PERFORM pg_temp.assert(
    NOT (v->>'identity_visible')::boolean AND jsonb_array_length(v->'items') = 2
    AND jsonb_typeof(v->'items'->0->'speakers') = 'null'
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'items') i WHERE (i->>'id')::uuid = v_sub1),
    '42/(g): ocena w ciemno ukrywa tozsamosc; zakres sciezki finanse wycina zgloszenie z energii');
  PERFORM pg_temp.assert(
    (public.event_cfp_review_get(v_sub3)->'speakers') = 'null'::jsonb
    AND NOT (public.event_cfp_review_get(v_sub3)->>'identity_visible')::boolean,
    '42/(g): podglad w ciemno bez wystepujacych');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_review_get('%s')$$, v_sub1),
    'not_found', '42/(g): zgloszenie spoza zakresu sciezek niedostepne');

  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000063');
  v := public.event_cfp_review_queue('cfp-42');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'items') i WHERE (i->>'id')::uuid = v_sub1),
    '42/(g): recenzent wpisany jako wspolprelegent NIE widzi tego zgloszenia');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_review_save('{"submission_id":"%s","overall":4}')$$, v_sub1),
    'not_found', '42/(g): recenzent nie oceni zgloszenia, w ktorym wystepuje');

  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000051');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_review_save('{"submission_id":"%s","overall":4}')$$, v_sub3),
    'not_found', '42/(g): zglaszajacy bez czlonkostwa nie oceni cudzego zgloszenia');

  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000061');
  v := public.event_cfp_review_get(v_sub1);
  PERFORM pg_temp.assert(
    (v->>'score_max')::int = 5 AND jsonb_array_length(v->'review_criteria') = 2
    AND v->'review' = 'null'::jsonb AND jsonb_array_length(v->'speakers') = 2
    AND v->'track'->>'name_pl' = 'Energia',
    '42/(g): podglad zgloszenia z kryteriami, sciezka i bez wlasnej oceny');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_review_save('{"submission_id":"%s","overall":6}')$$, v_sub1),
    'invalid_score', '42/(g): ocena ponad skale odrzucona');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_review_save('{"submission_id":"%s","overall":4,"scores":{"nieznane":3}}')$$, v_sub1),
    'invalid_scores', '42/(g): ocena nieznanego kryterium odrzucona');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_review_save('{"submission_id":"%s","overall":4,"scores":[1]}')$$, v_sub1),
    'invalid_scores', '42/(g): oceny kryteriow nie jako obiekt odrzucone');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_review_save('{"submission_id":"%s","scores":{"tresc":3}}')$$, v_sub1),
    'score_required', '42/(g): bez oceny ogolnej trzeba sie wstrzymac albo zglosic konflikt');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_review_save('{"submission_id":"%s","overall":4,"recommendation":"super"}')$$, v_sub1),
    'invalid_recommendation', '42/(g): nieznana rekomendacja odrzucona');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_review_save('{"submission_id":"%s","overall":4,"comment_private":"%s"}')$$, v_sub1, repeat('x', 4001)),
    'invalid_comment', '42/(g): komentarz ponad 4000 znakow odrzucony');

  v := public.event_cfp_review_save(jsonb_build_object('submission_id', v_sub1,
    'overall', 4, 'recommendation', 'accept', 'scores', jsonb_build_object('tresc', 5, 'forma', 1, 'pomin', NULL),
    'comment_private', 'Mocny temat.', 'comment_to_speaker', 'Skroc wstep.'));
  INSERT INTO t42 VALUES ('review1', (v->>'id')::uuid);
  PERFORM pg_temp.assert(
    (SELECT s.status = 'under_review' AND s.decided_at IS NULL AND s.decided_by IS NULL
       FROM public.event_cfp_submissions s WHERE s.id = v_sub1),
    '42/(g): pierwsza ocena przestawia na under_review bez sladu decyzji');
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.domain_events d
             WHERE d.event_type = 'event_cfp_review.saved.v1'
               AND d.payload->>'submission_id' = v_sub1::text
               AND d.payload->>'event_id' = '42e00000-0000-0000-0000-0000000000e1'),
    '42/(g): zdarzenie domenowe zapisu oceny z identyfikatorami');
  -- Zapis oceny to PELNY stan formularza (nie PATCH) - formularz zawsze wysyla komplet.
  PERFORM public.event_cfp_review_save(jsonb_build_object('submission_id', v_sub1,
    'overall', 5, 'recommendation', 'accept', 'scores', jsonb_build_object('tresc', 5, 'forma', 1),
    'comment_private', 'Mocny temat.', 'comment_to_speaker', 'Skroc wstep.'));
  PERFORM pg_temp.assert(
    (SELECT count(*) = 1 AND max(r.overall) = 5 FROM public.event_cfp_reviews r WHERE r.submission_id = v_sub1)
    AND (public.event_cfp_review_get(v_sub1)->'review'->>'overall')::int = 5,
    '42/(g): jedna ocena na recenzenta i zgloszenie (upsert), widoczna w podgladzie');

  -- Recenzent 2 zglasza konflikt interesow na sub3 - nie liczy sie do sredniej.
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000062');
  PERFORM public.event_cfp_review_save(jsonb_build_object('submission_id', v_sub3, 'conflict_of_interest', true));
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000061');
  PERFORM public.event_cfp_review_save(jsonb_build_object('submission_id', v_sub3, 'overall', 2, 'recommendation', 'reject'));
  PERFORM pg_temp.assert(
    (public._event_cfp_review_summary('11111111-1111-1111-1111-111111111111', v_sub3)->>'reviews_count')::int = 1
    AND (public._event_cfp_review_summary('11111111-1111-1111-1111-111111111111', v_sub3)->>'conflicts_count')::int = 1
    AND (public._event_cfp_review_summary('11111111-1111-1111-1111-111111111111', v_sub3)->>'overall_avg')::numeric = 2,
    '42/(g): konflikt interesow poza srednia i poza licznikiem ocen');
  PERFORM pg_temp.assert(
    (public._event_cfp_review_summary('11111111-1111-1111-1111-111111111111', v_sub1)->>'weighted_avg')::numeric = 4,
    '42/(g): wynik wazony (5*3 + 1*1) / 4 = 4');

  -- Skala ponizej uzytych ocen odrzucona.
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_settings_save('{"event_id":"42e00000-0000-0000-0000-0000000000e1","score_max":4}')$$,
    'score_max_below_reviews', '42/(g): skala ponizej istniejacych ocen odrzucona');
END
$do$;

-- ---------------------------------------------------------------------------
-- (h) PANEL: LISTA, LICZNIKI, SZCZEGOL
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v jsonb;
  v_sub1 uuid := (SELECT id FROM t42 WHERE name = 'sub1');
BEGIN
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_cfp_submissions_list('{"event_id":"42e00000-0000-0000-0000-0000000000e1"}')) = 3
    AND NOT EXISTS (SELECT 1 FROM public.admin_event_cfp_submissions_list('{"event_id":"42e00000-0000-0000-0000-0000000000e1"}') l
                     WHERE l.status = 'draft'),
    '42/(h): lista panelu bez szkicow');
  PERFORM pg_temp.assert(
    (SELECT l.reviews_count = 1 AND l.overall_avg = 5 AND l.weighted_avg = 4 AND l.speakers_count = 2
        AND (l.recommendations->>'accept')::int = 1 AND l.total_count = 1 AND l.track_name_pl = 'Energia'
        AND l.speaker_name = 'Piotr Prelegent'
       FROM public.admin_event_cfp_submissions_list(jsonb_build_object(
         'event_id', '42e00000-0000-0000-0000-0000000000e1', 'status', 'under_review', 'q', 'transformacja')) l),
    '42/(h): filtr stanu i szukanie z agregatami ocen, wystepujacymi i sciezka');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_cfp_submissions_list(jsonb_build_object(
       'event_id', '42e00000-0000-0000-0000-0000000000e1', 'q', 'WANDA'))) = 1
    AND (SELECT count(*) FROM public.admin_event_cfp_submissions_list(jsonb_build_object(
       'event_id', '42e00000-0000-0000-0000-0000000000e1', 'track_id', '42700000-0000-0000-0000-000000000072'))) = 2
    AND (SELECT min(l.total_count) FROM public.admin_event_cfp_submissions_list(jsonb_build_object(
       'event_id', '42e00000-0000-0000-0000-0000000000e1', 'limit', 1)) l) = 3
    AND (SELECT count(*) FROM public.admin_event_cfp_submissions_list(jsonb_build_object(
       'event_id', '42e00000-0000-0000-0000-0000000000e1', 'limit', 1, 'offset', 1))) = 1
    AND (SELECT l.id FROM public.admin_event_cfp_submissions_list(jsonb_build_object(
       'event_id', '42e00000-0000-0000-0000-0000000000e1', 'sort', 'score', 'limit', 1)) l) = v_sub1
    AND (SELECT l.title_pl FROM public.admin_event_cfp_submissions_list(jsonb_build_object(
       'event_id', '42e00000-0000-0000-0000-0000000000e1', 'sort', 'title', 'limit', 1)) l) = 'Finanse publiczne',
    '42/(h): szukanie po wspolprelegencie, filtr sciezki, stronicowanie, sortowanie po ocenie i tytule');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT * FROM public.admin_event_cfp_submissions_list('{"event_id":"42e00000-0000-0000-0000-0000000000e1","status":"draft"}')$$,
    'invalid_status', '42/(h): filtr szkicow odrzucony');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT * FROM public.admin_event_cfp_submissions_list('{"event_id":"42e00000-0000-0000-0000-0000000000e1","sort":"random"}')$$,
    'invalid_payload', '42/(h): nieznane sortowanie odrzucone');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT * FROM public.admin_event_cfp_submissions_list('{}')$$,
    'not_found', '42/(h): lista bez wydarzenia odrzucona');

  v := public.admin_event_cfp_submissions_counts('42e00000-0000-0000-0000-0000000000e1');
  PERFORM pg_temp.assert(
    (v->>'total')::int = 3 AND (v->>'draft')::int = 1 AND (v->>'under_review')::int = 2
    AND (v->>'submitted')::int = 1 AND (v->>'needs_reviews')::int = 3 AND (v->>'min_reviews')::int = 2,
    '42/(h): liczniki: 3 wyslane (2 w ocenie, 1 bez oceny), 1 szkic, 3 ponizej minimum ocen');

  v := public.admin_event_cfp_submission_detail(v_sub1);
  PERFORM pg_temp.assert(
    v->'submission'->>'status' = 'under_review' AND jsonb_array_length(v->'speakers') = 2
    AND v->'reviews'->0->>'comment_private' = 'Mocny temat.'
    AND v->'reviews'->0->>'reviewer_name' = 'Recenzent Jeden'
    AND v->'speakers'->0->'crm'->>'sync_status' = 'ok'
    AND v->'speakers'->1->'crm' = 'null'::jsonb
    AND v->'person'->>'email' = 'prelegent.jeden@example.org'
    AND v->'track'->>'name_pl' = 'Energia' AND jsonb_array_length(v->'fields') = 3
    AND (v->'settings'->>'score_max')::int = 5 AND v->'session' = 'null'::jsonb,
    '42/(h): szczegol: wystepujacy ze stanem CRM, oceny z komentarzem prywatnym, pytania, sciezka');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_submission_detail('%s')$$, (SELECT id FROM t42 WHERE name = 'draft3')),
    'not_found', '42/(h): szczegol szkicu niedostepny dla panelu');

  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-0000000000b1', '42000000-0000-0000-0000-0000000000b0');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_submission_detail('%s')$$, v_sub1),
    'not_found', '42/(h): admin najemcy B nie czyta zgloszenia najemcy A');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_submission_decide('{"id":"%s","status":"under_review"}')$$, v_sub1),
    'not_found', '42/(h): admin najemcy B nie osadzi zgloszenia najemcy A');
END
$do$;

-- ---------------------------------------------------------------------------
-- (i) DECYZJA
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v jsonb;
  v_sub2 uuid := (SELECT id FROM t42 WHERE name = 'sub2');
  v_sub3 uuid := (SELECT id FROM t42 WHERE name = 'sub3');
  v_lead uuid;
BEGIN
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_submission_decide('{"id":"%s","status":"accepted"}')$$, v_sub2),
    'invalid_status', '42/(i): przyjecie idzie osobna funkcja, nie decyzja');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_submission_decide('{"id":"%s","status":"rejected"}')$$, v_sub3),
    'note_required', '42/(i): odrzucenie bez notatki odrzucone');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_submission_decide('{"id":"%s","status":"waitlisted","decision_note":"%s"}')$$, v_sub3, repeat('x', 2001)),
    'invalid_note', '42/(i): notatka ponad 2000 znakow odrzucona');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_submission_decide('{"id":"%s","status":"under_review"}')$$,
      (SELECT id FROM t42 WHERE name = 'draft3')),
    'invalid_transition', '42/(i): szkicu nie da sie osadzic');

  v := public.admin_event_cfp_submission_decide(jsonb_build_object('id', v_sub3, 'status', 'rejected',
    'decision_note', 'Poza profilem wydarzenia.', 'feedback_to_speaker', 'Dziekujemy, temat poza profilem.'));
  PERFORM pg_temp.assert(v->>'status' = 'rejected'
    AND (SELECT s.decided_by = '42a00000-0000-0000-0000-0000000000a1' AND s.decided_at IS NOT NULL
           FROM public.event_cfp_submissions s WHERE s.id = v_sub3),
    '42/(i): odrzucenie z notatka i sladem decyzji');
  SELECT k.crm_lead_id INTO v_lead FROM public.event_person_crm_links k
   WHERE k.person_id = (SELECT s.person_id FROM public.event_cfp_submissions s WHERE s.id = v_sub3);
  PERFORM pg_temp.assert(
    (SELECT 'cfp:rejected' = ANY (l.tags) AND l.source_type = 'event_cfp' FROM public.crm_leads l WHERE l.id = v_lead)
    AND EXISTS (SELECT 1 FROM public.audit_log a WHERE a.entity_id = v_lead AND a.action = 'event.cfp.rejected'
                  AND a.metadata->>'summary_en' LIKE 'Call for speakers - rejected: Finanse publiczne%'
                  AND a.metadata::text NOT LIKE '%Poza profilem%'),
    '42/(i): CRM dostaje tag i wpis osi czasu, ale NIE notatke decyzji');
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.domain_events d WHERE d.event_type = 'event_cfp_submission.decided.v1'
             AND d.aggregate_id = v_sub3::text AND d.payload->>'status' = 'rejected'),
    '42/(i): zdarzenie domenowe decyzji');

  -- Poprawki: prelegent zmienia i wysyla ponownie - takze gdy nabor zamkniety.
  PERFORM public.admin_event_cfp_submission_decide(jsonb_build_object('id', v_sub2,
    'status', 'changes_requested', 'feedback_to_speaker', 'Dodaj polski tytul.'));
  PERFORM public.admin_event_cfp_settings_save(jsonb_build_object(
    'event_id', '42e00000-0000-0000-0000-0000000000e1', 'status', 'closed'));
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000051');
  PERFORM pg_temp.assert(
    (SELECT i->>'feedback_to_speaker' FROM jsonb_array_elements(public.event_my_cfp_submissions('cfp-42')->'items') i
      WHERE (i->>'id')::uuid = v_sub2) = 'Dodaj polski tytul.',
    '42/(i): prelegent widzi prosbe o poprawki');
  PERFORM public.event_cfp_submission_save(jsonb_build_object('id', v_sub2, 'title_pl', 'Drugi wyklad',
    'speaker', jsonb_build_object('job_title', 'Starszy analityk')));
  PERFORM pg_temp.assert(
    (SELECT sp.job_title = 'Starszy analityk' FROM public.event_cfp_submission_speakers sp
      WHERE sp.submission_id = v_sub2 AND sp.is_primary),
    '42/(i): zmiana danych prelegenta trafia do kartoteki i do wiersza wystepujacego');
  v := public.event_cfp_submission_submit(jsonb_build_object('id', v_sub2));
  PERFORM pg_temp.assert(v->>'status' = 'submitted'
    AND (SELECT s.title_pl = 'Drugi wyklad' FROM public.event_cfp_submissions s WHERE s.id = v_sub2),
    '42/(i): po prosbie o poprawki zmiana i ponowne wyslanie mimo zamknietego naboru');
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM public.admin_event_cfp_settings_save(jsonb_build_object(
    'event_id', '42e00000-0000-0000-0000-0000000000e1', 'status', 'open'));
END
$do$;

-- ---------------------------------------------------------------------------
-- (j) PRZYJECIE
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v jsonb;
  v_sub1 uuid := (SELECT id FROM t42 WHERE name = 'sub1');
  v_sub2 uuid := (SELECT id FROM t42 WHERE name = 'sub2');
  v_person uuid := (SELECT id FROM t42 WHERE name = 'person1');
  v_co uuid;
  v_profile uuid;
  v_session uuid;
  v_roster integer;
BEGIN
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_submission_accept('{"id":"%s","schedule":{"starts_at":"x"}}')$$, v_sub1),
    'invalid_schedule', '42/(j): nieczytelny termin odrzucony');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_submission_accept('{"id":"%s","schedule":{"starts_at":"%s","ends_at":"%s"}}')$$,
      v_sub1, now() + interval '30 days 2 hours', now() + interval '30 days 1 hour'),
    'invalid_schedule', '42/(j): koniec przed poczatkiem odrzucony');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_submission_accept('{"id":"%s","schedule":{"starts_at":"%s","ends_at":"%s","room_id":"42700000-0000-0000-0000-000000000071"}}')$$,
      v_sub1, now() + interval '30 days 1 hour', now() + interval '30 days 2 hours'),
    'room_not_found', '42/(j): sala spoza wydarzenia odrzucona');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_submission_accept('{"id":"%s","schedule":{"starts_at":"%s","ends_at":"%s","track_id":"42700000-0000-0000-0000-000000000079"}}')$$,
      v_sub1, now() + interval '30 days 1 hour', now() + interval '30 days 2 hours'),
    'track_not_found', '42/(j): sciezka spoza wydarzenia odrzucona');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_submission_accept('{"id":"%s","schedule":{"starts_at":"%s","ends_at":"%s","format":"tv"}}')$$,
      v_sub1, now() + interval '30 days 1 hour', now() + interval '30 days 2 hours'),
    'invalid_format', '42/(j): nieznany format sesji odrzucony');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_submission_accept('{"id":"%s","schedule":{"starts_at":"%s","ends_at":"%s"}}')$$,
      v_sub1, now() + interval '1 day', now() + interval '1 day 1 hour'),
    'session_before_event', '42/(j): sesja przed wydarzeniem odrzucona walidacja agendy');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_submission_accept('{"id":"%s","feedback_to_speaker":"%s"}')$$, v_sub1, repeat('x', 4001)),
    'invalid_note', '42/(j): informacja zwrotna ponad 4000 znakow odrzucona');

  -- Kolizja sali cofa CALE przyjecie (rejestr, kartoteki, zapisy).
  INSERT INTO public.event_sessions (tenant_id, event_id, room_id, title_pl, title_en, starts_at, ends_at)
  VALUES ('11111111-1111-1111-1111-111111111111', '42e00000-0000-0000-0000-0000000000e1',
          '42800000-0000-0000-0000-000000000081', 'Zajeta sala', 'Busy room',
          now() + interval '30 days 1 hour', now() + interval '30 days 2 hours');
  SELECT count(*) INTO v_roster FROM public.event_speaker_entries en
   WHERE en.event_id = '42e00000-0000-0000-0000-0000000000e1';
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_submission_accept('{"id":"%s","schedule":{"starts_at":"%s","ends_at":"%s","room_id":"42800000-0000-0000-0000-000000000081"}}')$$,
      v_sub1, now() + interval '30 days 90 minutes', now() + interval '30 days 150 minutes'),
    'room_conflict', '42/(j): kolizja sali odrzucona nazwanym bledem');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_speaker_entries en WHERE en.event_id = '42e00000-0000-0000-0000-0000000000e1') = v_roster
    AND NOT EXISTS (SELECT 1 FROM public.event_people p WHERE p.email_norm = 'wspolprelegent@example.org')
    AND (SELECT s.status FROM public.event_cfp_submissions s WHERE s.id = v_sub1) = 'under_review',
    '42/(j): po kolizji nic nie zostalo zapisane (rejestr, kartoteka, stan)');

  v := public.admin_event_cfp_submission_accept(jsonb_build_object('id', v_sub1,
    'decision_note', 'Swietny temat.', 'feedback_to_speaker', 'Gratulacje!',
    'schedule', jsonb_build_object(
      'starts_at', now() + interval '30 days 3 hours', 'ends_at', now() + interval '30 days 4 hours',
      'room_id', '42800000-0000-0000-0000-000000000081', 'format', 'hybrid')));
  v_profile := (v->>'speaker_profile_id')::uuid;
  v_session := (v->>'session_id')::uuid;
  INSERT INTO t42 VALUES ('profile1', v_profile), ('session1', v_session);
  PERFORM pg_temp.assert(
    v->>'status' = 'accepted' AND (v->>'speakers_enrolled')::int = 2 AND (v->>'registrations_created')::int = 2,
    '42/(j): przyjecie: dwoch wystepujacych w rejestrze, dwa zapisy');
  PERFORM pg_temp.assert(
    (SELECT sp.person_id = v_person FROM public.speaker_profiles sp WHERE sp.id = v_profile)
    AND EXISTS (SELECT 1 FROM public.event_speaker_entries en
                 WHERE en.event_id = '42e00000-0000-0000-0000-0000000000e1' AND en.speaker_profile_id = v_profile),
    '42/(j): nakladka osoby zglaszajacego w TYM SAMYM rejestrze prelegentow');
  SELECT sp.person_id INTO v_co FROM public.event_cfp_submission_speakers sp
   WHERE sp.submission_id = v_sub1 AND NOT sp.is_primary;
  PERFORM pg_temp.assert(
    (SELECT p.source = 'organizer' AND p.email_norm = 'wspolprelegent@example.org' AND p.consent_marketing_at IS NULL
       FROM public.event_people p WHERE p.id = v_co),
    '42/(j): kartoteka wspolprelegenta powstaje DOPIERO przy przyjeciu, bez zgody marketingowej');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_group_members m
      JOIN public.event_groups g ON g.id = m.group_id
     WHERE g.key = 'speakers' AND g.event_id = '42e00000-0000-0000-0000-0000000000e1'
       AND m.person_id IN (v_person, v_co)) = 2
    AND (SELECT count(*) FROM public.event_registrations r
          WHERE r.event_id = '42e00000-0000-0000-0000-0000000000e1' AND r.person_id IN (v_person, v_co)
            AND r.status = 'approved' AND r.registration_mode = 'form' AND r.payment_status = 'not_required'
            AND r.ticket_type_id = '42900000-0000-0000-0000-000000000091' AND r.source = 'invitation'
            AND r.decision_source = 'organizer') = 2
    AND (SELECT count(*) FROM public.domain_events d WHERE d.event_type = 'event.registration.created.v1'
          AND d.payload->>'person_id' IN (v_person::text, v_co::text)) = 2,
    '42/(j): grupa prelegentow i zapis approved z biletem prelegenta (kody biletow wysle istniejace zadanie)');
  PERFORM pg_temp.assert(
    (SELECT s.status = 'draft' AND s.format = 'hybrid' AND s.title_pl = 'Transformacja energetyczna'
        AND s.title_en = 'Transformacja energetyczna' AND s.room_id = '42800000-0000-0000-0000-000000000081'
        AND s.track_id = '42700000-0000-0000-0000-000000000071'
       FROM public.event_sessions s WHERE s.id = v_session)
    AND (SELECT count(*) FROM public.event_session_speakers ss WHERE ss.session_id = v_session) = 2
    AND (SELECT ss.role FROM public.event_session_speakers ss
          JOIN public.speaker_profiles sp ON sp.id = ss.speaker_profile_id
         WHERE ss.session_id = v_session AND sp.person_id = v_co) = 'panelist',
    '42/(j): szkic sesji z tytulem, sala, sciezka i obsada w rolach ze zgloszenia');
  PERFORM pg_temp.assert(
    (SELECT s.status = 'accepted' AND s.speaker_profile_id = v_profile AND s.session_id = v_session
        AND s.feedback_to_speaker = 'Gratulacje!'
       FROM public.event_cfp_submissions s WHERE s.id = v_sub1),
    '42/(j): zgloszenie przyjete z wynikiem (nakladka, sesja) i informacja zwrotna');
  PERFORM pg_temp.assert(
    (SELECT l.source_type = 'speaker' AND 'speaker' = ANY (l.tags) AND 'cfp:accepted' = ANY (l.tags)
       FROM public.crm_leads l JOIN public.event_person_crm_links k ON k.crm_lead_id = l.id
      WHERE k.person_id = v_person)
    AND (SELECT l.source_type = 'speaker' AND NOT ('cfp:accepted' = ANY (l.tags)) AND NOT l.marketing_consent
       FROM public.crm_leads l JOIN public.event_person_crm_links k ON k.crm_lead_id = l.id
      WHERE k.person_id = v_co)
    AND (SELECT sp.crm_lead_id IS NOT NULL FROM public.speaker_profiles sp WHERE sp.id = v_profile),
    '42/(j): CRM: obaj jako speaker, zglaszajacy z cfp:accepted, nakladka zna kontakt');
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM public.domain_events d WHERE d.event_type = 'event_cfp_submission.decided.v1'
             AND d.aggregate_id = v_sub1::text AND d.payload->>'status' = 'accepted'),
    '42/(j): zdarzenie domenowe przyjecia');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_submission_accept('{"id":"%s"}')$$, v_sub1),
    'invalid_transition', '42/(j): powtorne przyjecie odrzucone');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_submission_decide('{"id":"%s","status":"rejected","decision_note":"Jednak nie"}')$$, v_sub1),
    'invalid_transition', '42/(j): przyjetego nie da sie odrzucic decyzja');

  -- Drugie przyjecie tej samej osoby: ta sama nakladka, bez sesji i bez zapisu.
  v := public.admin_event_cfp_submission_accept(jsonb_build_object('id', v_sub2, 'register', false));
  PERFORM pg_temp.assert(
    (v->>'registrations_created')::int = 0 AND v->'session_id' = 'null'::jsonb
    AND (v->>'speaker_profile_id')::uuid = v_profile,
    '42/(j): drugie przyjecie tej samej osoby: ta sama nakladka, bez sesji i bez zapisu');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_speaker_entries en
      WHERE en.event_id = '42e00000-0000-0000-0000-0000000000e1' AND en.speaker_profile_id = v_profile) = 1,
    '42/(j): wpis rejestru nie dubluje sie przy drugim przyjeciu');
END
$do$;

-- ---------------------------------------------------------------------------
-- (k) ODPOWIEDZ PRELEGENTA, PANEL PRELEGENTA, PROFIL I MATERIALY
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v jsonb;
  v_sub1 uuid := (SELECT id FROM t42 WHERE name = 'sub1');
  v_sub3 uuid := (SELECT id FROM t42 WHERE name = 'sub3');
  v_profile uuid := (SELECT id FROM t42 WHERE name = 'profile1');
  v_session uuid := (SELECT id FROM t42 WHERE name = 'session1');
  v_mat uuid;
BEGIN
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000052');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_respond('{"id":"%s","confirm":true}')$$, v_sub1),
    'not_found', '42/(k): cudzy uzytkownik nie potwierdzi cudzego wystapienia');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_respond('{"id":"%s","confirm":true}')$$, v_sub3),
    'invalid_transition', '42/(k): odrzuconego zgloszenia nie da sie potwierdzic');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_respond('{"id":"%s","confirm":"tak"}')$$, v_sub3),
    'invalid_payload', '42/(k): odpowiedz musi byc tak albo nie');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_respond('{"id":"%s"}')$$, v_sub3),
    'invalid_payload', '42/(k): brak odpowiedzi NIE jest odwolaniem udzialu');
  v := public.event_my_speaker_panel('cfp-42');
  PERFORM pg_temp.assert(v->'profile' = 'null'::jsonb AND (v->>'submissions_count')::int = 2
    AND jsonb_array_length(v->'sessions') = 0 AND v->'person'->>'first_name' = 'Irena',
    '42/(k): osoba bez przyjecia: panel bez profilu i wystapien, z liczba zgloszen');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.event_my_speaker_profile_set('{"slug":"cfp-42","headline_pl":"X"}')$$,
    'not_speaker', '42/(k): osoba spoza rejestru nie zmieni nakladki');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.event_my_speaker_material_upsert('{"slug":"cfp-42","url":"https://example.org/a","title_pl":"A"}')$$,
    'not_speaker', '42/(k): osoba spoza rejestru nie doda materialu');

  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000051');
  v := public.event_cfp_submission_respond(jsonb_build_object('id', v_sub1, 'confirm', true));
  PERFORM pg_temp.assert(v->>'status' = 'confirmed'
    AND (SELECT s.confirmed_at IS NOT NULL FROM public.event_cfp_submissions s WHERE s.id = v_sub1)
    AND EXISTS (SELECT 1 FROM public.domain_events d WHERE d.event_type = 'event_cfp_submission.confirmed.v1'
                 AND d.aggregate_id = v_sub1::text AND d.payload->>'status' = 'confirmed'),
    '42/(k): potwierdzenie udzialu ze stemplem i zdarzeniem domenowym');

  v := public.event_my_speaker_panel('cfp-42');
  PERFORM pg_temp.assert(
    (v->'profile'->>'speaker_profile_id')::uuid = v_profile AND jsonb_array_length(v->'sessions') = 1
    AND v->'sessions'->0->>'status' = 'draft' AND v->'sessions'->0->>'room_name' = 'Sala A'
    AND v->'sessions'->0->>'role' = 'speaker' AND NOT (v->>'is_reviewer')::boolean,
    '42/(k): panel prelegenta: nakladka z rejestru i wstepne wystapienie z sala');
  PERFORM pg_temp.assert(public.event_my_speaker_panel('cfp-42-szkic') IS NULL,
    '42/(k): panel nieopublikowanego wydarzenia = NULL');

  v := public.event_my_cfp_submissions('cfp-42');
  PERFORM pg_temp.assert(
    jsonb_array_length(v->'items') = 2 AND v->'person'->>'first_name' = 'Piotr'
    AND (v->'person'->>'consent_marketing')::boolean
    AND (SELECT i->>'feedback_to_speaker' = 'Gratulacje!' AND (i->'review_summary'->>'reviews_count')::int = 1
                AND (i->'review_summary'->>'overall_avg')::numeric = 5
           FROM jsonb_array_elements(v->'items') i WHERE (i->>'id')::uuid = v_sub1)
    AND v::text NOT LIKE '%Mocny temat%' AND v::text NOT LIKE '%Skroc wstep%' AND v::text NOT LIKE '%Swietny temat%',
    '42/(k): moje zgloszenia: informacja zwrotna i ZAGREGOWANA ocena - bez komentarzy recenzentow i notatki');
  PERFORM pg_temp.assert(public.event_my_cfp_submissions('cfp-42-szkic') IS NULL,
    '42/(k): lista zgloszen nieopublikowanego wydarzenia = NULL');

  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.event_my_speaker_profile_set('{"slug":"cfp-42","card_photo_url":"http://niebezpieczne.example/a.jpg"}')$$,
    'invalid_profile', '42/(k): zdjecie karty tylko jako https');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.event_my_speaker_profile_set('{"slug":"cfp-42","languages":["polski"]}')$$,
    'invalid_profile', '42/(k): jezyk jako dwuliterowy kod');
  PERFORM public.event_my_speaker_profile_set(jsonb_build_object('slug', 'cfp-42',
    'headline_pl', 'Analityk rynku energii', 'topics_pl', jsonb_build_array('energia', ' OZE '),
    'languages', jsonb_build_array('PL', 'en'), 'card_photo_url', 'https://cdn.example.org/p.jpg'));
  PERFORM pg_temp.assert(
    (SELECT sp.headline_pl = 'Analityk rynku energii' AND sp.topics_pl = ARRAY['energia', 'OZE']
        AND sp.languages = ARRAY['pl', 'en'] AND sp.card_photo_url = 'https://cdn.example.org/p.jpg'
       FROM public.speaker_profiles sp WHERE sp.id = v_profile),
    '42/(k): prelegent zmienia WLASNA nakladke (naglowek, tematy, jezyki, zdjecie)');

  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.event_my_speaker_material_upsert('{"slug":"cfp-42","url":"ftp://example.org/a","title_pl":"A"}')$$,
    'invalid_url', '42/(k): material tylko jako adres https');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.event_my_speaker_material_upsert('{"slug":"cfp-42","url":"https://example.org/a","title_pl":"A","kind":"audio"}')$$,
    'invalid_kind', '42/(k): nieznany rodzaj materialu odrzucony');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.event_my_speaker_material_upsert('{"slug":"cfp-42","url":"https://example.org/a"}')$$,
    'invalid_title', '42/(k): material bez tytulu odrzucony');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.event_my_speaker_material_upsert('{"slug":"cfp-42","url":"https://example.org/a","title_pl":"A","visibility":"all"}')$$,
    'invalid_visibility', '42/(k): nieznana widocznosc odrzucona');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_my_speaker_material_upsert('{"slug":"cfp-42","url":"https://example.org/a","title_pl":"A","submission_id":"%s"}')$$, v_sub3),
    'invalid_submission', '42/(k): material nie przypnie sie do cudzego zgloszenia');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.event_my_speaker_material_upsert('{"slug":"cfp-42","url":"https://example.org/a","title_pl":"A","session_id":"42700000-0000-0000-0000-000000000071"}')$$,
    'invalid_session', '42/(k): material nie przypnie sie do cudzej sesji');
  v_mat := public.event_my_speaker_material_upsert(jsonb_build_object('slug', 'cfp-42',
    'kind', 'slides', 'title_pl', 'Prezentacja', 'url', 'https://example.org/slajdy.pdf',
    'visibility', 'public', 'submission_id', v_sub1, 'session_id', v_session));
  INSERT INTO t42 VALUES ('material1', v_mat);
  PERFORM pg_temp.assert(
    jsonb_array_length(public.event_my_speaker_panel('cfp-42')->'materials') = 1,
    '42/(k): material widoczny w panelu prelegenta');

  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert(
    (SELECT m.speaker_name = 'Piotr Prelegent' AND NOT m.is_published AND m.kind = 'slides'
       FROM public.admin_event_cfp_materials_list('42e00000-0000-0000-0000-0000000000e1') m WHERE m.id = v_mat),
    '42/(k): organizator widzi material prelegenta jako nieopublikowany');
  PERFORM pg_temp.assert(public.admin_event_cfp_material_publish(jsonb_build_object('id', v_mat, 'is_published', true)),
    '42/(k): publikacja zwraca nowy stan');
  PERFORM pg_temp.assert((SELECT m.is_published AND m.published_at IS NOT NULL FROM public.event_speaker_materials m WHERE m.id = v_mat),
    '42/(k): organizator publikuje material');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_material_publish('{"id":"%s"}')$$, v_mat),
    'invalid_payload', '42/(k): publikacja bez decyzji tak/nie odrzucona');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_material_publish('{"id":"42000000-0000-0000-0000-00000000dead","is_published":true}')$$,
    'not_found', '42/(k): publikacja nieistniejacego materialu = not_found');

  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000051');
  PERFORM public.event_my_speaker_material_upsert(jsonb_build_object('id', v_mat, 'visibility', 'public'));
  PERFORM pg_temp.assert(
    (SELECT m.is_published FROM public.event_speaker_materials m WHERE m.id = v_mat),
    '42/(k): zapis bez zmiany tresci zostawia publikacje');
  PERFORM public.event_my_speaker_material_upsert(jsonb_build_object('id', v_mat, 'url', 'https://example.org/v2.pdf'));
  PERFORM pg_temp.assert(
    (SELECT NOT m.is_published AND m.published_at IS NULL AND m.url = 'https://example.org/v2.pdf'
       FROM public.event_speaker_materials m WHERE m.id = v_mat),
    '42/(k): zmiana adresu zdejmuje publikacje - wraca do zatwierdzenia');

  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000052');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_my_speaker_material_delete('%s')$$, v_mat),
    'not_found', '42/(k): cudzy uzytkownik nie usunie materialu');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_my_speaker_material_upsert('{"id":"%s","title_pl":"Przejete"}')$$, v_mat),
    'not_found', '42/(k): cudzy uzytkownik nie zmieni materialu');
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000051');
  PERFORM pg_temp.assert(public.event_my_speaker_material_delete(v_mat), '42/(k): usuniecie zwraca prawde');
  PERFORM pg_temp.assert(NOT EXISTS (SELECT 1 FROM public.event_speaker_materials m WHERE m.id = v_mat),
    '42/(k): prelegent usuwa wlasny material');
END
$do$;

-- ---------------------------------------------------------------------------
-- (l) POWIADOMIENIA, WYCOFANIE, USUWANIE RECENZENTA
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v jsonb;
  v_sub1 uuid := (SELECT id FROM t42 WHERE name = 'sub1');
  v_sub2 uuid := (SELECT id FROM t42 WHERE name = 'sub2');
  v_sub3 uuid := (SELECT id FROM t42 WHERE name = 'sub3');
  v_draft uuid := (SELECT id FROM t42 WHERE name = 'draft3');
BEGIN
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  v := public.admin_event_cfp_notify_payload(v_sub3);
  PERFORM pg_temp.assert(
    v->>'notice' = 'rejected' AND v->>'email' = 'inny.uzytkownik@example.org'
    AND v->>'feedback_to_speaker' = 'Dziekujemy, temat poza profilem.' AND v->>'decided_at' IS NOT NULL
    AND (v->>'tenant_id')::uuid = '11111111-1111-1111-1111-111111111111',
    '42/(l): ladunek maila o odrzuceniu: adres, informacja zwrotna, stempel decyzji');
  v := public.admin_event_cfp_notify_payload(v_sub1);
  PERFORM pg_temp.assert(v->'notice' = 'null'::jsonb AND v->>'status' = 'confirmed'
    AND v->>'session_starts_at' IS NOT NULL,
    '42/(l): potwierdzone zgloszenie nie ma juz powiadomienia do wyslania');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_notify_payload('%s')$$, v_draft),
    'not_found', '42/(l): szkic nie ma ladunku powiadomienia');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_mark_notified('{"submission_id":"%s","status":"submitted"}')$$, v_sub3),
    'invalid_status', '42/(l): stempel tylko dla powiadamianych stanow');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.admin_event_cfp_mark_notified('{"submission_id":"42000000-0000-0000-0000-00000000dead","status":"rejected"}')$$,
    'not_found', '42/(l): stempel nieistniejacego zgloszenia = not_found');
  PERFORM pg_temp.assert(
    NOT public.admin_event_cfp_mark_notified(jsonb_build_object('submission_id', v_sub3, 'status', 'rejected', 'error', 'smtp down')),
    '42/(l): stempel z bledem zwraca falsz');
  PERFORM pg_temp.assert(
    (SELECT s.notify_error = 'smtp down' AND s.notified_status IS NULL FROM public.event_cfp_submissions s WHERE s.id = v_sub3),
    '42/(l): nieudana wysylka zostawia blad, bez stempla');
  PERFORM pg_temp.assert(
    public.admin_event_cfp_mark_notified(jsonb_build_object('submission_id', v_sub3, 'status', 'rejected')),
    '42/(l): udany stempel zwraca prawde');
  PERFORM pg_temp.assert(
    (SELECT s.notified_status = 'rejected' AND s.notified_at IS NOT NULL AND s.notify_error IS NULL
           FROM public.event_cfp_submissions s WHERE s.id = v_sub3),
    '42/(l): udana wysylka stempluje stan i czysci blad');

  -- Ladunek "zgloszenie otrzymane": tylko wlasciciel, najemca z wiersza.
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000051');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_notice('%s')$$, v_sub3),
    'not_found', '42/(l): cudzy ladunek maila niedostepny');
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000052');
  v := public.event_cfp_submission_notice(v_sub3);
  PERFORM pg_temp.assert(v->>'email' = 'inny.uzytkownik@example.org'
    AND (v->>'tenant_id')::uuid = '11111111-1111-1111-1111-111111111111' AND v->>'event_slug' = 'cfp-42',
    '42/(l): wlasciciel dostaje ladunek maila z najemca z wiersza');
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_notice('%s')$$, v_sub3),
    'auth_required', '42/(l): anonim nie dostanie ladunku maila');

  -- Wycofanie: szkic znika, odrzucone nie wraca.
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000052');
  v := public.event_cfp_submission_withdraw(jsonb_build_object('id', v_draft));
  PERFORM pg_temp.assert(v->>'status' = 'deleted'
    AND NOT EXISTS (SELECT 1 FROM public.event_cfp_submissions s WHERE s.id = v_draft),
    '42/(l): wycofany szkic znika bez sladu');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_withdraw('{"id":"%s"}')$$, v_sub3),
    'invalid_transition', '42/(l): odrzuconego zgloszenia nie da sie wycofac');
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_withdraw('{"id":"%s"}')$$, v_sub3),
    'auth_required', '42/(l): anonim nie wycofa zgloszenia');

  -- Wycofanie przyjetego zwalnia miejsce w limicie (limit 2, dwa zgloszenia).
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000051');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.event_cfp_submission_save('{"slug":"cfp-42","title_pl":"Trzecie"}')$$,
    'limit_reached', '42/(l): przyjete i potwierdzone zgloszenia licza sie do limitu');
  v := public.event_cfp_submission_withdraw(jsonb_build_object('id', v_sub2));
  PERFORM pg_temp.assert(v->>'status' = 'withdrawn'
    AND (SELECT s.withdrawn_at IS NOT NULL FROM public.event_cfp_submissions s WHERE s.id = v_sub2)
    AND EXISTS (SELECT 1 FROM public.domain_events d WHERE d.event_type = 'event_cfp_submission.withdrawn.v1'
                 AND d.aggregate_id = v_sub2::text),
    '42/(l): wycofanie przyjetego zgloszenia ze stemplem i zdarzeniem domenowym');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_withdraw('{"id":"%s"}')$$, v_sub2),
    'invalid_transition', '42/(l): drugie wycofanie odrzucone');
  v := public.event_cfp_submission_save(jsonb_build_object('slug', 'cfp-42', 'title_pl', 'Trzecie'));
  PERFORM pg_temp.assert(v->>'status' = 'draft',
    '42/(l): wycofane zgloszenie nie liczy sie do limitu');

  -- Recenzent z ocenami tylko dezaktywowany, bez ocen - usuniety.
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert(
    public.admin_event_cfp_reviewer_remove((SELECT id FROM t42 WHERE name = 'r1')) = 'deactivated',
    '42/(l): recenzent z ocenami: wynik deactivated');
  PERFORM pg_temp.assert(
    (SELECT NOT rv.is_active FROM public.event_cfp_reviewers rv WHERE rv.id = (SELECT id FROM t42 WHERE name = 'r1'))
    AND (SELECT count(*) FROM public.event_cfp_reviews r WHERE r.reviewer_id = (SELECT id FROM t42 WHERE name = 'r1')) = 2,
    '42/(l): recenzent z ocenami tylko dezaktywowany - oceny zostaja');
  PERFORM pg_temp.assert(
    public.admin_event_cfp_reviewer_remove((SELECT id FROM t42 WHERE name = 'r3')) = 'deleted',
    '42/(l): recenzent bez ocen: wynik deleted');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.event_cfp_reviewers rv WHERE rv.id = (SELECT id FROM t42 WHERE name = 'r3')),
    '42/(l): recenzent bez ocen usuniety');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.admin_event_cfp_reviewer_remove('%s')$$, (SELECT id FROM t42 WHERE name = 'r3')),
    'not_found', '42/(l): usuniecie nieistniejacego recenzenta = not_found');
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000061');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.event_cfp_review_queue('cfp-42')$$,
    'not_reviewer', '42/(l): dezaktywowany recenzent traci kolejke');
END
$do$;

-- ---------------------------------------------------------------------------
-- (m) IZOLACJA NAJEMCOW NA PLASZCZYZNIE WLASNEJ I RECENZENTA, BRAMKA
--     CZESTOTLIWOSCI, RLS PRZEZ SET ROLE (wlasciciel bazy omija RLS)
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_sub1 uuid := (SELECT id FROM t42 WHERE name = 'sub1');
  v_hit text := NULL;
  v_draft uuid;
  i integer;
BEGIN
  -- Host najemcy B: ten sam uzytkownik nie siega do zgloszen z najemcy A.
  PERFORM set_config('nes.public_tenant', '42000000-0000-0000-0000-0000000000b0', false);
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000051');
  PERFORM pg_temp.assert_raises_like(
    format($$SELECT public.event_cfp_submission_withdraw('{"id":"%s"}')$$, v_sub1),
    'not_found', '42/(m): host najemcy B nie wycofa zgloszenia z najemcy A');
  PERFORM pg_temp.assert(
    jsonb_array_length(public.event_my_cfp_submissions('cfp-42')->'items') = 0,
    '42/(m): host najemcy B: lista zgloszen z wydarzenia B, bez zgloszen z A');
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000062');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.event_cfp_review_queue('cfp-42')$$,
    'not_reviewer', '42/(m): recenzent najemcy A nie jest recenzentem wydarzenia B');
  PERFORM set_config('nes.public_tenant', '', false);

  -- Bramka czestotliwosci zapisu szkicu (60 na 10 minut).
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000051');
  SELECT s.id INTO v_draft FROM public.event_cfp_submissions s
   WHERE s.event_id = '42e00000-0000-0000-0000-0000000000e1' AND s.status = 'draft'
     AND s.title_pl = 'Trzecie';
  FOR i IN 1..70 LOOP
    BEGIN
      PERFORM public.event_cfp_submission_save(jsonb_build_object('id', v_draft, 'title_pl', 'Trzecie ' || i));
    EXCEPTION WHEN OTHERS THEN
      v_hit := SQLERRM;
      EXIT;
    END;
  END LOOP;
  PERFORM pg_temp.assert(v_hit LIKE 'rate_limited:%',
    '42/(m): seria zapisow szkicu zatrzymana bramka czestotliwosci (' || COALESCE(v_hit, 'brak') || ')');
END
$do$;

-- ---------------------------------------------------------------------------
-- (n) EKSPORT RODO WOLAJACEGO (`event_cfp_export_my_data`)
--
-- Paczka danych osobowych zawiera zgloszenia (wlasne i z udzialem wolajacego),
-- materialy prelegenta, role i WLASNE oceny recenzenta - a NIE zawiera notatki
-- decyzji, cudzych ocen o zgloszeniu ani danych kontaktowych wspolprelegentow.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v jsonb;
  v_item jsonb;
  v_sub1 uuid := (SELECT id FROM t42 WHERE name = 'sub1');
  v_profile uuid := (SELECT id FROM t42 WHERE name = 'profile1');
  v_co uuid;
BEGIN
  PERFORM pg_temp.assert(
    NOT has_function_privilege('anon', 'public.event_cfp_export_my_data(integer)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.event_cfp_export_my_data(integer)', 'EXECUTE'),
    '42/(n): eksport tylko dla zalogowanych');
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.event_cfp_export_my_data(10)$$, 'auth_required', '42/(n): anonim nie eksportuje');
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-0000000000ff');
  PERFORM pg_temp.assert_raises_like(
    $$SELECT public.event_cfp_export_my_data(10)$$, 'not_found', '42/(n): konto bez profilu = not_found');

  INSERT INTO public.event_speaker_materials (tenant_id, event_id, speaker_profile_id, kind, title_pl, url, visibility)
  VALUES ('11111111-1111-1111-1111-111111111111', '42e00000-0000-0000-0000-0000000000e1', v_profile,
          'document', 'Tekst wystapienia', 'https://example.org/tekst.pdf', 'registered');

  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000051');
  v := public.event_cfp_export_my_data(NULL);
  PERFORM pg_temp.assert(jsonb_array_length(v->'event_cfp_submissions') = 3,
    '42/(n): zglaszajacy dostaje WSZYSTKIE swoje zgloszenia (przyjete, wycofane, szkic) (dostano: '
    || jsonb_array_length(v->'event_cfp_submissions') || ')');
  SELECT e INTO v_item FROM jsonb_array_elements(v->'event_cfp_submissions') e
   WHERE e->>'title_pl' = 'Transformacja energetyczna';
  PERFORM pg_temp.assert(
    (v_item->>'is_submitter')::boolean AND v_item->>'status' = 'confirmed'
    AND v_item->>'event_slug' = 'cfp-42' AND v_item->>'track_name_pl' = 'Energia'
    AND v_item->>'feedback_to_speaker' = 'Gratulacje!' AND v_item->>'notify_lang' = 'en'
    AND v_item->'my_roles' = '["speaker"]'::jsonb
    AND (v_item->'review_summary'->>'reviews_count')::int >= 1
    AND v_item->'review_summary'->'overall_avg' <> 'null'::jsonb,
    '42/(n): zgloszenie z trescia, stanem, informacja zwrotna i ocena ZBIORCZA po decyzji');
  PERFORM pg_temp.assert(
    v_item->'co_speakers' = '[{"first_name":"Wanda","last_name":"Wspol","role":"panelist"}]'::jsonb,
    '42/(n): wspolprelegent tylko imieniem, nazwiskiem i rola - bez adresu e-mail');
  PERFORM pg_temp.assert(
    position('Swietny temat' IN v::text) = 0 AND position('Mocny temat' IN v::text) = 0
    AND position('wspolprelegent@' IN lower(v::text)) = 0 AND NOT (v_item ? 'decision_note'),
    '42/(n): bez notatki decyzji, cudzych ocen i adresu wspolprelegenta');
  PERFORM pg_temp.assert(
    jsonb_array_length(v->'event_speaker_materials') = 1
    AND v->'event_speaker_materials'->0->>'url' = 'https://example.org/tekst.pdf'
    AND v->'event_speaker_materials'->0->>'visibility' = 'registered',
    '42/(n): materialy nakladki scenicznej wolajacego');
  PERFORM pg_temp.assert(
    v->'event_cfp_reviewer_roles' = '[]'::jsonb AND v->'event_cfp_reviews_written' = '[]'::jsonb,
    '42/(n): prelegent bez roli recenzenta ma puste sekcje recenzenta');
  PERFORM pg_temp.assert(
    jsonb_array_length(public.event_cfp_export_my_data(1)->'event_cfp_submissions') = 1
    AND jsonb_array_length(public.event_cfp_export_my_data(0)->'event_cfp_submissions') = 1,
    '42/(n): sufit wierszy dziala i nie schodzi ponizej jednego');

  -- Recenzent: rola i WLASNE oceny, bez danych prelegenta.
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000061');
  v := public.event_cfp_export_my_data(100);
  PERFORM pg_temp.assert(
    jsonb_array_length(v->'event_cfp_reviewer_roles') = 1
    AND NOT (v->'event_cfp_reviewer_roles'->0->>'is_active')::boolean
    AND v->'event_cfp_reviewer_roles'->0->>'event_slug' = 'cfp-42',
    '42/(n): rola recenzenta (takze dezaktywowana) jest w eksporcie');
  PERFORM pg_temp.assert(
    jsonb_array_length(v->'event_cfp_reviews_written') = 2
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v->'event_cfp_reviews_written') e
                 WHERE e->>'comment_private' = 'Mocny temat.'
                   AND e->>'submission_title_pl' = 'Transformacja energetyczna'),
    '42/(n): wlasne oceny recenzenta z wlasnym komentarzem i tytulem zgloszenia');
  PERFORM pg_temp.assert(position('Piotr' IN v::text) = 0 AND v->'event_cfp_submissions' = '[]'::jsonb,
    '42/(n): eksport recenzenta nie niesie danych prelegenta');

  -- Wspolprelegent z kontem, ktorego kartoteka przyjecia jest powiazana z kontem.
  SELECT sp.person_id INTO v_co FROM public.event_cfp_submission_speakers sp
   WHERE sp.submission_id = v_sub1 AND NOT sp.is_primary;
  UPDATE public.event_people p SET user_id = '42a00000-0000-0000-0000-000000000063' WHERE p.id = v_co;
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-000000000063');
  v := public.event_cfp_export_my_data(100);
  PERFORM pg_temp.assert(
    jsonb_array_length(v->'event_cfp_submissions') = 1
    AND NOT (v->'event_cfp_submissions'->0->>'is_submitter')::boolean
    AND v->'event_cfp_submissions'->0->'my_roles' = '["panelist"]'::jsonb
    AND v->'event_cfp_submissions'->0->'co_speakers' = '[{"first_name":"Piotr","last_name":"Prelegent","role":"speaker"}]'::jsonb
    AND position('prelegent.jeden' IN lower(v::text)) = 0,
    '42/(n): wspolprelegent dostaje zgloszenie ze swoja rola, zglaszajacy bez adresu');

  -- Izolacja najemcow: uzytkownik najemcy B nie widzi niczego z A.
  PERFORM pg_temp.act_as('42a00000-0000-0000-0000-0000000000b2');
  v := public.event_cfp_export_my_data(100);
  PERFORM pg_temp.assert(
    v->'event_cfp_submissions' = '[]'::jsonb AND v->'event_speaker_materials' = '[]'::jsonb
    AND v->'event_cfp_reviewer_roles' = '[]'::jsonb AND v->'event_cfp_reviews_written' = '[]'::jsonb,
    '42/(n): najemca B: pusta paczka, nic z najemcy A');
  PERFORM pg_temp.act_as();
END
$do$;

SELECT pg_temp.act_as('42a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_cfp_submissions WHERE event_id = '42e00000-0000-0000-0000-0000000000e1') >= 3
  AND (SELECT count(*) FROM public.event_cfp_reviews) >= 2,
  '42/(m): admin najemcy czyta zgloszenia i oceny przez polityke');
RESET ROLE;

SELECT pg_temp.act_as('42a00000-0000-0000-0000-000000000051', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_cfp_submissions) = 0
  AND (SELECT count(*) FROM public.event_cfp_submission_speakers) = 0,
  '42/(m): zglaszajacy NIE czyta tabel wprost (tylko przez RPC)');
RESET ROLE;

SELECT pg_temp.act_as('42a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_cfp_reviews) = 0 AND (SELECT count(*) FROM public.event_cfp_settings) = 0,
  '42/(m): redaktor nie czyta ocen ani ustawien');
RESET ROLE;

SELECT pg_temp.act_as('42a00000-0000-0000-0000-0000000000b1', '42000000-0000-0000-0000-0000000000b0');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_cfp_submissions) = 0,
  '42/(m): admin najemcy B nie widzi zgloszen najemcy A');
RESET ROLE;

SELECT pg_temp.act_as();
SET ROLE anon;
SELECT pg_temp.assert_raises_like(
  $$SELECT count(*) FROM public.event_cfp_submissions$$,
  'permission denied', '42/(m): anonim bez grantu odczytu');
RESET ROLE;

SELECT pg_temp.act_as();

ROLLBACK;

\echo '== 42 nabor prelegentow: koniec =='
