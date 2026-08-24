-- ============================================================================
-- 20_registration - UCZESTNICY, ZAPISY, BILETY, ZGODY
--
-- PO CO TEN PLIK ISTNIEJE
-- Wykonuje na czystej bazie to, czego zadna bramka czytajaca SQL jako tekst
-- nie zobaczy: mechanike migracji 20260823150000_event_people_registration.
-- Sprawdza rzeczy, ktore da sie ZLAMAC - pule biletow pod WSPOLBIEZNOSCIA
-- (dwie realne sesje psql na ostatnie miejsce), okno sprzedazy, pola wymagane,
-- regule kwalifikujaca, jeden aktywny zapis na osobe, unikalnosc adresu
-- poczty W GRANICACH NAJEMCY, kolejnosc kolejki rezerwowej, hasz tokenu
-- wejsciowego, granice sciezki anonimowej i zgody z wersja.
--
-- IZOLACJA NAJEMCOW jest tu testem, nie obietnica: dwoch najemcow, kazdy
-- z wlasnym wydarzeniem i wlasnym redaktorem, i KAZDA funkcja listujaca
-- pytana z obu stron.
--
-- CZEGO TEN PLIK NIE SPRAWDZA
--   * nie sprawdza sesji agendy (10_), sponsorow (30_), frontu (40_), odprawy
--     na miejscu (50_) ani spotkan (60_) - tamte migracje maja wlasne pliki;
--   * nie sprawdza wysylki wiadomosci o awansie z rezerwy. Migracja jej NIE
--     robi swiadomie (tresc dla uzytkownika zyje w slowniku i18n), wiec
--     testujemy zdarzenie na szynie i stempel pokwitowania, a nie wysylke;
--   * nie sprawdza zaplaty za bilet. `price_cents` i `currency` sa kolumnami,
--     ale kasa nie ma wiazania z wydarzeniem - nie ma czego testowac;
--   * nie sprawdza wydajnosci ani planow zapytan;
--   * nie sprawdza atrap platformy - one sa scenografia, nie przedmiotem testu.
--
-- SPRZATANIE. Plik ma DWIE fazy o roznym kontrakcie:
--   FAZA 1 (asercje jednosesyjne) siedzi w BEGIN ... ROLLBACK i nie zostawia
--     ani wiersza;
--   FAZA 2 (wspolbieznosc) MUSI byc zacommitowana, bo dwie osobne sesje nie
--     widza cudzej otwartej transakcji. Sprzata po sobie jawnie: usuwa
--     wlasnego najemce (kaskada zabiera wydarzenie, osoby i zapisy), wlasne
--     zdarzenia domenowe i wlasne atrapy.
-- ============================================================================

\echo '== 20 zapisy: uczestnicy, bilety, zgody, rezerwa =='

-- ---------------------------------------------------------------------------
-- SEKCJA 0: BRAKUJACE ATRAPY - I ZGLOSZENIE, ZE BRAKUJE ICH W harness.sql
--
-- Dwie rzeczy, ktorych `harness.sql` nie stawia, a bez ktorych `event_register()`
-- i `event_registration_form()` NIE DAJA SIE WYKONAC ANI RAZU:
--
--   1) `public.events.rsvp_opens_at` i `public.events.early_rsvp_rank`.
--      Oba czyta cialo `event_register()` (`v_event.rsvp_opens_at`) i oba
--      dodaje migracja 20260713174428 - a wiec migracja SPRZED modulu, ktorej
--      harness nie replayuje. Bez nich kazde wywolanie zapisu publicznego pada
--      na "record has no field". To jest LUKA ATRAPY, nie blad migracji: na
--      produkcji obie kolumny istnieja od 20260713174428. Rownolegly autor
--      pliku 10_ dolozyl je juz do atrapy `events` w harness.sql - i to jest
--      ich miejsce docelowe.
--
--   2) `public.rate_limit_hit(text, text, integer, integer)` wraz z tabela
--      `public.rate_limits`. `event_register()` wola je jako bramke
--      czestotliwosci. Ksztalt (kolumny wyjsciowe `allowed`, `hits`,
--      `bucket_start`) przepisany z 20260724221149 - NIE z 20260720071845,
--      gdzie kolumna wyjsciowa `window_start` przeslania kolumne tabeli
--      i cialo podnosi "column reference is ambiguous".
--
-- DLACZEGO SIEDZI TO TUTAJ, A NIE W harness.sql. Ta faza pisze DOKLADNIE
-- JEDEN plik, a rownolegle powstaje piec innych plikow asercji; wspolna edycja
-- harness.sql konczy sie kolizja. MIEJSCE DOCELOWE OBU ATRAP JEST
-- W harness.sql - zgloszone w raporcie (`registration-assertions.md`, sekcja
-- "Luki harnessu"), bo `event_register()` bedzie potrzebny takze plikom frontu
-- i odprawy na miejscu.
--
-- SPRZATANIE JEST WARUNKOWE, I TO NIE JEST OSTROZNOSC NA ZAPAS. Skoro kolumny
-- okna zapisow moga byc juz w harness.sql, bezwarunkowe `DROP COLUMN` na koncu
-- tego pliku ZABRALOBY je plikom 30_..60_ - czyli zepsulo by scenografie,
-- ktorej ten plik nie stawial. Dlatego kazda atrapa jest zakladana TYLKO gdy
-- jej nie ma, fakt zalozenia zostaje zapamietany w GUC-u sesji, a przy
-- sprzataniu usuwamy WYLACZNIE to, co sami dolozylismy.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE v_has boolean;
BEGIN
  v_has := EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'rsvp_opens_at');
  PERFORM set_config('nes.t20_added_rsvp_opens', CASE WHEN v_has THEN '0' ELSE '1' END, false);
  IF NOT v_has THEN
    ALTER TABLE public.events ADD COLUMN rsvp_opens_at timestamptz;
  END IF;

  v_has := EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'early_rsvp_rank');
  PERFORM set_config('nes.t20_added_early_rank', CASE WHEN v_has THEN '0' ELSE '1' END, false);
  IF NOT v_has THEN
    ALTER TABLE public.events ADD COLUMN early_rsvp_rank integer
      CHECK (early_rsvp_rank IS NULL OR early_rsvp_rank >= 0);
  END IF;

  v_has := EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rate_limit_hit');
  PERFORM set_config('nes.t20_added_rate_limit', CASE WHEN v_has THEN '0' ELSE '1' END, false);
  IF NOT v_has THEN
    CREATE TABLE public.rate_limits (
      scope        text NOT NULL,
      subject_id   text NOT NULL,
      window_start timestamptz NOT NULL,
      count        integer NOT NULL DEFAULT 0,
      PRIMARY KEY (scope, subject_id, window_start)
    );
    -- Atrapa LICZY naprawde (nie zwraca stalego `true`), bo bramka, ktora
    -- zawsze przepuszcza, nie jest bramka - a asercja o niej byla by
    -- komentarzem.
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
      IF _scope IS NULL OR length(_scope) = 0 OR _subject IS NULL OR length(_subject) = 0 THEN
        RAISE EXCEPTION 'rate_limit_hit: scope/subject required';
      END IF;
      INSERT INTO public.rate_limits AS rl (scope, subject_id, window_start, count)
      VALUES (_scope, _subject, v_start, 1)
      ON CONFLICT (scope, subject_id, window_start) DO UPDATE SET count = rl.count + 1
      RETURNING rl.count INTO v_count;
      RETURN QUERY SELECT (v_count <= GREATEST(1, _max)), v_count, v_start;
    END $rl$;
  END IF;
END
$do$;

-- Bez tych trzech rzeczy `event_register()` nie da sie wykonac ANI RAZU, wiec
-- ich obecnosc jest ASERCJA, nie zalozeniem.
SELECT pg_temp.assert(
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'events'
      AND column_name IN ('rsvp_opens_at', 'early_rsvp_rank')) = 2,
  'atrapy: events ma kolumny okna zapisow czytane przez event_register()');
SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rate_limit_hit') = 1,
  'atrapy: bramka czestotliwosci istnieje (event_register() jej wymaga)');

-- ############################################################################
-- FAZA 1 - asercje jednosesyjne. Cala faza wycofuje sie ROLLBACK-iem.
-- ############################################################################
BEGIN;

-- Slownik wartosci dynamicznych (identyfikatory zapisow, tokeny jawne).
-- Identyfikatory scenografii sa STALE - dzieki temu asercje czytaja sie same,
-- a nie przez podzapytanie po kluczu naturalnym.
CREATE TEMP TABLE reg_q (k text PRIMARY KEY, u uuid, t text);

-- ---------------------------------------------------------------------------
-- SEKCJA 1: SCENOGRAFIA - DWOCH NAJEMCOW, KAZDY Z WLASNYM REDAKTOREM
--
-- Najemca A to najemca publiczny harnessu (11111111...), najemca B jest nowy.
-- Kazdy ma wlasne wydarzenie z wlasnymi biletami, polami i zgodami - inaczej
-- asercja o izolacji nie ma czego nie widziec.
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Tenant B (zapisy)', 'tb-reg')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('e1111111-0000-0000-0000-000000000001', 'editor.a@example.org'),
  ('e1111111-0000-0000-0000-000000000002', 'editor.b@example.org'),
  ('e1111111-0000-0000-0000-000000000003', 'author.a@example.org'),
  ('d1111111-0000-0000-0000-000000000001', 'uczestnik1@example.org'),
  ('d1111111-0000-0000-0000-000000000002', 'uczestnik2@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
  ('e1111111-0000-0000-0000-000000000001', 'editor'),
  ('e1111111-0000-0000-0000-000000000002', 'editor'),
  ('e1111111-0000-0000-0000-000000000003', 'author')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, tenant_id) VALUES
  ('e1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('e1111111-0000-0000-0000-000000000002', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  ('e1111111-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111'),
  ('d1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('d1111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111')
ON CONFLICT (id) DO NOTHING;

-- Firma CRM najemcy B - cel asercji o kluczu obcym ZLOZONYM na `event_people`.
INSERT INTO public.crm_companies (id, tenant_id, name) VALUES
  ('c1111111-0000-0000-0000-0000000000b1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Firma B')
ON CONFLICT (id) DO NOTHING;

-- Wydarzenia. Wstawienie kazdego odpala trigger `events_seed_registration_groups`.
INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status,
   registration_mode, registration_flow, capacity)
VALUES
  -- A1: formularz, tryb natychmiastowy, bilety
  ('a1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'reg-form-a', 'Kongres A', 'Congress A', now() + interval '30 days', 'published',
   'form', 'instant', NULL),
  -- A2: rsvp, tryb z akceptacja, bez biletow
  ('a1111111-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'reg-appr-a', 'Panel A', 'Panel A', now() + interval '31 days', 'published',
   'rsvp', 'approval', NULL),
  -- A3: rsvp, natychmiastowy, LIMIT WYDARZENIA = 1 (kolejka z powodu pojemnosci)
  ('a1111111-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'reg-cap-a', 'Kolacja A', 'Dinner A', now() + interval '32 days', 'published',
   'rsvp', 'instant', 1),
  -- A4: zapisy WYLACZONE
  ('a1111111-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'reg-none-a', 'Wyklad A', 'Lecture A', now() + interval '33 days', 'published',
   'none', 'instant', NULL),
  -- B1: blizniak A1 u drugiego najemcy
  ('b1111111-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'reg-form-b', 'Kongres B', 'Congress B', now() + interval '30 days', 'published',
   'form', 'instant', NULL);

-- Bilety wydarzenia A1.
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, sales_from, sales_to, min_tier_rank, requires_approval, is_active, sort_order)
VALUES
  -- standardowy: pula 2, okno otwarte
  ('a2222222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a1111111-0000-0000-0000-000000000001', 'standard', 'Standard', 'Standard',
   10000, 'PLN', 2, NULL, NULL, 0, false, true, 10),
  -- przedsprzedaz, ktora sie JESZCZE nie zaczela
  ('a2222222-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'a1111111-0000-0000-0000-000000000001', 'early', 'Wczesny', 'Early bird',
   5000, 'PLN', NULL, now() + interval '5 days', NULL, 0, false, true, 20),
  -- sprzedaz, ktora sie JUZ skonczyla
  ('a2222222-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'a1111111-0000-0000-0000-000000000001', 'late', 'Spozniony', 'Late', 20000, 'PLN',
   NULL, NULL, now() - interval '1 day', 0, false, true, 30),
  -- bilet za progiem warstwy czlonkowskiej
  ('a2222222-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'a1111111-0000-0000-0000-000000000001', 'member', 'Czlonkowski', 'Member',
   0, 'PLN', NULL, NULL, NULL, 30, false, true, 40),
  -- wejsciowka prasowa: PODNOSI wymog akceptacji na wydarzeniu natychmiastowym
  ('a2222222-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'a1111111-0000-0000-0000-000000000001', 'press', 'Prasa', 'Press',
   0, 'PLN', NULL, NULL, NULL, 0, true, true, 50);

-- Bilet blizniaczy u najemcy B (izolacja `admin_event_tickets_list`).
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, quota)
VALUES
  ('b2222222-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'b1111111-0000-0000-0000-000000000001', 'standard', 'Standard B', 'Standard B', 5);

-- Pola formularza A1. Trzy z nich sa KWALIFIKUJACE i maja trzy rozne skutki -
-- bez tego nie da sie sprawdzic pierwszenstwa reject > approval > auto_approve.
INSERT INTO public.event_registration_fields
  (id, tenant_id, event_id, key, field_type, label_pl, label_en, is_required,
   options, sort_order, is_qualifying, qualify_operator, qualify_value, qualify_outcome)
VALUES
  ('a3333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a1111111-0000-0000-0000-000000000001', 'motivation', 'textarea',
   'Motywacja', 'Motivation', true, '[]'::jsonb, 10, false, 'none', 'null'::jsonb, 'approval'),
  ('a3333333-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'a1111111-0000-0000-0000-000000000001', 'sector', 'select',
   'Sektor', 'Sector', true,
   '[{"value":"gov","label_pl":"Administracja","label_en":"Government"},
      {"value":"biz","label_pl":"Biznes","label_en":"Business"},
      {"value":"ngo","label_pl":"NGO","label_en":"NGO"}]'::jsonb,
   20, true, 'in', '["ngo"]'::jsonb, 'reject'),
  ('a3333333-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'a1111111-0000-0000-0000-000000000001', 'gov_rep', 'checkbox',
   'Przedstawiciel administracji', 'Public administration', false,
   '[]'::jsonb, 30, true, 'is_true', 'null'::jsonb, 'approval'),
  ('a3333333-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'a1111111-0000-0000-0000-000000000001', 'invited', 'checkbox',
   'Zaproszony', 'Invited', false,
   '[]'::jsonb, 40, true, 'is_true', 'null'::jsonb, 'auto_approve'),
  -- pole typu `consent` NIE wychodzi na front i NIE jest liczone jako
  -- obowiazkowe w `event_register` - dwie osobne asercje ponizej
  ('a3333333-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'a1111111-0000-0000-0000-000000000001', 'rodo_box', 'consent',
   'Zgoda RODO', 'GDPR consent', true, '[]'::jsonb, 50, false, 'none', 'null'::jsonb, 'approval');

INSERT INTO public.event_registration_fields
  (id, tenant_id, event_id, key, field_type, label_pl, label_en, is_required)
VALUES
  ('b3333333-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'b1111111-0000-0000-0000-000000000001', 'motivation', 'textarea',
   'Motywacja B', 'Motivation B', true);

-- Zgody A1: jedna WYMAGANA (wersja 1) i jedna nieobowiazkowa.
INSERT INTO public.event_terms
  (id, tenant_id, event_id, key, label_pl, label_en, body_pl, body_en,
   display, is_required, version, sort_order)
VALUES
  ('a4444444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a1111111-0000-0000-0000-000000000001', 'regulamin', 'Regulamin', 'Terms',
   'Tresc regulaminu.', 'Terms body.', 'registration', true, 1, 10),
  ('a4444444-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'a1111111-0000-0000-0000-000000000001', 'partner', 'Klauzula partnera', 'Partner clause',
   'Tresc klauzuli.', 'Partner body.', 'registration', false, 1, 20),
  -- zgoda pokazywana WYLACZNIE przy wejsciu na tresc: nie moze blokowac zapisu
  ('a4444444-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'a1111111-0000-0000-0000-000000000001', 'access_only', 'Zgoda dostepowa', 'Access clause',
   'Tresc dostepowa.', 'Access body.', 'access', true, 1, 30);

