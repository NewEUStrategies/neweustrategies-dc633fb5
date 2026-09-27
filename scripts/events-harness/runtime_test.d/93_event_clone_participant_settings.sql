-- ============================================================================
-- 93_event_clone_participant_settings - KLON EDYCJI: USTAWIENIA UCZESTNIKA,
-- STREFA ZRODLA I DANE NIEPRZENIESIONE (migracja 20260927001300)
--
-- PO CO TEN PLIK ISTNIEJE
-- Przeglad klonu (20260927000800..000802) znalazl trzy luki, ktorych nie
-- widac w lekturze SQL-a, a ktore 92_event_clone.sql przepuszczal:
--   (a) ustawienia uczestnika (#406) nie przechodzily - nowa edycja cicho
--       wracala do wartosci domyslnych (zwrot 168 h, przekazanie wlaczone),
--       a teksty certyfikatu i ankiety znikaly;
--   (b) strefa zrodla spoza DOKLADNYCH nazw `pg_timezone_names`
--       ('america/new_york', ktora zapisuje panel) zamieniala sie na
--       Europe/Warsaw; formularz odsyla strefe zrodla z podgladu, wiec
--       poprawka samego zrodla wywracalaby klon na `invalid_timezone`;
--   (c) zakladki sesji, zapisy na sesje i przepustki portfela nie byly
--       liczone jako dane, ktorych klon nie przenosi.
--
-- CZEGO TU DOWODZIMY
--   * wiersz ustawien kopii = wiersz zrodla (kazda kolumna konfiguracji),
--     najemca i wydarzenie kopii, `updated_by` = aktor klonu; zrodlo
--     nietkniete; liczniki podgladu i wynik klonu (`participant_settings`);
--   * zrodlo bez wiersza -> kopia bez wiersza (`copied` 0, wartosci domyslne);
--   * strefa zrodla 'america/new_york': podglad pokazuje ja bez zmian, klon
--     ze strefa pominieta i ze strefa odeslana z podgladu przechodzi, nowa
--     edycja ma te strefe, sesja 09:00 zostaje 09:00 czasu lokalnego (przez
--     zmiane czasu w USA); strefa gieldy rowna strefie wydarzenia bez
--     wielkosci liter idzie za nowa strefa;
--   * nieznana strefa zrodla ('Mars/Base') -> Europe/Warsaw bez wyjatku;
--     nieznana strefa celu nadal odrzucana;
--   * zakladki sesji, zapisy na sesje i przepustki w `not_copied`/`skipped`,
--     kopia nie ma zadnego z tych wierszy;
--   * granty nowego pomocnika (tylko service_role, SECURITY DEFINER).
--
-- CZEGO NIE SPRAWDZA: reszty klonu - to robi 92_event_clone.sql.
--
-- DATY SA WZGLEDNE DO BIEZACEGO ROKU (rok+1 zrodlo, rok+2 kopia): 1 marca
-- jest zawsze przed zmiana czasu w USA (druga niedziela marca >= 8.), 10
-- kwietnia zawsze po niej.
--
-- SPRZATANIE. Caly plik pracuje w transakcji zakonczonej ROLLBACK-iem.
-- ============================================================================

\echo '== 93 klon edycji: ustawienia uczestnika, strefa zrodla, dane nieprzeniesione =='

BEGIN;

-- Czas lokalny w strefie w roku biezacy+offset.
CREATE OR REPLACE FUNCTION pg_temp.t93(
  _year_offset int, _month int, _day int, _hour int, _minute int, _tz text DEFAULT 'Europe/Warsaw'
) RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT make_timestamptz(extract(year FROM now())::int + _year_offset, _month, _day, _hour,
                          _minute, 0, _tz);
$$;

CREATE OR REPLACE FUNCTION pg_temp.hm93(_ts timestamptz, _tz text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT to_char(_ts AT TIME ZONE _tz, 'HH24:MI'); $$;

CREATE TEMP TABLE f93 (k text PRIMARY KEY, v jsonb) ON COMMIT DROP;
CREATE OR REPLACE FUNCTION pg_temp.f93_id(_k text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT (v->>'event_id')::uuid FROM f93 WHERE k = _k;
$$;

-- Wiersz ustawien bez kolumn, ktore kopia MA miec inne (tozsamosc, czas, autor).
CREATE OR REPLACE FUNCTION pg_temp.cfg93(_event uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT to_jsonb(s) - 'id' - 'tenant_id' - 'event_id' - 'created_at' - 'updated_at' - 'updated_by'
    FROM public.event_participant_settings s WHERE s.event_id = _event;
$$;

-- ---------------------------------------------------------------------------
-- SCENOGRAFIA (najemca A z atrapy)
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('93a00000-0000-0000-0000-0000000000a1', 'klon93.admin@example.org'),
  ('93a00000-0000-0000-0000-0000000000a2', 'klon93.poprzedni@example.org'),
  ('93a00000-0000-0000-0000-0000000000a3', 'klon93.uczestnik@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('93a00000-0000-0000-0000-0000000000a1', 'admin', '11111111-1111-1111-1111-111111111111'),
  ('93a00000-0000-0000-0000-0000000000a2', 'admin', '11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, slug) VALUES
  ('93a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Admin 93', 'klon93-admin'),
  ('93a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'Poprzedni 93', 'klon93-poprzedni'),
  ('93a00000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'Uczestnik 93', 'klon93-uczestnik')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, ends_at, timezone, status) VALUES
  -- E1: ustawienia uczestnika inne niz domyslne + dane osobowe, ktorych klon nie przenosi.
  ('93e00000-0000-0000-0000-0000000000e1', '11111111-1111-1111-1111-111111111111',
   'ustawienia-93', 'Ustawienia 93', 'Settings 93',
   pg_temp.t93(1, 5, 10, 9, 0), pg_temp.t93(1, 5, 10, 18, 0), 'Europe/Warsaw', 'published'),
  -- E2: bez wiersza ustawien.
  ('93e00000-0000-0000-0000-0000000000e2', '11111111-1111-1111-1111-111111111111',
   'domyslne-93', 'Domyslne 93', 'Defaults 93',
   pg_temp.t93(1, 5, 12, 9, 0), pg_temp.t93(1, 5, 12, 18, 0), 'Europe/Warsaw', 'published'),
  -- E3: strefa zapisana mala litera (przyjmuje ja Postgres, Intl i panel).
  ('93e00000-0000-0000-0000-0000000000e3', '11111111-1111-1111-1111-111111111111',
   'nowy-jork-93', 'Nowy Jork 93', 'New York 93',
   pg_temp.t93(1, 3, 1, 9, 0, 'America/New_York'), pg_temp.t93(1, 3, 1, 18, 0, 'America/New_York'),
   'america/new_york', 'published'),
  -- E4: strefa, ktorej nie zna nikt.
  ('93e00000-0000-0000-0000-0000000000e4', '11111111-1111-1111-1111-111111111111',
   'mars-93', 'Mars 93', 'Mars 93',
   pg_temp.t93(1, 6, 1, 9, 0), pg_temp.t93(1, 6, 1, 12, 0), 'Mars/Base', 'published');

-- Wszystko inne niz wartosci domyslne `event_participant_settings`.
INSERT INTO public.event_participant_settings (
  tenant_id, event_id, calendar_export_enabled, reminders_enabled, reminder_event_leads_minutes,
  session_reminders_enabled, session_reminder_lead_minutes, reminder_sms_enabled,
  transfer_enabled, transfer_deadline_hours, refund_mode, refund_deadline_hours,
  waitlist_offer_hours, certificate_enabled, certificate_eligibility, certificate_min_sessions,
  certificate_require_survey, certificate_hours, certificate_issuer_name,
  certificate_signatory_name, certificate_signatory_title_pl, certificate_signatory_title_en,
  certificate_body_pl, certificate_body_en, survey_enabled, survey_anonymous,
  survey_close_after_days, survey_min_results, survey_invite_enabled, survey_intro_pl,
  survey_intro_en, updated_by
) VALUES (
  '11111111-1111-1111-1111-111111111111', '93e00000-0000-0000-0000-0000000000e1',
  false, false, '{2880,120}', false, 30, true,
  false, 48, 'none', 72,
  12, true, 'sessions_min', 3,
  true, 6.5, 'Instytut 93',
  'Anna Podpis', 'Dyrektorka programowa', 'Programme director',
  'Za udzial w kongresie 93', 'For attending congress 93', true, false,
  30, 10, false, 'Jak bylo w 93?',
  'How was 93?', '93a00000-0000-0000-0000-0000000000a2'
);

-- Dane osobowe E1: sesja, osoba, zgloszenie, zakladka, zapis na sesje, przepustka.
INSERT INTO public.event_sessions (id, tenant_id, event_id, title_pl, title_en, starts_at, ends_at, status) VALUES
  ('93300000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '93e00000-0000-0000-0000-0000000000e1', 'Sesja 93', 'Session 93',
   pg_temp.t93(1, 5, 10, 10, 0), pg_temp.t93(1, 5, 10, 11, 0), 'published'),
  ('93300000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   '93e00000-0000-0000-0000-0000000000e3', 'Otwarcie NY', 'Opening NY',
   pg_temp.t93(1, 3, 1, 9, 0, 'America/New_York'), pg_temp.t93(1, 3, 1, 10, 0, 'America/New_York'),
   'published');
INSERT INTO public.event_people (id, tenant_id, first_name, last_name, email, source) VALUES
  ('93700000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'Uczestnik', 'Klonu', 'uczestnik93@example.org', 'self_registration');
INSERT INTO public.event_registrations (id, tenant_id, event_id, person_id, status, registration_mode) VALUES
  ('93420000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '93e00000-0000-0000-0000-0000000000e1', '93700000-0000-0000-0000-0000000000a1', 'approved', 'form');
INSERT INTO public.event_session_saves (tenant_id, event_id, session_id, user_id) VALUES
  ('11111111-1111-1111-1111-111111111111', '93e00000-0000-0000-0000-0000000000e1',
   '93300000-0000-0000-0000-0000000000a1', '93a00000-0000-0000-0000-0000000000a3');
INSERT INTO public.event_session_signups (tenant_id, event_id, session_id, user_id, status) VALUES
  ('11111111-1111-1111-1111-111111111111', '93e00000-0000-0000-0000-0000000000e1',
   '93300000-0000-0000-0000-0000000000a1', '93a00000-0000-0000-0000-0000000000a3', 'registered');
INSERT INTO public.event_wallet_passes (tenant_id, event_id, registration_id, platform, object_id) VALUES
  ('11111111-1111-1111-1111-111111111111', '93e00000-0000-0000-0000-0000000000e1',
   '93420000-0000-0000-0000-0000000000a1', 'apple', 'pass-93-apple');

-- Gielda E3 w strefie zapisanej inna wielkoscia liter niz strefa wydarzenia.
INSERT INTO public.event_meeting_settings (id, tenant_id, event_id, is_enabled, meeting_days, timezone) VALUES
  ('93c10000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   '93e00000-0000-0000-0000-0000000000e3', true,
   ARRAY[(pg_temp.t93(1, 3, 1, 12, 0, 'America/New_York') AT TIME ZONE 'America/New_York')::date],
   'America/New_York');

SELECT pg_temp.act_as('93a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');

-- ---------------------------------------------------------------------------
-- SEKCJA 1: GRANTY NOWEGO POMOCNIKA
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public._event_clone_participant_settings(uuid, uuid, uuid, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_clone_participant_settings(uuid, uuid, uuid, jsonb)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public._event_clone_participant_settings(uuid, uuid, uuid, jsonb)', 'EXECUTE'),
  '93/granty: pomocnik ustawien uczestnika tylko dla service_role');
SELECT pg_temp.assert(
  (SELECT p.prosecdef AND array_to_string(p.proconfig, ',') LIKE '%search_path=public, pg_temp%'
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_event_clone_participant_settings'),
  '93/granty: pomocnik jest SECURITY DEFINER z search_path public, pg_temp');

-- ---------------------------------------------------------------------------
-- SEKCJA 2: PODGLAD - licznik ustawien i dane, ktorych klon nie przeniesie
-- ---------------------------------------------------------------------------
INSERT INTO f93 VALUES ('preview_e1', public.admin_event_clone_preview(
  jsonb_build_object('source_event_id', '93e00000-0000-0000-0000-0000000000e1')));
INSERT INTO f93 VALUES ('preview_e2', public.admin_event_clone_preview(
  jsonb_build_object('source_event_id', '93e00000-0000-0000-0000-0000000000e2')));

SELECT pg_temp.assert(
  (SELECT (v->'counts'->>'participant_settings')::int = 1 FROM f93 WHERE k = 'preview_e1')
  AND (SELECT (v->'counts'->>'participant_settings')::int = 0 FROM f93 WHERE k = 'preview_e2'),
  '93/podglad: licznik ustawien uczestnika (1 z wierszem, 0 bez)');
SELECT pg_temp.assert(
  (SELECT (v->'not_copied'->>'session_saves')::int = 1 AND (v->'not_copied'->>'session_signups')::int = 1
      AND (v->'not_copied'->>'wallet_passes')::int = 1 AND (v->'not_copied'->>'registrations')::int = 1
     FROM f93 WHERE k = 'preview_e1'),
  '93/podglad: zakladki sesji, zapisy na sesje i przepustki portfela sa policzone');
SELECT pg_temp.assert(
  (SELECT (v->'not_copied'->>'session_saves')::int = 0 AND (v->'not_copied'->>'wallet_passes')::int = 0
     FROM f93 WHERE k = 'preview_e2'),
  '93/podglad: zrodlo bez danych osobowych ma zera');

-- ---------------------------------------------------------------------------
-- SEKCJA 3: KLON Z USTAWIENIAMI
-- ---------------------------------------------------------------------------
INSERT INTO f93 VALUES ('e1', public.admin_event_clone(jsonb_build_object(
  'source_event_id', '93e00000-0000-0000-0000-0000000000e1', 'title_pl', 'Ustawienia 93 kopia',
  'title_en', 'Settings 93 copy', 'starts_at', pg_temp.t93(2, 5, 10, 9, 0))));

SELECT pg_temp.assert(
  (SELECT (v->'copied'->>'participant_settings')::int = 1 FROM f93 WHERE k = 'e1'),
  '93/klon: wynik raportuje skopiowane ustawienia uczestnika');
SELECT pg_temp.assert(
  pg_temp.cfg93(pg_temp.f93_id('e1')) = pg_temp.cfg93('93e00000-0000-0000-0000-0000000000e1')
  AND pg_temp.cfg93(pg_temp.f93_id('e1')) IS NOT NULL,
  '93/klon: kazda kolumna konfiguracji kopii rowna zrodlu');
SELECT pg_temp.assert(
  (SELECT s.refund_mode = 'none' AND s.refund_deadline_hours = 72 AND NOT s.transfer_enabled
      AND s.reminder_event_leads_minutes = '{2880,120}' AND s.certificate_hours = 6.5
      AND s.certificate_body_pl = 'Za udzial w kongresie 93' AND s.survey_intro_en = 'How was 93?'
     FROM public.event_participant_settings s WHERE s.event_id = pg_temp.f93_id('e1')),
  '93/klon: zwrot, przekazanie, przypomnienia, certyfikat i ankieta nie wracaja do domyslnych');
SELECT pg_temp.assert(
  (SELECT s.tenant_id = '11111111-1111-1111-1111-111111111111'
      AND s.updated_by = '93a00000-0000-0000-0000-0000000000a1'
      AND s.id <> (SELECT x.id FROM public.event_participant_settings x
                    WHERE x.event_id = '93e00000-0000-0000-0000-0000000000e1')
     FROM public.event_participant_settings s WHERE s.event_id = pg_temp.f93_id('e1')),
  '93/klon: wiersz kopii w najemcy i wydarzeniu kopii, autor zmiany = aktor klonu');
SELECT pg_temp.assert(
  (SELECT s.updated_by = '93a00000-0000-0000-0000-0000000000a2'
     FROM public.event_participant_settings s WHERE s.event_id = '93e00000-0000-0000-0000-0000000000e1'),
  '93/klon: wiersz zrodla nietkniety');
SELECT pg_temp.assert(
  (SELECT (public._event_participant_settings_effective(
             '11111111-1111-1111-1111-111111111111', pg_temp.f93_id('e1'))).refund_mode = 'none'),
  '93/klon: ustawienia efektywne kopii to ustawienia zrodla');
SELECT pg_temp.assert(
  (SELECT (v->'skipped'->>'session_saves')::int = 1 AND (v->'skipped'->>'session_signups')::int = 1
      AND (v->'skipped'->>'wallet_passes')::int = 1
     FROM f93 WHERE k = 'e1')
  AND NOT EXISTS (SELECT 1 FROM public.event_session_saves x WHERE x.event_id = pg_temp.f93_id('e1'))
  AND NOT EXISTS (SELECT 1 FROM public.event_session_signups x WHERE x.event_id = pg_temp.f93_id('e1'))
  AND NOT EXISTS (SELECT 1 FROM public.event_wallet_passes x WHERE x.event_id = pg_temp.f93_id('e1')),
  '93/klon: zakladki, zapisy na sesje i przepustki raportowane jako pominiete, kopia ich nie ma');

-- Zrodlo bez wiersza: kopia bez wiersza (te same wartosci domyslne).
INSERT INTO f93 VALUES ('e2', public.admin_event_clone(jsonb_build_object(
  'source_event_id', '93e00000-0000-0000-0000-0000000000e2', 'title_pl', 'Domyslne 93 kopia',
  'title_en', 'Defaults 93 copy', 'starts_at', pg_temp.t93(2, 5, 12, 9, 0))));
SELECT pg_temp.assert(
  (SELECT (v->'copied'->>'participant_settings')::int = 0 FROM f93 WHERE k = 'e2')
  AND NOT EXISTS (SELECT 1 FROM public.event_participant_settings s WHERE s.event_id = pg_temp.f93_id('e2')),
  '93/klon: zrodlo bez ustawien -> kopia bez wiersza, copied 0');

-- ---------------------------------------------------------------------------
-- SEKCJA 4: STREFA ZRODLA SPOZA DOKLADNYCH NAZW
-- ---------------------------------------------------------------------------
INSERT INTO f93 VALUES ('preview_e3', public.admin_event_clone_preview(
  jsonb_build_object('source_event_id', '93e00000-0000-0000-0000-0000000000e3')));
SELECT pg_temp.assert(
  (SELECT v->'source'->>'timezone' = 'america/new_york' AND v->'target'->>'timezone' = 'america/new_york'
      AND v->'shift'->>'source_tz' = 'america/new_york'
      AND (v->'target'->>'suggested_starts_at')::timestamptz = pg_temp.t93(2, 3, 1, 9, 0, 'America/New_York')
     FROM f93 WHERE k = 'preview_e3'),
  '93/strefa: podglad pokazuje strefe zrodla bez zmian i podpowiada 09:00 czasu Nowego Jorku');

-- Strefa pominieta.
INSERT INTO f93 VALUES ('ny_omitted', public.admin_event_clone(jsonb_build_object(
  'source_event_id', '93e00000-0000-0000-0000-0000000000e3', 'title_pl', 'Nowy Jork 93 kopia',
  'title_en', 'New York 93 copy', 'starts_at', pg_temp.t93(2, 4, 10, 9, 0, 'America/New_York'))));
-- Strefa odeslana z podgladu (tak robi formularz).
INSERT INTO f93 VALUES ('ny_echoed', public.admin_event_clone(jsonb_build_object(
  'source_event_id', '93e00000-0000-0000-0000-0000000000e3', 'title_pl', 'Nowy Jork 93 echo',
  'title_en', 'New York 93 echo', 'starts_at', pg_temp.t93(2, 4, 10, 9, 0, 'America/New_York'),
  'timezone', (SELECT v->'source'->>'timezone' FROM f93 WHERE k = 'preview_e3'))));

SELECT pg_temp.assert(
  (SELECT count(*) = 2 AND bool_and(e.timezone = 'america/new_york')
     FROM public.events e WHERE e.id IN (pg_temp.f93_id('ny_omitted'), pg_temp.f93_id('ny_echoed')))
  AND (SELECT v->'shift'->>'timezone' = 'america/new_york' FROM f93 WHERE k = 'ny_echoed'),
  '93/strefa: klon ze strefa pominieta i odeslana z podgladu zostaje w strefie zrodla');
SELECT pg_temp.assert(
  (SELECT bool_and(pg_temp.hm93(s.starts_at, 'America/New_York') = '09:00'
                   AND s.starts_at = pg_temp.t93(2, 4, 10, 9, 0, 'America/New_York'))
     FROM public.event_sessions s WHERE s.event_id IN (pg_temp.f93_id('ny_omitted'), pg_temp.f93_id('ny_echoed'))),
  '93/strefa: sesja 09:00 zostaje 09:00 czasu Nowego Jorku (przez zmiane czasu w USA)');
SELECT pg_temp.assert(
  (SELECT m.timezone = 'america/new_york' FROM public.event_meeting_settings m
    WHERE m.event_id = pg_temp.f93_id('ny_omitted')),
  '93/strefa: strefa gieldy rowna strefie wydarzenia (inna wielkosc liter) idzie za wydarzeniem');

-- Zmiana strefy z nazwy spoza listy na dokladna.
INSERT INTO f93 VALUES ('ny_london', public.admin_event_clone(jsonb_build_object(
  'source_event_id', '93e00000-0000-0000-0000-0000000000e3', 'title_pl', 'Nowy Jork 93 Londyn',
  'title_en', 'New York 93 London', 'timezone', 'Europe/London',
  'starts_at', pg_temp.t93(2, 4, 10, 9, 0, 'Europe/London'))));
SELECT pg_temp.assert(
  (SELECT e.timezone = 'Europe/London' FROM public.events e WHERE e.id = pg_temp.f93_id('ny_london'))
  AND (SELECT pg_temp.hm93(s.starts_at, 'Europe/London') = '09:00'
         FROM public.event_sessions s WHERE s.event_id = pg_temp.f93_id('ny_london'))
  AND (SELECT m.timezone = 'Europe/London' FROM public.event_meeting_settings m
        WHERE m.event_id = pg_temp.f93_id('ny_london')),
  '93/strefa: zmiana strefy zachowuje godzine lokalna, gielda idzie za nowa strefa');

-- Strefa celu inna niz strefa zrodla nadal musi byc dokladna nazwa.
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_clone(jsonb_build_object(
       'source_event_id', '93e00000-0000-0000-0000-0000000000e3', 'title_pl', 'X 93', 'title_en', 'X 93',
       'starts_at', pg_temp.t93(2, 4, 10, 9, 0, 'America/New_York'), 'timezone', 'Mars/Olympus'))$q$,
  'invalid_timezone', '93/strefa: nieznana strefa celu odrzucona');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_clone(jsonb_build_object(
       'source_event_id', '93e00000-0000-0000-0000-0000000000e1', 'title_pl', 'X 93', 'title_en', 'X 93',
       'starts_at', pg_temp.t93(2, 5, 10, 9, 0), 'timezone', 'europe/london'))$q$,
  'invalid_timezone', '93/strefa: strefa celu spoza dokladnych nazw (inna niz zrodla) odrzucona');

-- Strefa zrodla, ktorej nie zna nikt: Europe/Warsaw, bez wyjatku.
INSERT INTO f93 VALUES ('preview_e4', public.admin_event_clone_preview(
  jsonb_build_object('source_event_id', '93e00000-0000-0000-0000-0000000000e4')));
INSERT INTO f93 VALUES ('mars', public.admin_event_clone(jsonb_build_object(
  'source_event_id', '93e00000-0000-0000-0000-0000000000e4', 'title_pl', 'Mars 93 kopia',
  'title_en', 'Mars 93 copy', 'starts_at', pg_temp.t93(2, 6, 1, 9, 0))));
SELECT pg_temp.assert(
  (SELECT v->'source'->>'timezone' = 'Europe/Warsaw' AND v->'target'->>'timezone' = 'Europe/Warsaw'
     FROM f93 WHERE k = 'preview_e4')
  AND (SELECT e.timezone = 'Europe/Warsaw' AND e.ends_at = pg_temp.t93(2, 6, 1, 12, 0)
         FROM public.events e WHERE e.id = pg_temp.f93_id('mars')),
  '93/strefa: nieznana strefa zrodla (Mars/Base) -> Europe/Warsaw bez wyjatku');

\echo '== 93 klon edycji: koniec =='
ROLLBACK;