INSERT INTO public.event_terms
  (id, tenant_id, event_id, key, label_pl, label_en, body_pl, body_en, is_required)
VALUES
  ('b4444444-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
   'b1111111-0000-0000-0000-000000000001', 'regulamin', 'Regulamin B', 'Terms B',
   'Tresc B.', 'Body B.', true);

-- ---------------------------------------------------------------------------
-- SEKCJA 2: TRIGGER SEEDU GRUP (tg_events_seed_registration_groups,
--           _event_seed_default_groups)
--
-- Grupy startowe sa warunkiem uzywalnosci modulu: bez nich "bilet nadaje grupe"
-- nie ma czego nadac. Prog jest ROWNY (4), nie dolny - dolozenie piatej grupy
-- startowej jest zmiana decyzji produktowej i ma zapalic ten test.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_groups
    WHERE event_id = 'a1111111-0000-0000-0000-000000000001') = 4,
  'grupy: trigger zaseedowal DOKLADNIE cztery grupy startowe nowego wydarzenia');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_groups
    WHERE event_id = 'a1111111-0000-0000-0000-000000000001'
      AND key IN ('attendees','speakers','partners','organisers')) = 4,
  'grupy: klucze grup startowych sa te, ktore obiecuje migracja');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_groups
    WHERE event_id = 'a1111111-0000-0000-0000-000000000001' AND is_default) = 1
  AND (SELECT key FROM public.event_groups
        WHERE event_id = 'a1111111-0000-0000-0000-000000000001' AND is_default) = 'attendees',
  'grupy: DOKLADNIE jedna grupa domyslna i jest to grupa uczestnikow');

SELECT pg_temp.assert(
  (SELECT bool_and(is_system) FROM public.event_groups
    WHERE event_id = 'a1111111-0000-0000-0000-000000000001'),
  'grupy: kazda grupa startowa jest systemowa (nie da sie jej usunac)');

-- Idempotentnosc: powtorne wywolanie nie dokleja ani jednego wiersza.
SELECT pg_temp.assert(
  public._event_seed_default_groups(
    '11111111-1111-1111-1111-111111111111', 'a1111111-0000-0000-0000-000000000001') = 0,
  'grupy: _event_seed_default_groups jest idempotentna (drugi przebieg = 0 wierszy)');

-- Indeks czesciowy `event_groups_default_uniq` musi ODMOWIC drugiej grupy
-- domyslnej. Bez niego przypisanie zapisu bez biletu byloby losowe.
SELECT pg_temp.assert_raises_like($q$
  INSERT INTO public.event_groups (tenant_id, event_id, key, name_pl, name_en, is_default)
  VALUES ('11111111-1111-1111-1111-111111111111',
          'a1111111-0000-0000-0000-000000000001', 'druga_domyslna', 'Druga', 'Second', true)
$q$, 'event_groups_default_uniq',
  'grupy/ODMOWA: druga grupa domyslna tego samego wydarzenia jest odrzucana');

-- CHECK `event_groups_visibility_consistent`: zasieg bez wlacznika to sprzecznosc.
SELECT pg_temp.assert_raises_like($q$
  INSERT INTO public.event_groups
    (tenant_id, event_id, key, name_pl, name_en, can_see_attendees, attendee_visibility)
  VALUES ('11111111-1111-1111-1111-111111111111',
          'a1111111-0000-0000-0000-000000000001', 'sprzeczna', 'Sprzeczna', 'Inconsistent',
          false, 'registered')
$q$, 'event_groups_visibility_consistent',
  'grupy/ODMOWA: "nie widzi listy, ale widzi wszystkich zapisanych" jest odrzucane');

-- ---------------------------------------------------------------------------
-- SEKCJA 3: _event_answer_matches - PREDYKAT REGULY, funkcja czysta
--
-- Kazda asercja ma tu kontrapunkt: sprawdzamy zarowno trafienie, jak i to, ze
-- BRAK odpowiedzi NIE trafia w zaden operator poza `not_empty`. Bez tego
-- drugiego pole nieobowiazkowe dzialaloby jak pulapka.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  public._event_answer_matches('equals', '"gov"'::jsonb, '"GOV"'::jsonb),
  'predykat: equals nie zwaza na wielkosc liter');
SELECT pg_temp.assert(
  NOT public._event_answer_matches('equals', '"gov"'::jsonb, 'null'::jsonb),
  'predykat: equals NIE trafia w brak odpowiedzi');
SELECT pg_temp.assert(
  NOT public._event_answer_matches('not_equals', '"gov"'::jsonb, 'null'::jsonb),
  'predykat: not_equals NIE trafia w brak odpowiedzi (pole nieobowiazkowe to nie pulapka)');
SELECT pg_temp.assert(
  public._event_answer_matches('not_equals', '"gov"'::jsonb, '"biz"'::jsonb),
  'predykat: not_equals trafia w inna wartosc');
SELECT pg_temp.assert(
  public._event_answer_matches('in', '["gov","ngo"]'::jsonb, '"ngo"'::jsonb),
  'predykat: in trafia w skalar z listy');
SELECT pg_temp.assert(
  public._event_answer_matches('in', '["gov","ngo"]'::jsonb, '["biz","ngo"]'::jsonb),
  'predykat: in trafia, gdy odpowiedz jest TABLICA o niepustym przecieciu');
SELECT pg_temp.assert(
  NOT public._event_answer_matches('in', '"gov"'::jsonb, '"gov"'::jsonb),
  'predykat: in z wartoscia oczekiwana NIE-tablica nie trafia w nic');
SELECT pg_temp.assert(
  public._event_answer_matches('not_in', '["gov"]'::jsonb, '"biz"'::jsonb),
  'predykat: not_in trafia w wartosc poza lista');
SELECT pg_temp.assert(
  public._event_answer_matches('is_true', 'null'::jsonb, 'true'::jsonb)
  AND public._event_answer_matches('is_true', 'null'::jsonb, '"tak"'::jsonb),
  'predykat: is_true rozumie logike i napis "tak"');
SELECT pg_temp.assert(
  NOT public._event_answer_matches('is_true', 'null'::jsonb, '"moze"'::jsonb)
  AND NOT public._event_answer_matches('is_false', 'null'::jsonb, '"moze"'::jsonb),
  'predykat: odpowiedz nierozstrzygalna nie trafia ani w is_true, ani w is_false');
SELECT pg_temp.assert(
  public._event_answer_matches('gte', '18'::jsonb, '21'::jsonb)
  AND NOT public._event_answer_matches('gte', '18'::jsonb, '17'::jsonb),
  'predykat: gte porownuje liczbowo w obie strony');
SELECT pg_temp.assert(
  NOT public._event_answer_matches('gte', '18'::jsonb, '"osiemnascie"'::jsonb),
  'predykat: gte na odpowiedzi nieliczbowej nie trafia (a nie rzuca)');
SELECT pg_temp.assert(
  public._event_answer_matches('not_empty', 'null'::jsonb, '"cokolwiek"'::jsonb)
  AND NOT public._event_answer_matches('not_empty', 'null'::jsonb, '""'::jsonb)
  AND NOT public._event_answer_matches('not_empty', 'null'::jsonb, '"   "'::jsonb)
  AND NOT public._event_answer_matches('not_empty', 'null'::jsonb, '[]'::jsonb)
  AND public._event_answer_matches('not_empty', 'null'::jsonb, '["a"]'::jsonb),
  'predykat: not_empty odrzuca pusty napis, biale znaki i pusta tablice');
SELECT pg_temp.assert(
  NOT public._event_answer_matches('none', 'null'::jsonb, '"cokolwiek"'::jsonb)
  AND NOT public._event_answer_matches(NULL, 'null'::jsonb, '"cokolwiek"'::jsonb),
  'predykat: operator "none" i NULL nie kwalifikuja niczego');

-- ---------------------------------------------------------------------------
-- SEKCJA 4: _event_registration_verdict - PIERWSZENSTWO SKUTKOW
--
-- Migracja obiecuje: reject > approval > auto_approve. Test podaje odpowiedzi
-- trafiajace w KILKA regul naraz - inaczej mierzylby jedna regule, a nie
-- pierwszenstwo.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  public._event_registration_verdict('11111111-1111-1111-1111-111111111111',
    'a1111111-0000-0000-0000-000000000001', '{"sector":"biz"}'::jsonb) = 'none',
  'werdykt: odpowiedz nietrafiajaca w zadna regule daje "none"');

SELECT pg_temp.assert(
  public._event_registration_verdict('11111111-1111-1111-1111-111111111111',
    'a1111111-0000-0000-0000-000000000001', '{"sector":"ngo"}'::jsonb) = 'reject',
  'werdykt: odpowiedz dyskwalifikujaca daje "reject"');

SELECT pg_temp.assert(
  public._event_registration_verdict('11111111-1111-1111-1111-111111111111',
    'a1111111-0000-0000-0000-000000000001', '{"gov_rep":true}'::jsonb) = 'approval',
  'werdykt: warunek pozytywny z negatywnym skutkiem daje "approval"');

SELECT pg_temp.assert(
  public._event_registration_verdict('11111111-1111-1111-1111-111111111111',
    'a1111111-0000-0000-0000-000000000001', '{"invited":true}'::jsonb) = 'auto_approve',
  'werdykt: regula zatwierdzajaca daje "auto_approve"');

SELECT pg_temp.assert(
  public._event_registration_verdict('11111111-1111-1111-1111-111111111111',
    'a1111111-0000-0000-0000-000000000001',
    '{"invited":true,"gov_rep":true}'::jsonb) = 'approval',
  'werdykt/PIERWSZENSTWO: akceptacja wygrywa z natychmiastowym zatwierdzeniem');

SELECT pg_temp.assert(
  public._event_registration_verdict('11111111-1111-1111-1111-111111111111',
    'a1111111-0000-0000-0000-000000000001',
    '{"invited":true,"gov_rep":true,"sector":"ngo"}'::jsonb) = 'reject',
  'werdykt/PIERWSZENSTWO: JEDNA regula odrzucajaca wygrywa z dwiema przepuszczajacymi');

-- Werdykt jest liczony W GRANICACH NAJEMCY: te same odpowiedzi na wydarzeniu
-- najemcy B nie moga zobaczyc regul najemcy A.
SELECT pg_temp.assert(
  public._event_registration_verdict('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'b1111111-0000-0000-0000-000000000001', '{"sector":"ngo"}'::jsonb) = 'none',
  'werdykt/izolacja: reguly najemcy A nie obowiazuja na wydarzeniu najemcy B');

-- ---------------------------------------------------------------------------
-- SEKCJA 5: _event_seats_left - NULL TO BEZ LIMITU, NIE ZERO
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  public._event_seats_left('11111111-1111-1111-1111-111111111111',
    'a1111111-0000-0000-0000-000000000001', NULL) IS NULL,
  'pojemnosc: wydarzenie bez limitu oddaje NULL, a nie zero');

SELECT pg_temp.assert(
  public._event_seats_left('11111111-1111-1111-1111-111111111111',
    'a1111111-0000-0000-0000-000000000003', NULL) = 1,
  'pojemnosc: limit wydarzenia jest liczony (capacity 1, zero zajetych)');

SELECT pg_temp.assert(
  public._event_seats_left('11111111-1111-1111-1111-111111111111',
    'a1111111-0000-0000-0000-000000000001',
    'a2222222-0000-0000-0000-000000000001') = 2,
  'pojemnosc: pula biletu jest liczona, gdy wydarzenie limitu nie ma');

SELECT pg_temp.assert(
  public._event_seats_left('11111111-1111-1111-1111-111111111111',
    'a1111111-0000-0000-0000-000000000001',
    'a2222222-0000-0000-0000-000000000002') IS NULL,
  'pojemnosc: bilet bez puli na wydarzeniu bez limitu oddaje NULL');

-- Wydarzenie obcego najemcy nie istnieje dla tej funkcji: zero, nie NULL.
SELECT pg_temp.assert(
  public._event_seats_left('11111111-1111-1111-1111-111111111111',
    'b1111111-0000-0000-0000-000000000001', NULL) = 0,
  'pojemnosc/izolacja: wydarzenie obcego najemcy oddaje 0, a nie "bez limitu"');

-- ---------------------------------------------------------------------------
-- SEKCJA 6: _event_new_qr_token - ksztalt sekretu
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  (SELECT bool_and(t ~ '^[A-Za-z0-9_-]{32}$') FROM (
     SELECT public._event_new_qr_token() AS t FROM generate_series(1, 20)) s),
  'token: 24 bajty w base64url, bez znakow wymagajacych kodowania procentowego');

SELECT pg_temp.assert(
  (SELECT count(DISTINCT t) FROM (
     SELECT public._event_new_qr_token() AS t FROM generate_series(1, 50)) s) = 50,
  'token: piecdziesiat wywolan daje piecdziesiat roznych wartosci');

-- ---------------------------------------------------------------------------
-- SEKCJA 7: event_registration_form - CO WIDZI FRONT
--
-- Najwazniejsza asercja tej sekcji jest NEGATYWNA: regula kwalifikujaca NIE
-- MOZE wyjsc na front. Uczestnik, ktory zna regule, odpowiada pod nia.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(NULL, NULL);
SELECT set_config('nes.public_tenant', '11111111-1111-1111-1111-111111111111', false);

DO $$
DECLARE v jsonb;
BEGIN
  v := public.event_registration_form('reg-form-a');
  PERFORM pg_temp.assert((v->>'is_open')::boolean,
    'formularz: wydarzenie z otwartymi zapisami jest otwarte');
  PERFORM pg_temp.assert(v->'closed_reason' = 'null'::jsonb,
    'formularz: otwarte zapisy nie maja powodu zamkniecia');
  -- Cztery pola aktywne, ale pole typu `consent` NIE wychodzi - zostaja trzy.
  PERFORM pg_temp.assert(jsonb_array_length(v->'fields') = 4,
    'formularz: oddaje pola formularza BEZ pola typu consent');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'fields') f
                 WHERE f->>'field_type' = 'consent'),
    'formularz: zadne pole typu consent nie wychodzi na front');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'fields') f
                 WHERE f ? 'qualify_operator' OR f ? 'qualify_value'
                    OR f ? 'qualify_outcome' OR f ? 'is_qualifying'),
    'formularz/SEKRET: regula kwalifikujaca NIE wychodzi na front');
  PERFORM pg_temp.assert(jsonb_array_length(v->'tickets') = 5,
    'formularz: oddaje wszystkie bilety aktywne');
  PERFORM pg_temp.assert(
    (SELECT t->>'availability' FROM jsonb_array_elements(v->'tickets') t
      WHERE t->>'key' = 'early') = 'scheduled',
    'formularz: bilet przed oknem sprzedazy ma stan "scheduled"');
  PERFORM pg_temp.assert(
    (SELECT t->>'availability' FROM jsonb_array_elements(v->'tickets') t
      WHERE t->>'key' = 'late') = 'ended',
    'formularz: bilet po oknie sprzedazy ma stan "ended"');
  PERFORM pg_temp.assert(
    (SELECT (t->>'seats_left')::integer FROM jsonb_array_elements(v->'tickets') t
      WHERE t->>'key' = 'standard') = 2,
    'formularz: bilet oddaje liczbe WOLNYCH miejsc');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'tickets') t WHERE t ? 'sold_count'),
    'formularz/SEKRET: liczba sprzedanych biletow NIE wychodzi na front');
  PERFORM pg_temp.assert(
    (SELECT (t->>'tier_locked')::boolean FROM jsonb_array_elements(v->'tickets') t
      WHERE t->>'key' = 'member'),
    'formularz: bilet za progiem warstwy jest oznaczony jako zamkniety');
  -- Zgody: wychodza dwie z trzech - ta wylacznie dostepowa nie nalezy do zapisu.
  PERFORM pg_temp.assert(jsonb_array_length(v->'terms') = 2,
    'formularz: oddaje zgody pokazywane PRZY ZAPISIE, nie zgody dostepowe');
  PERFORM pg_temp.assert(
    (SELECT (t->>'version')::integer FROM jsonb_array_elements(v->'terms') t
      WHERE t->>'key' = 'regulamin') = 1,
    'formularz: zgoda niesie WERSJE (bez niej akceptacja nie ma wartosci dowodowej)');
END $$;

-- Wydarzenie z wylaczonymi zapisami: zamkniete z podanym powodem.
DO $$
DECLARE v jsonb;
BEGIN
  v := public.event_registration_form('reg-none-a');
  PERFORM pg_temp.assert(NOT (v->>'is_open')::boolean
    AND v->>'closed_reason' = 'registration_disabled',
    'formularz: wydarzenie bez zapisow jest zamkniete z powodem "registration_disabled"');
END $$;

-- IZOLACJA NAJEMCOW na plaszczyznie tresci: front najemcy A nie zna slugow
-- najemcy B. To nie jest "nie ma dostepu" - to "nie istnieje".
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_registration_form('reg-form-b')$q$,
  'not_found',
  'formularz/izolacja: front najemcy A nie widzi wydarzenia najemcy B');

-- ...i odwrotnie, z kontrapunktem: po przestawieniu najemcy publicznego to samo
-- wywolanie DZIALA. Bez tego kontrapunktu asercja wyzej mierzylaby literowke
-- w slugu, nie izolacje.
SELECT set_config('nes.public_tenant', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
DO $$
DECLARE v jsonb;
BEGIN
  v := public.event_registration_form('reg-form-b');
  PERFORM pg_temp.assert(v->'event'->>'slug' = 'reg-form-b',
    'formularz/izolacja: najemca B widzi SWOJE wydarzenie (kontrapunkt)');
  PERFORM pg_temp.assert(jsonb_array_length(v->'fields') = 1,
    'formularz/izolacja: najemca B widzi TYLKO swoje pole formularza');
  PERFORM pg_temp.assert(jsonb_array_length(v->'tickets') = 1,
    'formularz/izolacja: najemca B widzi TYLKO swoj bilet');
  PERFORM pg_temp.assert(jsonb_array_length(v->'terms') = 1,
    'formularz/izolacja: najemca B widzi TYLKO swoja zgode');
END $$;
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_registration_form('reg-form-a')$q$,
  'not_found',
  'formularz/izolacja: front najemcy B nie widzi wydarzenia najemcy A');
SELECT set_config('nes.public_tenant', '11111111-1111-1111-1111-111111111111', false);

-- ---------------------------------------------------------------------------
-- SEKCJA 8: event_register - WEJSCIE, KTORE MUSI ODMAWIAC
--
-- Kazda z tych asercji sprawdza ODMOWE z konkretnym powodem. `assert_raises`
-- bez wzorca przechodzilo by tez wtedy, gdy wywolanie padlo z literowki
-- w tescie - a to jest falszywa zgoda.
-- ---------------------------------------------------------------------------

-- 3) POLA WYMAGANE. Brak obu odpowiedzi -> odmowa z lista kluczy.
SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_register(jsonb_build_object(
    'event_slug','reg-form-a', 'ticket_type_id','a2222222-0000-0000-0000-000000000001',
    'email','brak.pol@example.org', 'first_name','Bez', 'last_name','Pol',
    'consent_data_processing', true,
    'accepted_term_ids', jsonb_build_array('a4444444-0000-0000-0000-000000000001')))
$q$, 'missing_required_fields: motivation,sector',
  'zapis/ODMOWA: brak odpowiedzi na pole wymagane wymienia KTORE pola brakuja');

-- Pusty napis i biale znaki nie sa odpowiedzia - to ta sama odmowa.
SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_register(jsonb_build_object(
    'event_slug','reg-form-a', 'ticket_type_id','a2222222-0000-0000-0000-000000000001',
    'email','puste.pola@example.org', 'first_name','Puste', 'last_name','Pola',
    'consent_data_processing', true,
    'answers', jsonb_build_object('motivation','   ', 'sector',''),
    'accepted_term_ids', jsonb_build_array('a4444444-0000-0000-0000-000000000001')))
$q$, 'missing_required_fields',
  'zapis/ODMOWA: biale znaki i pusty napis nie sa odpowiedzia na pole wymagane');

-- Pole typu `consent` jest wymagane w definicji, ale NIE jest liczone jako
-- brakujace pole formularza - jego dowodem jest akceptacja z wersja.
SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_register(jsonb_build_object(
    'event_slug','reg-form-a', 'ticket_type_id','a2222222-0000-0000-0000-000000000001',
    'email','tylko.consent@example.org', 'first_name','Tylko', 'last_name','Consent',
    'consent_data_processing', true,
    'answers', jsonb_build_object('motivation','bo tak', 'sector','biz')))
$q$, 'terms_required: regulamin',
  'zapis/ODMOWA: brak WYMAGANEJ zgody blokuje zapis (a pole consent nie jest polem)');

-- 10) Zgoda NIEWYMAGANA nie blokuje. Zgoda wylacznie DOSTEPOWA tez nie -
--     inaczej byla by zgoda pozorna.
DO $$
DECLARE v jsonb;
BEGIN
  v := public.event_register(jsonb_build_object(
    'event_slug','reg-form-a', 'ticket_type_id','a2222222-0000-0000-0000-000000000001',
    'email','ANNA.Kowalska@Example.ORG', 'first_name','Anna', 'last_name','Kowalska',
    'phone','+48 600 100 200', 'job_title','Analityk', 'company_text','Firma X',
    'consent_data_processing', true, 'consent_marketing', true,
    'ip_hash', 'abcdef0123456789', 'user_agent','harness/1.0',
    'answers', jsonb_build_object('motivation','chce byc', 'sector','biz'),
    'accepted_term_ids', jsonb_build_array('a4444444-0000-0000-0000-000000000001')));
  INSERT INTO reg_q (k, u, t) VALUES
    ('anna_reg', (v->>'registration_id')::uuid, v->>'qr_token'),
    ('anna_person', (v->>'person_id')::uuid, v->>'manage_token');
  PERFORM pg_temp.assert(v->>'status' = 'approved',
    'zapis: tryb natychmiastowy bez regul daje status "approved"');
  PERFORM pg_temp.assert(v->>'decision_source' = 'system',
    'zapis: zatwierdzenie bez udzialu czlowieka ma podstawe "system"');
  PERFORM pg_temp.assert(v->>'qr_token' IS NOT NULL AND v->>'manage_token' IS NOT NULL,
    'zapis: zatwierdzony dostaje OBA sekrety - wejsciowy i samoobslugowy');
  PERFORM pg_temp.assert(v->'waitlist_position' = 'null'::jsonb,
    'zapis: zatwierdzony nie ma pozycji w kolejce rezerwowej');
END $$;

-- 8) TOKEN QR JEST HASZEM. Kolumna nie moze zawierac tokena jawnego.
DO $$
DECLARE
  v_tok text := (SELECT t FROM reg_q WHERE k = 'anna_reg');
  v_man text := (SELECT t FROM reg_q WHERE k = 'anna_person');
  v_id uuid := (SELECT u FROM reg_q WHERE k = 'anna_reg');
  v_hash text;
  v_mhash text;
BEGIN
  SELECT qr_token_hash, manage_token_hash INTO v_hash, v_mhash
  FROM public.event_registrations WHERE id = v_id;

  PERFORM pg_temp.assert(v_hash ~ '^[0-9a-f]{64}$',
    'token/HASZ: kolumna qr_token_hash trzyma 64 znaki szesnastkowe');
  PERFORM pg_temp.assert(v_hash <> v_tok AND position(v_tok in v_hash) = 0,
    'token/HASZ: kolumna NIE zawiera tokena jawnego ani jego fragmentu');
  PERFORM pg_temp.assert(v_hash = encode(extensions.digest(v_tok, 'sha256'), 'hex'),
    'token/HASZ: kolumna jest DOKLADNIE sha256 tokena zwroconego raz');
  PERFORM pg_temp.assert(v_mhash ~ '^[0-9a-f]{64}$'
    AND position(v_man in v_mhash) = 0
    AND v_mhash = encode(extensions.digest(v_man, 'sha256'), 'hex'),
    'token/HASZ: uchwyt samoobslugowy tez lezy w bazie wylacznie jako sha256');
  PERFORM pg_temp.assert(v_hash <> v_mhash,
    'token/HASZ: sekret wejsciowy i uchwyt samoobslugowy to DWA rozne sekrety');
  -- Zaden wiersz w calej tabeli nie trzyma tokena jawnego.
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.event_registrations
                 WHERE qr_token_hash = v_tok OR manage_token_hash = v_man),
    'token/HASZ: token jawny nie wystepuje w ZADNYM wierszu event_registrations');
END $$;

-- Zgoda: akceptacja zapisala WERSJE regulaminu i dowiazala sie do zapisu.
DO $$
DECLARE v_person uuid := (SELECT u FROM reg_q WHERE k = 'anna_person');
BEGIN
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_term_acceptances
      WHERE person_id = v_person) = 1,
    'zgody: akceptowana zostala DOKLADNIE jedna zgoda (ta wskazana)');
  PERFORM pg_temp.assert(
    (SELECT version FROM public.event_term_acceptances
      WHERE person_id = v_person AND term_id = 'a4444444-0000-0000-0000-000000000001') = 1,
    'zgody: akceptacja zapisala WERSJE regulaminu obowiazujaca w chwili zapisu');
  PERFORM pg_temp.assert(
    (SELECT registration_id FROM public.event_term_acceptances WHERE person_id = v_person)
      = (SELECT u FROM reg_q WHERE k = 'anna_reg'),
    'zgody: akceptacja wskazuje zapis, przy ktorym powstala');
  PERFORM pg_temp.assert(
    (SELECT ip_hash FROM public.event_term_acceptances WHERE person_id = v_person)
      = 'abcdef0123456789'
    AND (SELECT user_agent FROM public.event_term_acceptances WHERE person_id = v_person)
      = 'harness/1.0',
    'zgody: hasz adresu i przegladarka jada z warstwy serwerowej do rejestru');
  -- Stempel zgody osoby: pierwsze nadanie, nie nadpisanie.
  PERFORM pg_temp.assert(
    (SELECT consent_data_processing_at IS NOT NULL AND consent_marketing_at IS NOT NULL
       AND consent_partner_sharing_at IS NULL
     FROM public.event_people WHERE id = v_person),
    'zgody: trzy stemple zgody osoby sa NIEZALEZNE (marketing tak, partner nie)');
  -- Adres poczty zostal ZNORMALIZOWANY do klucza dopasowania.
  PERFORM pg_temp.assert(
    (SELECT email_norm FROM public.event_people WHERE id = v_person) = 'anna.kowalska@example.org',
    'kartoteka: email_norm jest kluczem dopasowania (lower + btrim)');
END $$;

-- Trigger licznika: jeden zapis zatwierdzony to jedno zajete miejsce.
SELECT pg_temp.assert(
  (SELECT sold_count FROM public.event_ticket_types
    WHERE id = 'a2222222-0000-0000-0000-000000000001') = 1,
  'licznik: trigger przeliczajacy postawil sold_count = 1 po pierwszym zapisie');

-- Zdarzenie domenowe poleclo na szyne z aktorem na SZOSTEJ pozycji.
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.domain_events
    WHERE event_type = 'event.registration.created.v1'
      AND tenant_id = '11111111-1111-1111-1111-111111111111'
      AND payload->>'status' = 'approved') = 1,
  'szyna: zapis wyemitowal event.registration.created.v1 ze statusem w tresci');

-- 5) JEDNA OSOBA, JEDEN AKTYWNY ZAPIS. Najpierw przez RPC...
SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_register(jsonb_build_object(
    'event_slug','reg-form-a', 'ticket_type_id','a2222222-0000-0000-0000-000000000001',
    'email','anna.kowalska@example.org', 'first_name','Anna', 'last_name','Kowalska',
    'consent_data_processing', true,
    'answers', jsonb_build_object('motivation','jeszcze raz', 'sector','biz'),
    'accepted_term_ids', jsonb_build_array('a4444444-0000-0000-0000-000000000001')))
$q$, 'already_registered',
  'zapis/ODMOWA: druga proba tej samej osoby na to samo wydarzenie jest odrzucana');

-- ...a potem przez INDEKS, bo tylko on obowiazuje takze przy imporcie i COPY.
DO $$
DECLARE v_person uuid := (SELECT u FROM reg_q WHERE k = 'anna_person');
BEGIN
  PERFORM pg_temp.assert_raises_like(format($q$
    INSERT INTO public.event_registrations
      (tenant_id, event_id, person_id, status, registration_mode)
    VALUES ('11111111-1111-1111-1111-111111111111',
            'a1111111-0000-0000-0000-000000000001', %L, 'pending', 'form')
  $q$, v_person), 'event_registrations_active_uniq',
    'zapis/ODMOWA: indeks czesciowy odrzuca drugi AKTYWNY zapis (obowiazuje takze przy imporcie)');
END $$;

-- 6) UNIKALNOSC ADRESU POCZTY JEST W GRANICACH NAJEMCY, NIE GLOBALNA.
--    Ten sam adres u najemcy B MUSI przejsc - i musi dac OSOBNY wiersz.
SELECT set_config('nes.public_tenant', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', false);
DO $$
DECLARE v jsonb;
BEGIN
  v := public.event_register(jsonb_build_object(
    'event_slug','reg-form-b', 'ticket_type_id','b2222222-0000-0000-0000-000000000001',
    'email','anna.kowalska@example.org', 'first_name','Anna', 'last_name','Kowalska',
    'consent_data_processing', true,
    'answers', jsonb_build_object('motivation','u najemcy B'),
    'accepted_term_ids', jsonb_build_array('b4444444-0000-0000-0000-000000000001')));
  PERFORM pg_temp.assert(v->>'status' = 'approved',
    'kartoteka/najemca: TEN SAM adres poczty u drugiego najemcy PRZECHODZI');
  PERFORM pg_temp.assert((v->>'person_id')::uuid <> (SELECT u FROM reg_q WHERE k = 'anna_person'),
    'kartoteka/najemca: u drugiego najemcy powstal OSOBNY wiersz kartoteki');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_people WHERE email_norm = 'anna.kowalska@example.org') = 2,
    'kartoteka/najemca: dwa wiersze na dwoch najemcow - unikalnosc NIE jest globalna');
END $$;
SELECT set_config('nes.public_tenant', '11111111-1111-1111-1111-111111111111', false);

-- ...i kontrapunkt: DRUGI wiersz z tym samym adresem W TYM SAMYM najemcy odmawia.
SELECT pg_temp.assert_raises_like($q$
  INSERT INTO public.event_people (tenant_id, email, first_name, last_name)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Anna.Kowalska@example.org',
          'Anna', 'Duplikat')
$q$, 'event_people_tenant_email_uniq',
  'kartoteka/ODMOWA: ten sam adres DWA RAZY u jednego najemcy jest odrzucany');

-- Dwie osoby BEZ adresu poczty nie koliduja (indeks czesciowy po email_norm).
DO $$
BEGIN
  INSERT INTO public.event_people (tenant_id, first_name, last_name, source) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Bez', 'Adresu1', 'organizer'),
    ('11111111-1111-1111-1111-111111111111', 'Bez', 'Adresu2', 'organizer');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_people
      WHERE tenant_id = '11111111-1111-1111-1111-111111111111'
        AND email_norm IS NULL) = 2,
    'kartoteka: dwie osoby BEZ adresu poczty nie koliduja na indeksie');
END $$;

-- 2) OKNO SPRZEDAZY BILETU: przed otwarciem i po zamknieciu.
SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_register(jsonb_build_object(
    'event_slug','reg-form-a', 'ticket_type_id','a2222222-0000-0000-0000-000000000002',
    'email','przed.oknem@example.org', 'first_name','Przed', 'last_name','Oknem',
    'consent_data_processing', true,
    'answers', jsonb_build_object('motivation','za wczesnie', 'sector','biz'),
    'accepted_term_ids', jsonb_build_array('a4444444-0000-0000-0000-000000000001')))
$q$, 'ticket_not_on_sale',
  'bilet/ODMOWA: zapis PRZED otwarciem okna sprzedazy jest odrzucany');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_register(jsonb_build_object(
    'event_slug','reg-form-a', 'ticket_type_id','a2222222-0000-0000-0000-000000000003',
    'email','po.oknie@example.org', 'first_name','Po', 'last_name','Oknie',
    'consent_data_processing', true,
    'answers', jsonb_build_object('motivation','za pozno', 'sector','biz'),
    'accepted_term_ids', jsonb_build_array('a4444444-0000-0000-0000-000000000001')))
$q$, 'ticket_sales_ended',
  'bilet/ODMOWA: zapis PO zamknieciu okna sprzedazy jest odrzucany');

-- Prog warstwy czlonkowskiej biletu - z kontrapunktem po podniesieniu rangi.
SELECT pg_temp.act_as(NULL, NULL, 10, '');
SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_register(jsonb_build_object(
    'event_slug','reg-form-a', 'ticket_type_id','a2222222-0000-0000-0000-000000000004',
    'email','niski.prog@example.org', 'first_name','Niski', 'last_name','Prog',
    'consent_data_processing', true,
    'answers', jsonb_build_object('motivation','chce', 'sector','biz'),
    'accepted_term_ids', jsonb_build_array('a4444444-0000-0000-0000-000000000001')))
$q$, 'ticket_tier_required',
  'bilet/ODMOWA: bilet za progiem warstwy odmawia rangi ponizej progu');

SELECT pg_temp.act_as(NULL, NULL, 30, '');
DO $$
DECLARE v jsonb;
BEGIN
  v := public.event_register(jsonb_build_object(
    'event_slug','reg-form-a', 'ticket_type_id','a2222222-0000-0000-0000-000000000004',
    'email','wysoki.prog@example.org', 'first_name','Wysoki', 'last_name','Prog',
    'consent_data_processing', true,
    'answers', jsonb_build_object('motivation','chce', 'sector','biz'),
    'accepted_term_ids', jsonb_build_array('a4444444-0000-0000-0000-000000000001')));
  PERFORM pg_temp.assert(v->>'status' = 'approved',
    'bilet: ta sama proba z ranga NA PROGU przechodzi (kontrapunkt progu warstwy)');
END $$;
SELECT pg_temp.act_as(NULL, NULL, 0, '');

-- Bilet wymagajacy akceptacji PODNOSI tryb wydarzenia natychmiastowego.
DO $$
DECLARE v jsonb;
BEGIN
  v := public.event_register(jsonb_build_object(
    'event_slug','reg-form-a', 'ticket_type_id','a2222222-0000-0000-0000-000000000005',
    'email','prasa@example.org', 'first_name','Redaktor', 'last_name','Prasowy',
    'consent_data_processing', true,
    'answers', jsonb_build_object('motivation','relacja', 'sector','biz'),
    'accepted_term_ids', jsonb_build_array('a4444444-0000-0000-0000-000000000001')));
  PERFORM pg_temp.assert(v->>'status' = 'pending',
    'bilet: requires_approval PODNOSI wymog akceptacji na wydarzeniu natychmiastowym');
  PERFORM pg_temp.assert(v->'qr_token' = 'null'::jsonb,
    'bilet: zgloszenie oczekujace NIE dostaje poswiadczenia wejscia');
  PERFORM pg_temp.assert(v->>'manage_token' IS NOT NULL,
    'bilet: zgloszenie oczekujace DOSTAJE uchwyt samoobslugowy (moze sie wycofac)');
  PERFORM pg_temp.assert(v->'decision_source' = 'null'::jsonb,
    'bilet: zgloszenie oczekujace nie ma jeszcze podstawy decyzji');
END $$;

-- Zgloszenie oczekujace miejsca NIE zajmuje - licznik biletu stoi.
SELECT pg_temp.assert(
  (SELECT sold_count FROM public.event_ticket_types
    WHERE id = 'a2222222-0000-0000-0000-000000000005') = 0,
  'licznik: zgloszenie oczekujace na decyzje NIE zajmuje miejsca');

-- Wydarzenie z biletami wymaga WSKAZANIA biletu.
SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_register(jsonb_build_object(
    'event_slug','reg-form-a',
    'email','bez.biletu@example.org', 'first_name','Bez', 'last_name','Biletu',
    'consent_data_processing', true,
    'answers', jsonb_build_object('motivation','chce', 'sector','biz'),
    'accepted_term_ids', jsonb_build_array('a4444444-0000-0000-0000-000000000001')))
$q$, 'ticket_required',
  'zapis/ODMOWA: wydarzenie sprzedajace bilety odmawia zapisu bez biletu');

-- Bramka wejscia: zgoda na przetwarzanie danych, adres, imie i nazwisko.
SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_register(jsonb_build_object(
    'event_slug','reg-cap-a', 'email','bez.zgody@example.org',
    'first_name','Bez', 'last_name','Zgody'))
$q$, 'consent_required',
  'zapis/ODMOWA: brak zgody na przetwarzanie danych blokuje zapis');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_register(jsonb_build_object(
    'event_slug','reg-cap-a', 'email','to nie jest adres',
    'first_name','Zly', 'last_name','Adres', 'consent_data_processing', true))
$q$, 'invalid_email',
  'zapis/ODMOWA: adres poczty o zlym ksztalcie blokuje zapis');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_register(jsonb_build_object(
    'event_slug','reg-cap-a', 'email','bez.nazwiska@example.org',
    'first_name','', 'last_name','', 'consent_data_processing', true))
$q$, 'invalid_name',
  'zapis/ODMOWA: brak imienia i nazwiska blokuje zapis');

SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_register(jsonb_build_object(
    'event_slug','reg-none-a', 'email','wylaczone@example.org',
    'first_name','Wy', 'last_name','Laczone', 'consent_data_processing', true))
$q$, 'registration_disabled',
  'zapis/ODMOWA: wydarzenie z wylaczonymi zapisami odmawia');

-- Gorna granica wejscia (64 kB) - bez niej jeden zalacznik w `answers`
-- wysadza pamiec sesji.
SELECT pg_temp.assert_raises_like($q$
  SELECT public.event_register(jsonb_build_object(
    'event_slug','reg-cap-a', 'email','wielki@example.org',
    'first_name','Wielki', 'last_name','Payload', 'consent_data_processing', true,
    'answers', jsonb_build_object('motivation', repeat('x', 70000))))
$q$, 'payload_too_large',
  'zapis/ODMOWA: wejscie powyzej 64 kB jest odrzucane przed jakimkolwiek zapisem');

-- 4) PYTANIE KWALIFIKUJACE: odpowiedz dyskwalifikujaca daje status "rejected"
--    z podstawa "automatic_rule" - i NIE zajmuje miejsca.
DO $$
DECLARE v jsonb;
BEGIN
  v := public.event_register(jsonb_build_object(
    'event_slug','reg-form-a', 'ticket_type_id','a2222222-0000-0000-0000-000000000001',
    'email','dyskwalifikacja@example.org', 'first_name','Dys', 'last_name','Kwalifikacja',
    'consent_data_processing', true,
    'answers', jsonb_build_object('motivation','chce', 'sector','ngo'),
    'accepted_term_ids', jsonb_build_array('a4444444-0000-0000-0000-000000000001')));
  PERFORM pg_temp.assert(v->>'status' = 'rejected',
    'kwalifikacja: odpowiedz dyskwalifikujaca daje status "rejected", nie "pending"');
  PERFORM pg_temp.assert(v->>'decision_source' = 'automatic_rule',
    'kwalifikacja: podstawa decyzji to "automatic_rule" - nie "organizer"');
  PERFORM pg_temp.assert(v->'qr_token' = 'null'::jsonb,
    'kwalifikacja: odrzucony regula NIE dostaje poswiadczenia wejscia');
  PERFORM pg_temp.assert(
    (SELECT decided_at IS NOT NULL AND decided_by IS NULL
     FROM public.event_registrations WHERE id = (v->>'registration_id')::uuid),
    'kwalifikacja: slad decyzji ma date, ale NIE ma autora (zadecydowala regula)');
END $$;

-- Regula skierowania do akceptacji: status "pending", bez podstawy decyzji.
DO $$
DECLARE v jsonb;
BEGIN
  v := public.event_register(jsonb_build_object(
    'event_slug','reg-form-a', 'ticket_type_id','a2222222-0000-0000-0000-000000000001',
    'email','administracja@example.org', 'first_name','Urzad', 'last_name','Nik',
    'consent_data_processing', true,
    'answers', jsonb_build_object('motivation','sluzbowo', 'sector','gov', 'gov_rep', true),
    'accepted_term_ids', jsonb_build_array('a4444444-0000-0000-0000-000000000001')));
  PERFORM pg_temp.assert(v->>'status' = 'pending',
    'kwalifikacja: regula "do akceptacji" daje status "pending"');
  PERFORM pg_temp.assert(v->'decision_source' = 'null'::jsonb,
    'kwalifikacja: zgloszenie do akceptacji nie ma jeszcze podstawy decyzji');
END $$;

-- Odrzucony REGULA nie potrzebuje powodu - ale odrzucony CZLOWIEKIEM tak.
-- To CHECK na tabeli, nie warunek w RPC: obowiazuje takze przy imporcie.
SELECT pg_temp.assert_raises_like($q$
  UPDATE public.event_registrations
  SET decision_source = 'organizer', decision_note = NULL
  WHERE status = 'rejected'
$q$, 'event_registrations_rejection_has_reason',
  'slad/ODMOWA: odrzucenie przez czlowieka BEZ powodu jest odrzucane przez CHECK');

-- 9) SCIEZKA ANONIMOWA: wstrzykniety `tenant_id` nie ma zadnego skutku.
--    Najemca pochodzi z KONTEKSTU TRESCI, nigdy z wejscia.
DO $$
DECLARE v jsonb; v_tenant uuid;
BEGIN
  v := public.event_register(jsonb_build_object(
    'event_slug','reg-cap-a',
    'tenant_id','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'email','wstrzykiwacz@example.org', 'first_name','Wstrzy', 'last_name','Kiwacz',
    'consent_data_processing', true));
  SELECT tenant_id INTO v_tenant FROM public.event_registrations
   WHERE id = (v->>'registration_id')::uuid;
  PERFORM pg_temp.assert(v_tenant = '11111111-1111-1111-1111-111111111111',
    'anonim/SEKRET: wstrzykniety tenant_id NIE zmienil najemcy zapisu');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_people
      WHERE tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
        AND email_norm = 'wstrzykiwacz@example.org') = 0,
    'anonim/SEKRET: wstrzykniety tenant_id nie dopisal osoby do kartoteki obcego najemcy');
  PERFORM pg_temp.assert(v->>'status' = 'approved',
    'zapis: wydarzenie bez biletow i z limitem 1 przyjmuje pierwsza osobe');
  INSERT INTO reg_q (k, u, t) VALUES ('cap_first', (v->>'registration_id')::uuid, v->>'manage_token');
END $$;

-- 7) LISTA REZERWOWA: PIERWSZY Z KOLEJKI, NIE OSTATNI.
--    Wydarzenie `reg-cap-a` ma limit 1 i jedno miejsce jest zajete, wiec dwie
--    nastepne osoby wchodza na kolejke z pozycjami 1 i 2.
DO $$
DECLARE v jsonb;
BEGIN
  v := public.event_register(jsonb_build_object(
    'event_slug','reg-cap-a', 'email','kolejka1@example.org',
    'first_name','Pierwszy', 'last_name','Wkolejce', 'consent_data_processing', true));
  PERFORM pg_temp.assert(v->>'status' = 'waitlist',
    'rezerwa: brak miejsca NIE odrzuca zgloszenia - kieruje je na kolejke');
  PERFORM pg_temp.assert(v->>'decision_source' = 'capacity',
    'rezerwa: podstawa skierowania na kolejke to "capacity"');
  PERFORM pg_temp.assert((v->>'waitlist_position')::integer = 1,
    'rezerwa: pierwszy na kolejce dostaje pozycje 1');
  PERFORM pg_temp.assert(v->'qr_token' = 'null'::jsonb,
    'rezerwa: rezerwowy NIE dostaje poswiadczenia wejscia');
  INSERT INTO reg_q (k, u, t) VALUES ('wl1', (v->>'registration_id')::uuid, NULL);

  v := public.event_register(jsonb_build_object(
    'event_slug','reg-cap-a', 'email','kolejka2@example.org',
    'first_name','Drugi', 'last_name','Wkolejce', 'consent_data_processing', true));
  PERFORM pg_temp.assert((v->>'waitlist_position')::integer = 2,
    'rezerwa: drugi na kolejce dostaje pozycje 2 (kolejnosc jest liczba, nie sugestia)');
  INSERT INTO reg_q (k, u, t) VALUES ('wl2', (v->>'registration_id')::uuid, NULL);
END $$;

-- Dwie osoby nie moga zajmowac tej samej pozycji w kolejce.
SELECT pg_temp.assert_raises_like($q$
  UPDATE public.event_registrations SET waitlist_position = 1
  WHERE status = 'waitlist' AND waitlist_position = 2
$q$, 'event_registrations_waitlist_order_uniq',
  'rezerwa/ODMOWA: dwie osoby na tej samej pozycji w kolejce sa odrzucane');

-- Pozycja w kolejce ma sens WYLACZNIE dla wiersza w kolejce.
SELECT pg_temp.assert_raises_like($q$
  UPDATE public.event_registrations SET status = 'approved'
  WHERE status = 'waitlist' AND waitlist_position = 2
$q$, 'event_registrations_waitlist_position_scoped',
  'rezerwa/ODMOWA: awans bez wyczyszczenia pozycji jest odrzucany przez CHECK');

-- ANULOWANIE ZWALNIA MIEJSCE I PROMUJE PIERWSZEGO Z KOLEJKI.
-- Najwazniejsze jest tu, KTO awansowal: pierwszy, nie ostatni.
DO $$
DECLARE
  v jsonb;
  v_first uuid := (SELECT u FROM reg_q WHERE k = 'cap_first');
  v_man text := (SELECT t FROM reg_q WHERE k = 'cap_first');
  v_wl1 uuid := (SELECT u FROM reg_q WHERE k = 'wl1');
  v_wl2 uuid := (SELECT u FROM reg_q WHERE k = 'wl2');
BEGIN
  v := public.event_registration_cancel(jsonb_build_object('manage_token', v_man));
  PERFORM pg_temp.assert(v->>'status' = 'cancelled',
    'anulowanie: uchwyt samoobslugowy JEST dowodem wlasnosci');
  PERFORM pg_temp.assert((v->>'promoted_from_waitlist')::integer = 1,
    'rezerwa: zwolnione miejsce promuje DOKLADNIE jedna osobe w tej samej transakcji');
  PERFORM pg_temp.assert(
    (SELECT status FROM public.event_registrations WHERE id = v_wl1) = 'approved',
    'rezerwa/KOLEJNOSC: awansowal PIERWSZY z kolejki');
  PERFORM pg_temp.assert(
    (SELECT status FROM public.event_registrations WHERE id = v_wl2) = 'waitlist',
    'rezerwa/KOLEJNOSC: drugi z kolejki NIE awansowal (inaczej promocja byla by losowa)');
  PERFORM pg_temp.assert(
    (SELECT waitlist_position IS NULL AND promoted_at IS NOT NULL
       AND decision_source = 'system' AND qr_token_hash IS NOT NULL
     FROM public.event_registrations WHERE id = v_wl1),
    'rezerwa: awansowany traci pozycje, dostaje stempel awansu i poswiadczenie wejscia');
  PERFORM pg_temp.assert(
    (SELECT qr_token_hash IS NULL AND qr_issued_at IS NULL AND cancelled_at IS NOT NULL
     FROM public.event_registrations WHERE id = v_first),
    'anulowanie/SEKRET: poswiadczenie wejscia jest CZYSZCZONE przy anulowaniu');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.domain_events
      WHERE event_type = 'event.registration.promoted.v1') = 1,
    'szyna: awans z rezerwy wyemitowal event.registration.promoted.v1');
  PERFORM pg_temp.assert(
    (SELECT waitlist_notified_at IS NULL FROM public.event_registrations WHERE id = v_wl1),
    'rezerwa: awans NIE stawia stempla powiadomienia (wysylka nalezy do warstwy i18n)');
END $$;

-- Anulowanie CUDZEGO zapisu: sam identyfikator dowodem NIE JEST.
DO $$
DECLARE v_wl2 uuid := (SELECT u FROM reg_q WHERE k = 'wl2');
BEGIN
  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.event_registration_cancel(
      jsonb_build_object('registration_id', %L))$q$, v_wl2),
    'forbidden',
    'anulowanie/ODMOWA: anonim ze samym identyfikatorem cudzego zapisu dostaje odmowe');
  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.event_registration_cancel(
      jsonb_build_object('registration_id', %L, 'manage_token', 'zmyslony-token'))$q$, v_wl2),
    'forbidden',
    'anulowanie/ODMOWA: zmyslony uchwyt samoobslugowy dostaje odmowe');
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.event_registration_cancel(jsonb_build_object('manage_token','nie-ma-takiego'))$q$,
    'not_found',
    'anulowanie/ODMOWA: nieistniejacy uchwyt nie wycieka informacji o istnieniu zapisu');
  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.event_registration_cancel(
      jsonb_build_object('registration_id', %L))$q$, (SELECT u FROM reg_q WHERE k = 'cap_first')),
    'forbidden',
    'anulowanie/ODMOWA: zapis juz anulowany nie daje sie anulowac powtornie bez dowodu');
END $$;

-- Zalogowany dowodzi wlasnosci KONTEM. Dowiazujemy konto do osoby z kolejki.
DO $$
DECLARE
  v jsonb;
  v_wl2 uuid := (SELECT u FROM reg_q WHERE k = 'wl2');
  v_person uuid;
BEGIN
  SELECT person_id INTO v_person FROM public.event_registrations WHERE id = v_wl2;
  UPDATE public.event_people SET user_id = 'd1111111-0000-0000-0000-000000000002'
   WHERE id = v_person;

  -- Obce konto nadal dostaje odmowe.
  PERFORM pg_temp.act_as('d1111111-0000-0000-0000-000000000001', NULL);
  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.event_registration_cancel(
      jsonb_build_object('registration_id', %L))$q$, v_wl2),
    'forbidden',
    'anulowanie/ODMOWA: OBCE konto zalogowane dostaje odmowe (dowod jest imienny)');

  -- Wlasciciel przechodzi.
  PERFORM pg_temp.act_as('d1111111-0000-0000-0000-000000000002', NULL);
  v := public.event_registration_cancel(jsonb_build_object('registration_id', v_wl2));
  PERFORM pg_temp.assert(v->>'status' = 'cancelled',
    'anulowanie: konto dowiazane do osoby JEST dowodem wlasnosci (kontrapunkt)');
  PERFORM pg_temp.act_as(NULL, NULL);
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 9: DECYZJA ORGANIZATORA (admin_event_registration_decide)
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('e1111111-0000-0000-0000-000000000001',
                      '11111111-1111-1111-1111-111111111111');

-- Bramka: anonim i autor NIE przechodza.
SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_registrations_list('a1111111-0000-0000-0000-000000000001')$q$,
  'forbidden',
  'panel/ODMOWA: anonim nie widzi listy zapisow');
SELECT pg_temp.act_as('e1111111-0000-0000-0000-000000000003',
                      '11111111-1111-1111-1111-111111111111');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_registrations_list('a1111111-0000-0000-0000-000000000001')$q$,
  'editor role required',
  'panel/ODMOWA: rola author NIE wystarcza (autor nie widzi adresow uczestnikow)');
SELECT pg_temp.act_as('e1111111-0000-0000-0000-000000000001',
                      '11111111-1111-1111-1111-111111111111');

-- Odrzucenie BEZ powodu odmawia, z powodem przechodzi.
DO $$
DECLARE
  v jsonb;
  v_pending uuid;
BEGIN
  SELECT r.id INTO v_pending FROM public.event_registrations r
   JOIN public.event_people p ON p.id = r.person_id
   WHERE r.event_id = 'a1111111-0000-0000-0000-000000000001'
     AND p.email_norm = 'administracja@example.org';
  INSERT INTO reg_q (k, u, t) VALUES ('gov_reg', v_pending, NULL);

  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.admin_event_registration_decide(
      jsonb_build_object('registration_id', %L, 'action','reject'))$q$, v_pending),
    'reason_required',
    'decyzja/ODMOWA: odrzucenie przez organizatora BEZ powodu jest odrzucane');

  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.admin_event_registration_decide(
      jsonb_build_object('registration_id', %L, 'action','reject', 'note','ok'))$q$, v_pending),
    'reason_required',
    'decyzja/ODMOWA: powod krotszy niz trzy znaki nie jest powodem');

  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.admin_event_registration_decide(
      jsonb_build_object('registration_id', %L, 'action','attended'))$q$, v_pending),
    'invalid_transition',
    'decyzja/ODMOWA: przejscie pending -> attended jest niedozwolone (cofalo by frekwencje)');

  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.admin_event_registration_decide(
      jsonb_build_object('registration_id', %L, 'action','zatwierdz'))$q$, v_pending),
    'invalid_action',
    'decyzja/ODMOWA: nieznana czynnosc jest odrzucana');

  v := public.admin_event_registration_decide(jsonb_build_object(
    'registration_id', v_pending, 'action','approve'));
  PERFORM pg_temp.assert(v->>'status' = 'approved' AND v->>'qr_token' IS NOT NULL,
    'decyzja: zatwierdzenie oddaje poswiadczenie wejscia DOKLADNIE RAZ');
  PERFORM pg_temp.assert(
    (SELECT decided_by = 'e1111111-0000-0000-0000-000000000001'
        AND decision_source = 'organizer' AND decided_at IS NOT NULL
     FROM public.event_registrations WHERE id = v_pending),
    'decyzja: slad decyzji zapisuje KTO, KIEDY i NA JAKIEJ PODSTAWIE');
  PERFORM pg_temp.assert(
    (SELECT qr_token_hash = encode(extensions.digest(v->>'qr_token', 'sha256'), 'hex')
     FROM public.event_registrations WHERE id = v_pending),
    'decyzja/HASZ: w bazie zostal wylacznie sha256 wydanego poswiadczenia');
END $$;

-- Pula sprawdzana POD BLOKADA w chwili zatwierdzenia: dwa zgloszenia
-- oczekujace na jedno wolne miejsce - drugie dostaje odmowe.
DO $$
DECLARE
  v_press uuid;
  v_extra uuid;
BEGIN
  SELECT r.id INTO v_press FROM public.event_registrations r
   JOIN public.event_people p ON p.id = r.person_id
   WHERE p.email_norm = 'prasa@example.org';

  -- Bilet `standard` ma pule 2 i dwa miejsca zajete (Anna + Urzednik).
  PERFORM pg_temp.assert(
    (SELECT sold_count FROM public.event_ticket_types
      WHERE id = 'a2222222-0000-0000-0000-000000000001') = 2,
    'licznik: pula biletu standard jest wyczerpana (sold_count = quota = 2)');

  -- Nowe zgloszenie oczekujace na TEN bilet powstaje bez przeszkod...
  v_extra := public.admin_event_registration_upsert(jsonb_build_object(
    'event_id','a1111111-0000-0000-0000-000000000001',
    'ticket_type_id','a2222222-0000-0000-0000-000000000001',
    'email','czekajacy@example.org', 'first_name','Cze', 'last_name','Kajacy',
    'status','pending'));
  PERFORM pg_temp.assert(v_extra IS NOT NULL,
    'wpis: zgloszenie OCZEKUJACE na wydarzeniu pelnym przechodzi (miejsca nie zajmuje)');

  -- ...a jego zatwierdzenie odmawia, bo miejsca nie ma.
  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.admin_event_registration_decide(
      jsonb_build_object('registration_id', %L, 'action','approve'))$q$, v_extra),
    'no_seats_left',
    'decyzja/ODMOWA: zatwierdzenie przy wyczerpanej puli odmawia "no_seats_left"');

  -- Edycja tego samego zgloszenia (poprawka literowki) NADAL przechodzi.
  -- To jest regresja z raportu autora migracji, sekcja 4.1 - i dlatego ma
  -- wlasna asercje, a nie komentarz.
  PERFORM public.admin_event_registration_upsert(jsonb_build_object(
    'registration_id', v_extra, 'last_name','Kajacy-Poprawiony'));
  PERFORM pg_temp.assert(
    (SELECT p.last_name FROM public.event_registrations r
      JOIN public.event_people p ON p.id = r.person_id WHERE r.id = v_extra)
    = 'Kajacy-Poprawiony',
    'wpis: EDYCJA zgloszenia na wydarzeniu pelnym przechodzi (nie liczy puli)');
  PERFORM pg_temp.assert(
    (SELECT status FROM public.event_registrations WHERE id = v_extra) = 'pending',
    'wpis: edycja NIE zmienia statusu - przejscia stanu maja jedno miejsce');

  INSERT INTO reg_q (k, u, t) VALUES ('extra_reg', v_extra, NULL);
END $$;

-- Odrzucenie wiersza ZAJMUJACEGO miejsce uruchamia kolejke i zwalnia licznik.
DO $$
DECLARE
  v jsonb;
  v_gov uuid := (SELECT u FROM reg_q WHERE k = 'gov_reg');
  v_extra uuid := (SELECT u FROM reg_q WHERE k = 'extra_reg');
BEGIN
  -- Najpierw wstawiamy oczekujacego na kolejke, zeby bylo kogo promowac.
  PERFORM public.admin_event_registration_decide(jsonb_build_object(
    'registration_id', v_extra, 'action','waitlist'));
  PERFORM pg_temp.assert(
    (SELECT status = 'waitlist' AND waitlist_position = 1
     FROM public.event_registrations WHERE id = v_extra),
    'decyzja: skierowanie na kolejke nadaje pozycje');

  v := public.admin_event_registration_decide(jsonb_build_object(
    'registration_id', v_gov, 'action','reject', 'note','poza zakresem tematycznym'));
  PERFORM pg_temp.assert((v->>'promoted_from_waitlist')::integer = 1,
    'decyzja: odrzucenie wiersza zajmujacego miejsce PROMUJE kolejke natychmiast');
  PERFORM pg_temp.assert(
    (SELECT status = 'approved' AND waitlist_position IS NULL
     FROM public.event_registrations WHERE id = v_extra),
    'decyzja: promowany z kolejki ma status "approved" i nie ma pozycji');
  PERFORM pg_temp.assert(
    (SELECT qr_token_hash IS NULL FROM public.event_registrations WHERE id = v_gov),
    'decyzja/SEKRET: odrzucenie CZYSCI poswiadczenie wejscia');
  PERFORM pg_temp.assert(
    (SELECT sold_count FROM public.event_ticket_types
      WHERE id = 'a2222222-0000-0000-0000-000000000001') = 2,
    'licznik: po odrzuceniu jednego i promocji drugiego pula znow jest pelna');
END $$;

-- Frekwencja: `attended_at` stawiane RAZ. Drugie pikniecie nie przesuwa godziny.
DO $$
DECLARE
  v_extra uuid := (SELECT u FROM reg_q WHERE k = 'extra_reg');
  v_first timestamptz;
BEGIN
  PERFORM public.admin_event_registration_decide(jsonb_build_object(
    'registration_id', v_extra, 'action','attended'));
  SELECT attended_at INTO v_first FROM public.event_registrations WHERE id = v_extra;
  PERFORM pg_temp.assert(v_first IS NOT NULL,
    'frekwencja: obecnosc stawia stempel wejscia');
  PERFORM public.admin_event_registration_decide(jsonb_build_object(
    'registration_id', v_extra, 'action','no_show'));
  PERFORM public.admin_event_registration_decide(jsonb_build_object(
    'registration_id', v_extra, 'action','attended'));
  PERFORM pg_temp.assert(
    (SELECT attended_at FROM public.event_registrations WHERE id = v_extra) = v_first,
    'frekwencja: powtorna obecnosc NIE przesuwa godziny pierwszego wejscia');
  -- `no_show` ZAJMUJE miejsce - odjecie go falszowaloby raport sprzedazy.
  PERFORM public.admin_event_registration_decide(jsonb_build_object(
    'registration_id', v_extra, 'action','no_show'));
  PERFORM pg_temp.assert(
    (SELECT sold_count FROM public.event_ticket_types
      WHERE id = 'a2222222-0000-0000-0000-000000000001') = 2,
    'licznik: status no_show NADAL zajmuje miejsce (kto sie zapisal i nie przyszedl)');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 10: WPIS ORGANIZATORA, STEMPEL POWIADOMIENIA, RECZNA PROMOCJA
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_id uuid; v_person uuid;
BEGIN
  -- Osoba BEZ konta w auth.users - to ta sciezka wpisuje prelegentow.
  v_id := public.admin_event_registration_upsert(jsonb_build_object(
    'event_id','a1111111-0000-0000-0000-000000000002',
    'email','prelegent@example.org', 'first_name','Pre', 'last_name','Legent',
    'job_title','Ekspert', 'company_id', NULL, 'status','approved', 'source','organizer'));
  SELECT person_id INTO v_person FROM public.event_registrations WHERE id = v_id;
  PERFORM pg_temp.assert(
    (SELECT user_id IS NULL FROM public.event_people WHERE id = v_person),
    'wpis: organizator zaklada osobe BEZ konta w auth.users');
  PERFORM pg_temp.assert(
    (SELECT registration_mode FROM public.event_registrations WHERE id = v_id) = 'rsvp',
    'wpis: wpis organizatora jest zapisem jednym kliknieciem, takze na wydarzeniu z formularzem');
  PERFORM pg_temp.assert(
    (SELECT group_id IS NOT NULL FROM public.event_registrations WHERE id = v_id),
    'wpis: zapis bez biletu dostaje grupe DOMYSLNA wydarzenia');
  PERFORM pg_temp.assert(
    (SELECT decision_source = 'organizer' AND decided_by IS NOT NULL
     FROM public.event_registrations WHERE id = v_id),
    'wpis: wpis zatwierdzony przez organizatora nosi jego slad');

  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.admin_event_registration_upsert(jsonb_build_object(
      'event_id','a1111111-0000-0000-0000-000000000002',
      'email','zly.status@example.org', 'first_name','Zly', 'last_name','Status',
      'status','attended'))
  $q$, 'invalid_status',
    'wpis/ODMOWA: wpis organizatora nie moze startowac od stanu koncowego');

  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.admin_event_registration_upsert(jsonb_build_object(
      'event_id','b1111111-0000-0000-0000-000000000001',
      'email','obcy@example.org', 'first_name','Obcy', 'last_name','Najemca'))
  $q$, 'not_found',
    'wpis/izolacja: redaktor najemcy A nie potrafi wpisac uczestnika najemcy B');
END $$;

-- Stempel powiadomienia o awansie.
DO $$
DECLARE
  v_wl1 uuid := (SELECT u FROM reg_q WHERE k = 'wl1');
  v_n integer;
BEGIN
  v_n := public.admin_event_registration_mark_notified(
    jsonb_build_object('registration_ids', jsonb_build_array(v_wl1)));
  PERFORM pg_temp.assert(v_n = 1,
    'powiadomienie: stempel postawiony na jednym wskazanym zapisie');
  PERFORM pg_temp.assert(
    (SELECT waitlist_notified_at IS NOT NULL FROM public.event_registrations WHERE id = v_wl1),
    'powiadomienie: stempel naprawde wszedl do wiersza');
  v_n := public.admin_event_registration_mark_notified(
    jsonb_build_object('registration_ids', jsonb_build_array(v_wl1)));
  PERFORM pg_temp.assert(v_n = 0,
    'powiadomienie: powtorne pokwitowanie nie przestawia istniejacego stempla');
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_registration_mark_notified('{}'::jsonb)$q$,
    'invalid_request',
    'powiadomienie/ODMOWA: wywolanie bez listy identyfikatorow jest odrzucane');
END $$;

-- IZOLACJA stempla: redaktor A nie stempluje zapisu najemcy B.
DO $$
DECLARE v_b uuid; v_n integer;
BEGIN
  SELECT id INTO v_b FROM public.event_registrations
   WHERE tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' LIMIT 1;
  v_n := public.admin_event_registration_mark_notified(
    jsonb_build_object('registration_ids', jsonb_build_array(v_b)));
  PERFORM pg_temp.assert(v_n = 0,
    'powiadomienie/izolacja: redaktor A nie stempluje ANI JEDNEGO zapisu najemcy B');
  PERFORM pg_temp.assert(
    (SELECT waitlist_notified_at IS NULL FROM public.event_registrations WHERE id = v_b),
    'powiadomienie/izolacja: wiersz najemcy B pozostal nietkniety');
END $$;

-- Reczna promocja z kolejki.
DO $$
DECLARE v jsonb; v_id uuid;
BEGIN
  -- Nowy rezerwowy na wydarzeniu bez limitu (bilet `early`, pula NULL) -
  -- reczna promocja ma miejsce, na ktore promuje.
  v_id := public.admin_event_registration_upsert(jsonb_build_object(
    'event_id','a1111111-0000-0000-0000-000000000001',
    'ticket_type_id','a2222222-0000-0000-0000-000000000002',
    'email','reczny@example.org', 'first_name','Recz', 'last_name','Ny',
    'status','waitlist'));
  PERFORM pg_temp.assert(
    (SELECT waitlist_position IS NOT NULL FROM public.event_registrations WHERE id = v_id),
    'promocja: wpis organizatora na kolejke dostaje pozycje');

  v := public.admin_event_waitlist_promote(jsonb_build_object('registration_id', v_id));
  PERFORM pg_temp.assert((v->>'promoted')::integer = 1 AND v->>'qr_token' IS NOT NULL,
    'promocja: wskazana osoba awansuje poza kolejnoscia i dostaje poswiadczenie');
  PERFORM pg_temp.assert(
    (SELECT decision_source = 'organizer' AND decided_by IS NOT NULL
     FROM public.event_registrations WHERE id = v_id),
    'promocja: wyprzedzenie kolejki zostawia slad decyzji CZLOWIEKA, nie systemu');
  PERFORM pg_temp.assert_raises_like(
    format($q$SELECT public.admin_event_waitlist_promote(
      jsonb_build_object('registration_id', %L))$q$, v_id),
    'invalid_transition',
    'promocja/ODMOWA: nie da sie promowac kogos, kto na kolejce nie stoi');
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_waitlist_promote(
      jsonb_build_object('event_id','b1111111-0000-0000-0000-000000000001'))$q$,
    'not_found',
    'promocja/izolacja: redaktor A nie promuje kolejki najemcy B');
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_waitlist_promote('{}'::jsonb)$q$,
    'invalid_request',
    'promocja/ODMOWA: wywolanie bez wydarzenia i bez zapisu jest odrzucane');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 11: CRUD OPRAWY - pola, bilety, grupy, zgody
-- ---------------------------------------------------------------------------

-- Pola formularza: klucz jest NIEZMIENNY po zapisie.
DO $$
DECLARE v_id uuid; v_key text;
BEGIN
  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.admin_event_registration_field_upsert(jsonb_build_object(
      'event_id','a1111111-0000-0000-0000-000000000001',
      'key','ZLY KLUCZ', 'label_pl','XX', 'label_en','XX'))
  $q$, 'invalid_key',
    'pola/ODMOWA: klucz pola o zlym ksztalcie jest odrzucany');

  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.admin_event_registration_field_upsert(jsonb_build_object(
      'event_id','a1111111-0000-0000-0000-000000000001',
      'key','bez_etykiety', 'label_pl','Jest', 'label_en',''))
  $q$, 'invalid_labels',
    'pola/ODMOWA: etykieta jest wymagana w OBU jezykach');

  v_id := public.admin_event_registration_field_upsert(jsonb_build_object(
    'id','a3333333-0000-0000-0000-000000000001',
    'key','probowal_zmienic', 'label_pl','Motywacja 2', 'label_en','Motivation 2'));
  SELECT key INTO v_key FROM public.event_registration_fields WHERE id = v_id;
  PERFORM pg_temp.assert(v_key = 'motivation',
    'pola: klucz pola jest NIEZMIENNY po zapisie (odpowiedzi siedza pod nim)');

  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.admin_event_registration_field_upsert(jsonb_build_object(
      'event_id','b1111111-0000-0000-0000-000000000001',
      'key','obce', 'label_pl','XX', 'label_en','XX'))
  $q$, 'not_found',
    'pola/izolacja: redaktor A nie dopisze pola do wydarzenia najemcy B');

  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.admin_event_registration_field_delete('b3333333-0000-0000-0000-000000000001')
  $q$, 'not_found',
    'pola/izolacja: redaktor A nie usunie pola najemcy B');
END $$;

-- Lista bez opcji jest polem, ktorego nie da sie wypelnic (CHECK na tabeli).
SELECT pg_temp.assert_raises_like($q$
  INSERT INTO public.event_registration_fields
    (tenant_id, event_id, key, field_type, label_pl, label_en, options)
  VALUES ('11111111-1111-1111-1111-111111111111',
          'a1111111-0000-0000-0000-000000000001', 'lista_pusta', 'select',
          'Lista', 'List', '[]'::jsonb)
$q$, 'event_registration_fields_options_required',
  'pola/ODMOWA: lista wyboru BEZ opcji jest odrzucana przy zapisie definicji');

-- Pole kwalifikujace bez operatora nie kwalifikuje niczego.
SELECT pg_temp.assert_raises_like($q$
  INSERT INTO public.event_registration_fields
    (tenant_id, event_id, key, label_pl, label_en, is_qualifying, qualify_operator)
  VALUES ('11111111-1111-1111-1111-111111111111',
          'a1111111-0000-0000-0000-000000000001', 'niedokonczona', 'XX', 'XX', true, 'none')
$q$, 'event_registration_fields_qualify_complete',
  'pola/ODMOWA: przelacznik kwalifikacji bez reguly jest odrzucany');

-- Bilety: pula ponizej liczby zajetych, bilet w uzyciu, grupa z obcego wydarzenia.
DO $$
BEGIN
  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.admin_event_ticket_upsert(jsonb_build_object(
      'id','a2222222-0000-0000-0000-000000000001',
      'name_pl','Standard', 'name_en','Standard', 'quota', 1))
  $q$, 'quota_below_sold',
    'bilety/ODMOWA: pula ustawiona PONIZEJ liczby zajetych miejsc jest odrzucana');

  -- KONTRAKT WEJSCIA, ktory rozni sie od pol formularza: edycja biletu wymaga
  -- nazwy w OBU jezykach takze wtedy, gdy zmienia sie wylacznie pula. Klient
  -- odsylajacy payload czesciowy dostanie `invalid_names`, nie zapis.
  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.admin_event_ticket_upsert(jsonb_build_object(
      'id','a2222222-0000-0000-0000-000000000001', 'sort_order', 11))
  $q$, 'invalid_names',
    'bilety/ODMOWA: edycja biletu bez nazwy w obu jezykach jest odrzucana');

  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.admin_event_ticket_delete('a2222222-0000-0000-0000-000000000001')
  $q$, 'ticket_in_use',
    'bilety/ODMOWA: bilet uzywany przez zapisy nie daje sie usunac');

  -- Grupa z INNEGO wydarzenia tego samego najemcy - odmowa RPC...
  PERFORM pg_temp.assert_raises_like(format($q$
    SELECT public.admin_event_ticket_upsert(jsonb_build_object(
      'event_id','a1111111-0000-0000-0000-000000000001',
      'key','obca_grupa', 'name_pl','XX', 'name_en','XX', 'group_id', %L))
  $q$, (SELECT id FROM public.event_groups
         WHERE event_id = 'a1111111-0000-0000-0000-000000000002' AND key = 'attendees')),
    'group does not exist for this event',
    'bilety/izolacja: bilet nie moze nadac grupy z INNEGO wydarzenia (odmowa RPC)');

  -- ...i odmowa SILNIKA, ktora obowiazuje takze przy imporcie.
  PERFORM pg_temp.assert_raises_like(format($q$
    INSERT INTO public.event_ticket_types (tenant_id, event_id, key, name_pl, name_en, group_id)
    VALUES ('11111111-1111-1111-1111-111111111111',
            'a1111111-0000-0000-0000-000000000001', 'obca_grupa_silnik', 'XX', 'XX', %L)
  $q$, (SELECT id FROM public.event_groups
         WHERE event_id = 'a1111111-0000-0000-0000-000000000002' AND key = 'attendees')),
    'event_ticket_types_group_fkey',
    'bilety/izolacja: klucz obcy ZLOZONY odrzuca grupe z innego wydarzenia');

  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.admin_event_ticket_upsert(jsonb_build_object(
      'id','b2222222-0000-0000-0000-000000000001',
      'name_pl','Standard B', 'name_en','Standard B', 'quota', 9))
  $q$, 'not_found',
    'bilety/izolacja: redaktor A nie edytuje biletu najemcy B');
END $$;

-- CHECK `sold_within_quota` - ostatnia linia obrony puli.
SELECT pg_temp.assert_raises_like($q$
  UPDATE public.event_ticket_types SET quota = 1
  WHERE id = 'a2222222-0000-0000-0000-000000000001'
$q$, 'event_ticket_types_sold_within_quota',
  'bilety/ODMOWA: CHECK odrzuca pule mniejsza od liczby zajetych miejsc');

-- Waluta poza uzgodnionym zbiorem.
SELECT pg_temp.assert_raises_like($q$
  UPDATE public.event_ticket_types SET currency = 'USD'
  WHERE id = 'a2222222-0000-0000-0000-000000000001'
$q$, 'event_ticket_types_currency_values',
  'bilety/ODMOWA: trzecia waluta wymaga decyzji w kasie, nie w module wydarzen');

-- Grupy: systemowej nie da sie usunac, uzywanej tez nie.
DO $$
DECLARE v_id uuid;
BEGIN
  PERFORM pg_temp.assert_raises_like(format($q$
    SELECT public.admin_event_group_delete(%L)
  $q$, (SELECT id FROM public.event_groups
         WHERE event_id = 'a1111111-0000-0000-0000-000000000001' AND key = 'attendees')),
    'group_system',
    'grupy/ODMOWA: grupa systemowa nie daje sie usunac (zabralaby etykiete z archiwum)');

  v_id := public.admin_event_group_upsert(jsonb_build_object(
    'event_id','a1111111-0000-0000-0000-000000000001',
    'key','vip', 'name_pl','VIP', 'name_en','VIP', 'can_meet', true));
  PERFORM pg_temp.assert(
    (SELECT can_meet AND NOT is_system FROM public.event_groups WHERE id = v_id),
    'grupy: redaktor zaklada grupe wlasna, ktora NIE jest systemowa');
  PERFORM pg_temp.assert(public.admin_event_group_delete(v_id),
    'grupy: grupa wlasna bez czlonkow daje sie usunac');

  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.admin_event_group_upsert(jsonb_build_object(
      'event_id','b1111111-0000-0000-0000-000000000001',
      'key','obca', 'name_pl','XX', 'name_en','XX'))
  $q$, 'not_found',
    'grupy/izolacja: redaktor A nie dopisze grupy do wydarzenia najemcy B');
END $$;

-- Czlonkostwo w grupach dodatkowych.
DO $$
DECLARE
  v_group uuid := (SELECT id FROM public.event_groups
                    WHERE event_id = 'a1111111-0000-0000-0000-000000000001' AND key = 'speakers');
  v_person uuid := (SELECT u FROM reg_q WHERE k = 'anna_person');
  v_person_b uuid := (SELECT id FROM public.event_people
                       WHERE tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' LIMIT 1);
BEGIN
  PERFORM pg_temp.assert(
    public.admin_event_group_member_set(jsonb_build_object(
      'group_id', v_group, 'person_id', v_person, 'is_member', true)),
    'czlonkostwo: osobe da sie dopisac do grupy DODATKOWEJ');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_group_members
      WHERE group_id = v_group AND person_id = v_person) = 1,
    'czlonkostwo: dopisanie utworzylo dokladnie jeden wiersz');
  PERFORM public.admin_event_group_member_set(jsonb_build_object(
    'group_id', v_group, 'person_id', v_person, 'is_member', true));
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_group_members
      WHERE group_id = v_group AND person_id = v_person) = 1,
    'czlonkostwo: powtorne dopisanie nie dubluje wiersza');
  PERFORM pg_temp.assert(
    public.admin_event_group_member_set(jsonb_build_object(
      'group_id', v_group, 'person_id', v_person, 'is_member', false)),
    'czlonkostwo: czlonkostwo da sie odwolac');

  PERFORM pg_temp.assert_raises_like(format($q$
    SELECT public.admin_event_group_member_set(jsonb_build_object(
      'group_id', %L, 'person_id', %L, 'is_member', true))
  $q$, v_group, v_person_b), 'person does not exist in this tenant',
    'czlonkostwo/izolacja: osoby najemcy B nie da sie dopisac do grupy najemcy A');
END $$;

-- Zgody: wersja, uniewaznienie akceptacji, ochrona przed usunieciem.
DO $$
DECLARE v_id uuid; v_ver integer;
BEGIN
  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.admin_event_term_delete('a4444444-0000-0000-0000-000000000001')
  $q$, 'term_in_use',
    'zgody/ODMOWA: zgoda z zapisanymi akceptacjami nie daje sie usunac');

  -- ROZJAZD DWOCH DEFINICJI "ZGODY WYMAGANEJ", zmierzony, nie zgadniety.
  -- `event_register()` wymaga zgod z `display IN (registration,
  -- registration_and_access)`, a licznik `required_terms_missing` w liscie
  -- panelu liczy KAZDA zgode wymagana, takze wylacznie DOSTEPOWA. Skutek:
  -- zapis przechodzi poprawnie i natychmiast pokazuje sie w panelu z jedna
  -- brakujaca zgoda, o ktora formularz nikogo nie zapytal. Asercja utrwala
  -- stan FAKTYCZNY (1 = zgoda dostepowa), zeby zmiana ktorejkolwiek definicji
  -- byla widoczna, a nie cicha.
  PERFORM pg_temp.assert(
    (SELECT required_terms_missing FROM public.admin_event_registrations_list(
       'a1111111-0000-0000-0000-000000000001', NULL, NULL, NULL, 'anna') LIMIT 1) = 1,
    'zgody/ROZJAZD: panel liczy jako brakujaca takze zgode WYLACZNIE dostepowa');

  -- Ten sam kontrakt wejscia, co przy bilecie: edycja zgody wymaga etykiety
  -- w obu jezykach takze wtedy, gdy zmienia sie wylacznie wersja.
  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.admin_event_term_upsert(jsonb_build_object(
      'id','a4444444-0000-0000-0000-000000000001', 'bump_version', true))
  $q$, 'invalid_labels',
    'zgody/ODMOWA: edycja zgody bez etykiety w obu jezykach jest odrzucana');

  v_id := public.admin_event_term_upsert(jsonb_build_object(
    'id','a4444444-0000-0000-0000-000000000001',
    'label_pl','Regulamin', 'label_en','Terms', 'bump_version', true));
  SELECT version INTO v_ver FROM public.event_terms WHERE id = v_id;
  PERFORM pg_temp.assert(v_ver = 2,
    'zgody: bump_version podnosi wersje tresci');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_term_acceptances
      WHERE term_id = 'a4444444-0000-0000-0000-000000000001' AND version = 1) >= 1,
    'zgody: podniesienie wersji NIE kasuje starych akceptacji (zostaja dowodem)');

  -- Po podniesieniu wersji akceptacja przestaje byc AKTUALNA - i lista panelu
  -- musi to powiedziec liczba brakujacych zgod.
  PERFORM pg_temp.assert(
    (SELECT required_terms_missing FROM public.admin_event_registrations_list(
       'a1111111-0000-0000-0000-000000000001', NULL, NULL, NULL, 'anna') LIMIT 1) = 2,
    'zgody: po podniesieniu wersji akceptacja przestaje sie liczyc jako AKTUALNA');

  PERFORM pg_temp.assert_raises_like($q$
    SELECT public.admin_event_term_upsert(jsonb_build_object(
      'id','b4444444-0000-0000-0000-000000000001',
      'label_pl','Regulamin B', 'label_en','Terms B', 'bump_version', true))
  $q$, 'not_found',
    'zgody/izolacja: redaktor A nie podniesie wersji zgody najemcy B');
END $$;

-- Zgoda bez tresci i bez odnosnika jest checkboxem pod pustym miejscem.
SELECT pg_temp.assert_raises_like($q$
  INSERT INTO public.event_terms (tenant_id, event_id, key, label_pl, label_en)
  VALUES ('11111111-1111-1111-1111-111111111111',
          'a1111111-0000-0000-0000-000000000001', 'pusta_zgoda', 'Pusta', 'Empty')
$q$, 'event_terms_has_content',
  'zgody/ODMOWA: zgoda bez tresci i bez odnosnika jest odrzucana');

-- Ta sama osoba, ta sama zgoda, ta sama wersja - jeden dowod, nie dwa.
DO $$
DECLARE v_person uuid := (SELECT u FROM reg_q WHERE k = 'anna_person');
BEGIN
  PERFORM pg_temp.assert_raises_like(format($q$
    INSERT INTO public.event_term_acceptances (tenant_id, term_id, person_id, version)
    VALUES ('11111111-1111-1111-1111-111111111111',
            'a4444444-0000-0000-0000-000000000001', %L, 1)
  $q$, v_person), 'event_term_acceptances_unique',
    'zgody/ODMOWA: druga akceptacja tej samej wersji tej samej zgody jest odrzucana');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 12: IZOLACJA NAJEMCOW DLA KAZDEJ FUNKCJI LISTUJACEJ
--
-- Szesc funkcji listujacych modulu, kazda pytana Z OBU STRON: redaktor A
-- o wydarzenie B (musi zobaczyc ZERO) i redaktor B o swoje (kontrapunkt -
-- bez niego test nie odroznia izolacji od blokady).
-- ---------------------------------------------------------------------------

-- Najemca B musi miec co pokazac: dokladamy mu grupe dodatkowa i zgode.
SELECT pg_temp.act_as('e1111111-0000-0000-0000-000000000002',
                      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
DO $$
BEGIN
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_registrations_list(
       'b1111111-0000-0000-0000-000000000001')) = 1,
    'izolacja/kontrapunkt: redaktor B widzi SWOJ jeden zapis');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_tickets_list(
       'b1111111-0000-0000-0000-000000000001')) = 1,
    'izolacja/kontrapunkt: redaktor B widzi SWOJ jeden bilet');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_groups_list(
       'b1111111-0000-0000-0000-000000000001')) = 4,
    'izolacja/kontrapunkt: redaktor B widzi SWOJE cztery grupy startowe');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_terms_list(
       'b1111111-0000-0000-0000-000000000001')) = 1,
    'izolacja/kontrapunkt: redaktor B widzi SWOJA jedna zgode');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_registration_fields_list(
       'b1111111-0000-0000-0000-000000000001')) = 1,
    'izolacja/kontrapunkt: redaktor B widzi SWOJE jedno pole formularza');
  PERFORM pg_temp.assert(
    (public.admin_event_registrations_counts('b1111111-0000-0000-0000-000000000001')->>'all')::integer = 1,
    'izolacja/kontrapunkt: liczniki redaktora B licza SWOJ zapis');

  -- Redaktor B pytany o WYDARZENIE A: zero wierszy z kazdej listy.
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_registrations_list(
       'a1111111-0000-0000-0000-000000000001')) = 0,
    'IZOLACJA: redaktor B nie widzi ANI JEDNEGO zapisu najemcy A');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_tickets_list(
       'a1111111-0000-0000-0000-000000000001')) = 0,
    'IZOLACJA: redaktor B nie widzi ANI JEDNEGO biletu najemcy A');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_groups_list(
       'a1111111-0000-0000-0000-000000000001')) = 0,
    'IZOLACJA: redaktor B nie widzi ANI JEDNEJ grupy najemcy A');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_terms_list(
       'a1111111-0000-0000-0000-000000000001')) = 0,
    'IZOLACJA: redaktor B nie widzi ANI JEDNEJ zgody najemcy A');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_registration_fields_list(
       'a1111111-0000-0000-0000-000000000001')) = 0,
    'IZOLACJA: redaktor B nie widzi ANI JEDNEGO pola formularza najemcy A');
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_registrations_counts('a1111111-0000-0000-0000-000000000001')$q$,
    'not_found',
    'IZOLACJA: liczniki redaktora B odmawiaja dla wydarzenia najemcy A');
END $$;

-- Strona A: to samo pytanie z drugiej strony.
SELECT pg_temp.act_as('e1111111-0000-0000-0000-000000000001',
                      '11111111-1111-1111-1111-111111111111');
DO $$
BEGIN
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_registrations_list(
       'b1111111-0000-0000-0000-000000000001')) = 0,
    'IZOLACJA: redaktor A nie widzi ANI JEDNEGO zapisu najemcy B');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_tickets_list(
       'b1111111-0000-0000-0000-000000000001')) = 0,
    'IZOLACJA: redaktor A nie widzi ANI JEDNEGO biletu najemcy B');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_groups_list(
       'b1111111-0000-0000-0000-000000000001')) = 0,
    'IZOLACJA: redaktor A nie widzi ANI JEDNEJ grupy najemcy B');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_terms_list(
       'b1111111-0000-0000-0000-000000000001')) = 0,
    'IZOLACJA: redaktor A nie widzi ANI JEDNEJ zgody najemcy B');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_registration_fields_list(
       'b1111111-0000-0000-0000-000000000001')) = 0,
    'IZOLACJA: redaktor A nie widzi ANI JEDNEGO pola formularza najemcy B');
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.admin_event_registrations_counts('b1111111-0000-0000-0000-000000000001')$q$,
    'not_found',
    'IZOLACJA: liczniki redaktora A odmawiaja dla wydarzenia najemcy B');
  -- Zaden wiersz listy A nie wskazuje osoby z kartoteki najemcy B. Test idzie
  -- po TOZSAMOSCI, nie po adresie poczty: ten sam adres LEGALNIE istnieje
  -- u dwoch najemcow (unikalnosc jest per najemca), wiec porownanie adresow
  -- mierzylo by kolizje napisow, nie izolacje.
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.admin_event_registrations_list(
      'a1111111-0000-0000-0000-000000000001', 'all', NULL, NULL, NULL, NULL, NULL, 200, 0) l
      WHERE l.person_id IN (SELECT id FROM public.event_people
                             WHERE tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')),
    'IZOLACJA: lista najemcy A nie wskazuje ANI JEDNEJ osoby z kartoteki najemcy B');
  PERFORM pg_temp.assert(
    (SELECT bool_and(l.event_id = 'a1111111-0000-0000-0000-000000000001')
     FROM public.admin_event_registrations_list(
       'a1111111-0000-0000-0000-000000000001', 'all', NULL, NULL, NULL, NULL, NULL, 200, 0) l),
    'IZOLACJA: kazdy wiersz listy nalezy do wydarzenia, o ktore zapytano');
END $$;

-- Lista panelu: haszy nie oddaje, licznik calosci i filtry dzialaja.
DO $$
DECLARE v_all integer; v_total integer;
BEGIN
  SELECT count(*) INTO v_all FROM public.admin_event_registrations_list(
    'a1111111-0000-0000-0000-000000000001', 'all', NULL, NULL, NULL, NULL, NULL, 200, 0);
  SELECT total_count INTO v_total FROM public.admin_event_registrations_list(
    'a1111111-0000-0000-0000-000000000001', 'all', NULL, NULL, NULL, NULL, NULL, 1, 0);
  PERFORM pg_temp.assert(v_all = v_total AND v_all > 1,
    'lista: total_count w kazdym wierszu zgadza sie z liczba wierszy bez paginacji');
  -- Filtr statusu: wynik zawiera WYLACZNIE wiersze o tym statusie i tyle
  -- wierszy, ile mowi licznik zakladki. Prog "wiecej niz zero" jest tu
  -- konieczny - filtr zwracajacy pustke spelnialby warunek "tylko odrzucone".
  PERFORM pg_temp.assert(
    (SELECT count(*) > 0 AND bool_and(status = 'rejected')
     FROM public.admin_event_registrations_list(
       'a1111111-0000-0000-0000-000000000001', 'rejected')),
    'lista: filtr statusu oddaje niepusty zbior i WYLACZNIE wiersze tego statusu');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_registrations_list(
       'a1111111-0000-0000-0000-000000000001', 'rejected'))
    = (public.admin_event_registrations_counts(
        'a1111111-0000-0000-0000-000000000001')->>'rejected')::integer,
    'lista: liczba wierszy pod filtrem zgadza sie z licznikiem zakladki');
  PERFORM pg_temp.assert(
    (SELECT bool_and(has_qr IS NOT NULL) FROM public.admin_event_registrations_list(
       'a1111111-0000-0000-0000-000000000001', 'all', NULL, NULL, NULL, NULL, NULL, 200, 0)),
    'lista: zamiast hasza tokenu jedzie FLAGA has_qr');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.admin_event_registrations_list(
       'a1111111-0000-0000-0000-000000000001', NULL, NULL, NULL, 'kowalska')) = 1,
    'lista: wyszukiwanie po frazie trafia w znormalizowane nazwisko');
END $$;

-- Liczniki IGNORUJA filtr statusu, ale respektuja pozostale.
DO $$
DECLARE v jsonb;
BEGIN
  v := public.admin_event_registrations_counts('a1111111-0000-0000-0000-000000000001');
  PERFORM pg_temp.assert((v->>'all')::integer > (v->>'rejected')::integer
    AND (v->>'rejected')::integer > 0,
    'liczniki: licznik odrzuconych jest niezalezny od licznika calosci');
  PERFORM pg_temp.assert(
    (v->>'all')::integer = (v->>'draft')::integer + (v->>'pending')::integer
      + (v->>'approved')::integer + (v->>'rejected')::integer + (v->>'waitlist')::integer
      + (v->>'cancelled')::integer + (v->>'attended')::integer + (v->>'no_show')::integer,
    'liczniki: suma licznikow per status zgadza sie z licznikiem calosci (zaden stan nie ginie)');
  PERFORM pg_temp.assert(v ? 'capacity' AND v ? 'seats_left',
    'liczniki: doklada stan pojemnosci (organizator szuka tej liczby na tym ekranie)');
  PERFORM pg_temp.assert(
    (public.admin_event_registrations_counts(
       'a1111111-0000-0000-0000-000000000001',
       'a2222222-0000-0000-0000-000000000001')->>'all')::integer
    < (v->>'all')::integer,
    'liczniki: filtr biletu jest respektowany');
END $$;

-- Bilety panelu: stan sprzedazy WYLICZANY, nie kolumna.
DO $$
BEGIN
  PERFORM pg_temp.assert(
    (SELECT availability FROM public.admin_event_tickets_list(
       'a1111111-0000-0000-0000-000000000001') WHERE key = 'standard') = 'sold_out',
    'bilety: stan "wyprzedany" WYNIKA z puli i licznika, nie z kolumny statusu');
  PERFORM pg_temp.assert(
    (SELECT availability FROM public.admin_event_tickets_list(
       'a1111111-0000-0000-0000-000000000001') WHERE key = 'early') = 'scheduled',
    'bilety: stan "zaplanowany" wynika z okna sprzedazy');
  PERFORM pg_temp.assert(
    (SELECT seats_left IS NULL FROM public.admin_event_tickets_list(
       'a1111111-0000-0000-0000-000000000001') WHERE key = 'late'),
    'bilety: bilet bez puli oddaje NULL wolnych miejsc (bez limitu, nie zero)');
END $$;

-- Grupy panelu: licznik czlonkow rozbity na podstawowych i dodatkowych.
DO $$
BEGIN
  PERFORM pg_temp.assert(
    (SELECT primary_members_count > 0 FROM public.admin_event_groups_list(
       'a1111111-0000-0000-0000-000000000001') WHERE key = 'attendees'),
    'grupy: licznik czlonkow PODSTAWOWYCH liczy zapisy z ta grupa');
  PERFORM pg_temp.assert(
    (SELECT tickets_count FROM public.admin_event_groups_list(
       'a1111111-0000-0000-0000-000000000001') WHERE key = 'attendees') = 0,
    'grupy: licznik biletow nadajacych grupe stoi na zerze (zaden bilet jej nie nadaje)');
END $$;

-- ---------------------------------------------------------------------------
-- SEKCJA 13: RLS NA TABELACH MODULU
--
-- Polityki modulu sa TYLKO DO ODCZYTU; zapis nie ma zadnej polityki, bo idzie
-- przez RPC. Kazda asercja siedzi pod SET ROLE - RLS nie obowiazuje
-- superuzytkownika, wiec bez tego przechodzilaby ZAWSZE.
-- ---------------------------------------------------------------------------

-- Anonim nie ma grantu na ZADNA tabele modulu - to warunek bramki
-- `check:sql-anon-insert` sprawdzony wykonaniem, nie lektura.
SELECT pg_temp.act_as(NULL, NULL);
SET ROLE anon;
SELECT pg_temp.assert_raises_like(
  $q$SELECT count(*) FROM public.event_registrations$q$, 'permission denied',
  'RLS/anonim: anonim nie ma grantu SELECT na event_registrations');
SELECT pg_temp.assert_raises_like(
  $q$SELECT count(*) FROM public.event_people$q$, 'permission denied',
  'RLS/anonim: anonim nie ma grantu SELECT na event_people');
SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_people (tenant_id, first_name, last_name)
     VALUES ('11111111-1111-1111-1111-111111111111', 'A', 'B')$q$,
  'permission denied',
  'RLS/anonim: anonim nie potrafi wstawic wiersza do kartoteki wprost');
RESET ROLE;

-- Uczestnik zalogowany widzi WLASNY zapis i nie widzi cudzego.
DO $$
DECLARE v_person uuid := (SELECT u FROM reg_q WHERE k = 'anna_person');
BEGIN
  UPDATE public.event_people SET user_id = 'd1111111-0000-0000-0000-000000000001'
   WHERE id = v_person;
END $$;

SELECT pg_temp.act_as('d1111111-0000-0000-0000-000000000001',
                      '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_registrations) = 1,
  'RLS/uczestnik: widzi DOKLADNIE jeden wiersz - swoj wlasny');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_people) = 1,
  'RLS/uczestnik: widzi DOKLADNIE jeden wiersz kartoteki - swoj wlasny');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_term_acceptances) >= 1,
  'RLS/uczestnik: widzi wlasne akceptacje zgod (kontrapunkt - polityka nie jest deny-all)');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_ticket_types) = 0,
  'RLS/uczestnik: NIE widzi katalogu biletow (polityka jest tylko dla staffa)');
RESET ROLE;

-- Ten sam uczestnik z naglowkiem hosta OBCEGO najemcy nie widzi nic.
-- Asymetria "czytelne w dowolnym najemcy" byla regresja z audytu 2026-08-03.
SELECT pg_temp.act_as('d1111111-0000-0000-0000-000000000001',
                      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_registrations) = 0,
  'RLS/izolacja: wlasny wiersz NIE jest czytelny z naglowka obcego najemcy');
RESET ROLE;

-- Redaktor A widzi swoje i nie widzi ani jednego wiersza najemcy B.
SELECT pg_temp.act_as('e1111111-0000-0000-0000-000000000001',
                      '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_registrations
    WHERE tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') = 0,
  'RLS/IZOLACJA: redaktor A nie czyta ANI JEDNEGO zapisu najemcy B');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_people
    WHERE tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') = 0,
  'RLS/IZOLACJA: redaktor A nie czyta ANI JEDNEGO wiersza kartoteki najemcy B');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_ticket_types
    WHERE tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') = 0,
  'RLS/IZOLACJA: redaktor A nie czyta ANI JEDNEGO biletu najemcy B');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_terms
    WHERE tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') = 0,
  'RLS/IZOLACJA: redaktor A nie czyta ANI JEDNEJ zgody najemcy B');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_term_acceptances
    WHERE tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') = 0,
  'RLS/IZOLACJA: redaktor A nie czyta ANI JEDNEJ akceptacji zgody najemcy B');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_registrations
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111') > 1,
  'RLS/kontrapunkt: redaktor A czyta SWOJE zapisy (inaczej test mierzylby blokade)');
-- Zapis wprost do tabeli NIE MA polityki - i to jest stan pozadany.
SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_registrations SET status = 'approved'
     WHERE tenant_id = '11111111-1111-1111-1111-111111111111'$q$,
  'permission denied',
  'RLS: redaktor nie ma prawa ZAPISU wprost do tabeli (zapis idzie przez RPC)');
RESET ROLE;

-- Redaktor B, symetrycznie.
SELECT pg_temp.act_as('e1111111-0000-0000-0000-000000000002',
                      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_registrations
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111') = 0,
  'RLS/IZOLACJA: redaktor B nie czyta ANI JEDNEGO zapisu najemcy A');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_people
    WHERE tenant_id = '11111111-1111-1111-1111-111111111111') = 0,
  'RLS/IZOLACJA: redaktor B nie czyta ANI JEDNEGO wiersza kartoteki najemcy A');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_registrations
    WHERE tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') = 1,
  'RLS/kontrapunkt: redaktor B czyta SWOJ zapis');
RESET ROLE;

SELECT pg_temp.act_as(NULL, NULL);

-- ---------------------------------------------------------------------------
-- SEKCJA 14: KLUCZE OBCE ZLOZONE - granica najemcy pilnowana SILNIKIEM
--
-- Silnik obowiazuje takze przy COPY, imporcie i migracji danych, wiec te
-- asercje sa mocniejsze od kazdego warunku w RPC.
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_raises_like($q$
  INSERT INTO public.event_people (tenant_id, first_name, last_name, company_id)
  VALUES ('11111111-1111-1111-1111-111111111111', 'Obca', 'Firma',
          'c1111111-0000-0000-0000-0000000000b1')
$q$, 'event_people_company_tenant_fkey',
  'klucz zlozony: osoba najemcy A nie moze wskazac firmy CRM najemcy B');

DO $$
DECLARE v_person_b uuid := (SELECT id FROM public.event_people
                             WHERE tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' LIMIT 1);
BEGIN
  PERFORM pg_temp.assert_raises_like(format($q$
    INSERT INTO public.event_registrations
      (tenant_id, event_id, person_id, status, registration_mode)
    VALUES ('11111111-1111-1111-1111-111111111111',
            'a1111111-0000-0000-0000-000000000001', %L, 'pending', 'form')
  $q$, v_person_b), 'event_registrations_person_fkey',
    'klucz zlozony: zapis najemcy A nie moze wskazac osoby najemcy B');

  PERFORM pg_temp.assert_raises_like($q$
    INSERT INTO public.event_registrations
      (tenant_id, event_id, person_id, ticket_type_id, status, registration_mode)
    SELECT '11111111-1111-1111-1111-111111111111',
           'a1111111-0000-0000-0000-000000000001', p.id,
           'b2222222-0000-0000-0000-000000000001', 'pending', 'form'
    FROM public.event_people p
    WHERE p.tenant_id = '11111111-1111-1111-1111-111111111111' LIMIT 1
  $q$, 'event_registrations_ticket_fkey',
    'klucz zlozony: zapis najemcy A nie moze wskazac biletu najemcy B');
END $$;

-- Wiersz wskazujacy wydarzenie OBCEGO najemcy jest odrzucany.
SELECT pg_temp.assert_raises_like($q$
  INSERT INTO public.event_ticket_types (tenant_id, event_id, key, name_pl, name_en)
  VALUES ('11111111-1111-1111-1111-111111111111',
          'b1111111-0000-0000-0000-000000000001', 'obce_wydarzenie', 'XX', 'XX')
$q$, 'event_ticket_types_event_tenant_fkey',
  'klucz zlozony: bilet najemcy A nie moze wskazac wydarzenia najemcy B');

ROLLBACK;

-- ############################################################################
-- FAZA 2 - PULA BILETOW POD WSPOLBIEZNOSCIA
--
-- To jest najwazniejsza asercja tego pliku i JEDYNA, ktorej nie da sie zrobic
-- w jednej sesji. Migracja obiecuje, ze kazda sciezka zajmujaca miejsce
-- blokuje wiersz wydarzenia (a potem biletu) klauzula FOR UPDATE, wiec dwa
-- jednoczesne zapisy na OSTATNIE miejsce ustawiaja sie w kolejke i drugi widzi
-- skutek pierwszego. Bez tej blokady oba odczytalyby `seats_left = 1` i oba
-- zostalyby zatwierdzone - a wtedy pula biletu jest fikcja.
--
-- JAK JEST ZROBIONA WSPOLBIEZNOSC. `dblink` daje dwie OSOBNE sesje serwera
-- (osobne PID-y, osobne transakcje) - nie dwie transakcje w jednej sesji, bo
-- te nie moga istniec jednoczesnie. Sesja glowna najpierw BLOKUJE wiersz
-- wydarzenia, potem wysyla oba zapisy ASYNCHRONICZNIE i sprawdza w
-- `pg_stat_activity`, ze OBA NAPRAWDE CZEKAJA na tej samej blokadzie. Dopiero
-- wtedy zwalnia wiersz. Bez tego kroku pierwszy zapis moglby sie skonczyc,
-- zanim drugi zdazy zaczac - i test przechodzilby, nie testujac wyscigu.
--
-- DLACZEGO TA FAZA JEST ZACOMMITOWANA. Osobna sesja nie widzi cudzej otwartej
-- transakcji, wiec scenografia musi byc widoczna globalnie. Faza sprzata po
-- sobie jawnie: usuwa swojego najemce (kaskada zabiera wydarzenie, bilet,
-- osoby i zapisy), swoje zdarzenia domenowe i atrapy z sekcji 0.
-- ############################################################################
\echo '== 20 zapisy: pula biletow pod wspolbieznoscia (dwie sesje) =='

CREATE EXTENSION IF NOT EXISTS dblink;

INSERT INTO public.tenants (id, name, slug)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Tenant wyscigu', 'tc-race')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status,
   registration_mode, registration_flow, capacity)
VALUES ('cc111111-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'reg-race', 'Wyscig', 'Race', now() + interval '10 days', 'published',
        'rsvp', 'instant', NULL);

-- Pula JEDEN. Ostatnie miejsce jest jednoczesnie pierwszym.
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, quota)
VALUES ('cc222222-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'cc111111-0000-0000-0000-000000000001', 'last', 'Ostatni', 'Last', 1);

CREATE TEMP TABLE race_out (who text PRIMARY KEY, res jsonb);

-- Dwie osobne sesje serwera. Kazda dostaje najemce publicznego przez GUC -
-- `event_register()` czyta najemce Z KONTEKSTU, nigdy z wejscia.
SELECT dblink_connect('race1', format('host=%s port=%s dbname=%s user=postgres',
  (SELECT setting FROM pg_settings WHERE name = 'unix_socket_directories'),
  (SELECT setting FROM pg_settings WHERE name = 'port'),
  current_database()));
SELECT dblink_connect('race2', format('host=%s port=%s dbname=%s user=postgres',
  (SELECT setting FROM pg_settings WHERE name = 'unix_socket_directories'),
  (SELECT setting FROM pg_settings WHERE name = 'port'),
  current_database()));

SELECT x FROM dblink('race1',
  $$SELECT set_config('nes.public_tenant','cccccccc-cccc-cccc-cccc-cccccccccccc',false)$$)
  AS t(x text);
SELECT x FROM dblink('race2',
  $$SELECT set_config('nes.public_tenant','cccccccc-cccc-cccc-cccc-cccccccccccc',false)$$)
  AS t(x text);

-- Obie sesje potwierdzaja, ze widza scenografie i ze sa OSOBNYMI sesjami.
SELECT pg_temp.assert(
  (SELECT x::uuid FROM dblink('race1', 'SELECT public.public_tenant_id()') AS t(x text))
    = 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'wyscig: sesja 1 pracuje w najemcy wyscigu');
SELECT pg_temp.assert(
  (SELECT x::integer FROM dblink('race1', 'SELECT pg_backend_pid()') AS t(x text))
  <> (SELECT x::integer FROM dblink('race2', 'SELECT pg_backend_pid()') AS t(x text)),
  'wyscig: to sa DWIE osobne sesje serwera, nie dwa zapytania w jednej');

BEGIN;
-- Sesja glowna trzyma wiersz wydarzenia. Oba zapisy stana na tej blokadzie.
SELECT 1 FROM public.events
 WHERE id = 'cc111111-0000-0000-0000-000000000001' FOR UPDATE;

SELECT dblink_send_query('race1', $$
  SELECT public.event_register(jsonb_build_object(
    'event_id','cc111111-0000-0000-0000-000000000001',
    'ticket_type_id','cc222222-0000-0000-0000-000000000001',
    'email','race1@example.org', 'first_name','Race', 'last_name','One',
    'consent_data_processing', true))$$);
SELECT dblink_send_query('race2', $$
  SELECT public.event_register(jsonb_build_object(
    'event_id','cc111111-0000-0000-0000-000000000001',
    'ticket_type_id','cc222222-0000-0000-0000-000000000001',
    'email','race2@example.org', 'first_name','Race', 'last_name','Two',
    'consent_data_processing', true))$$);

-- DOWOD WSPOLBIEZNOSCI. Czekamy, az OBA zapisy zawisna na blokadzie wiersza.
-- Gdyby ktorykolwiek zdazyl sie skonczyc przed drugim, ta asercja by padla -
-- i sluszne, bo wtedy nie bylo wyscigu, tylko dwa zapisy po kolei.
DO $$
DECLARE v_blocked integer := 0; i integer := 0;
BEGIN
  WHILE i < 300 LOOP
    -- pg_stat_clear_snapshot() JEST TU WARUNKIEM DZIALANIA PETLI, nie ozdoba.
    -- Widoki pg_stat_* stabilizuja migawke stanu backendow na CALA transakcje,
    -- wiec bez tego wywolania kazdy obrot petli czyta te sama, pierwsza
    -- odpowiedz - i asercja przechodzi albo pada zaleznie od tego, w ktorej
    -- milisekundzie transakcja sie zaczela. Bez tej linijki test byl
    -- niedeterministyczny i raz na kilka przebiegow padal mimo poprawnej
    -- blokady.
    PERFORM pg_stat_clear_snapshot();
    SELECT count(*) INTO v_blocked
    FROM pg_stat_activity
    WHERE pid <> pg_backend_pid()
      AND wait_event_type = 'Lock'
      AND query LIKE '%event_register%';
    EXIT WHEN v_blocked >= 2;
    PERFORM pg_sleep(0.05);
    i := i + 1;
  END LOOP;
  PERFORM pg_temp.assert(v_blocked = 2,
    'wyscig/DOWOD: OBA zapisy czekaja JEDNOCZESNIE na blokadzie wiersza wydarzenia');
END $$;

COMMIT;

INSERT INTO race_out (who, res)
SELECT 'race1', x::jsonb FROM dblink_get_result('race1') AS t(x text);
SELECT * FROM dblink_get_result('race1') AS t(x text);
INSERT INTO race_out (who, res)
SELECT 'race2', x::jsonb FROM dblink_get_result('race2') AS t(x text);
SELECT * FROM dblink_get_result('race2') AS t(x text);

-- WYNIK WYSCIGU. Dokladnie jeden zatwierdzony, dokladnie jeden na kolejce.
SELECT pg_temp.assert(
  (SELECT count(*) FROM race_out) = 2,
  'wyscig: obie sesje oddaly odpowiedz (zadna nie padla na wyjatku)');

SELECT pg_temp.assert(
  (SELECT count(*) FROM race_out WHERE res->>'status' = 'approved') = 1,
  'WYSCIG: DOKLADNIE JEDEN z dwoch jednoczesnych zapisow zajal ostatnie miejsce');

SELECT pg_temp.assert(
  (SELECT count(*) FROM race_out WHERE res->>'status' = 'waitlist') = 1,
  'WYSCIG: drugi zapis dostal liste rezerwowa, a nie drugie to samo miejsce');

SELECT pg_temp.assert(
  (SELECT res->>'decision_source' FROM race_out WHERE res->>'status' = 'waitlist') = 'capacity',
  'WYSCIG: przegrany zna powod - brak miejsca, nie decyzja czlowieka');

SELECT pg_temp.assert(
  (SELECT (res->>'waitlist_position')::integer FROM race_out
    WHERE res->>'status' = 'waitlist') = 1,
  'WYSCIG: przegrany stoi na pozycji 1 kolejki (a nie bez pozycji)');

-- Stan bazy po wyscigu musi sie zgadzac z odpowiedziami - inaczej test
-- mierzylby to, co RPC powiedzialo, a nie to, co naprawde zapisalo.
SELECT pg_temp.assert(
  (SELECT sold_count FROM public.event_ticket_types
    WHERE id = 'cc222222-0000-0000-0000-000000000001') = 1,
  'WYSCIG: licznik zajetych miejsc stoi na 1, a nie na 2');

SELECT pg_temp.assert(
  (SELECT quota >= sold_count FROM public.event_ticket_types
    WHERE id = 'cc222222-0000-0000-0000-000000000001'),
  'WYSCIG: pula nie zostala przekroczona ani o jedno miejsce');

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_registrations
    WHERE event_id = 'cc111111-0000-0000-0000-000000000001' AND status = 'approved') = 1
  AND (SELECT count(*) FROM public.event_registrations
        WHERE event_id = 'cc111111-0000-0000-0000-000000000001' AND status = 'waitlist') = 1,
  'WYSCIG: w bazie stoi jeden zatwierdzony i jeden rezerwowy - zgodnie z odpowiedziami');

SELECT pg_temp.assert(
  (SELECT count(DISTINCT person_id) FROM public.event_registrations
    WHERE event_id = 'cc111111-0000-0000-0000-000000000001') = 2,
  'WYSCIG: dwie rozne osoby w kartotece - wyscig nie sklail ich w jeden wiersz');

-- ---------------------------------------------------------------------------
-- SPRZATANIE FAZY 2 I USUNIECIE ATRAP Z SEKCJI 0
--
-- Po tym miejscu baza jest DOKLADNIE taka, jaka ten plik zastal: pliki
-- 30_..60_ nie widza ani jednego wiersza i ani jednej kolumny wiecej.
-- ---------------------------------------------------------------------------
SELECT dblink_disconnect('race1');
SELECT dblink_disconnect('race2');
DROP TABLE race_out;
DROP EXTENSION dblink;

DELETE FROM public.domain_events WHERE tenant_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
DELETE FROM public.tenants WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

-- Usuwamy WYLACZNIE to, co ten plik dolozyl (patrz sekcja 0): jesli atrape
-- postawil harness.sql albo inny plik, zostaje na miejscu.
DO $do$
BEGIN
  IF current_setting('nes.t20_added_rate_limit', true) = '1' THEN
    DROP FUNCTION IF EXISTS public.rate_limit_hit(text, text, integer, integer);
    DROP TABLE IF EXISTS public.rate_limits;
  END IF;
  IF current_setting('nes.t20_added_rsvp_opens', true) = '1' THEN
    ALTER TABLE public.events DROP COLUMN IF EXISTS rsvp_opens_at;
  END IF;
  IF current_setting('nes.t20_added_early_rank', true) = '1' THEN
    ALTER TABLE public.events DROP COLUMN IF EXISTS early_rsvp_rank;
  END IF;
END
$do$;
-- `rsvp_opens_at` i `early_rsvp_rank` NIE sa juz sprzatane tutaj: przeniesione
-- do atrapy `events` w harness.sql, zgodnie ze zgloszeniem z naglowka tego
-- pliku. Zdejmowanie ich stad odbieralo by kolumny plikom 30_ .. 60_, ktore
-- biegna po tym - a przy niespelnionej asercji wczesniej w pliku ta linia
-- w ogole by nie wykonala sie, zostawiajac schemat w trzecim, jeszcze innym
-- stanie. Atrapa jest jedynym miejscem, w ktorym ksztalt wspolny ma prawo zyc.

SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_registrations
    WHERE tenant_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc') = 0
  AND (SELECT count(*) FROM public.tenants
        WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc') = 0,
  'sprzatanie: faza wspolbieznosci nie zostawila po sobie ani jednego wiersza');

\echo '== 20 zapisy: koniec =='
