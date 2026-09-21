-- Funkcjonalna weryfikacja izolacji tenantow na ZYWEJ bazie (RLS wlaczony,
-- rola `authenticated`, tozsamosc z `request.jwt.claim.sub`).
--
-- Scenariusz dryfu danych: wiersz zalozony w tenancie B, wlasciciel przepiety
-- do tenanta A. Sama rownosc `user_id = auth.uid()` przepuszczala taki wiersz
-- przez granice obszaru roboczego - te asercje pilnuja, ze juz nie przepuszcza.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION pg_temp.assert(_ok boolean, _label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF _ok IS NOT TRUE THEN
    RAISE EXCEPTION 'ASERCJA NIESPELNIONA: %', _label;
  END IF;
  RAISE NOTICE '  ok  %', _label;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.assert_raises(_sql text, _label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '  ok  % (odrzucone: %)', _label, left(SQLERRM, 60);
    RETURN;
  END;
  RAISE EXCEPTION 'ASERCJA NIESPELNIONA: % - operacja PRZESZLA, a miala zostac odrzucona', _label;
END $$;

/** Wykonuje SQL jako `authenticated` z podana tozsamoscia i zwraca liczbe wierszy. */
CREATE OR REPLACE FUNCTION pg_temp.count_as(_user uuid, _sql text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_count bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _user::text, true);
  SET LOCAL ROLE authenticated;
  EXECUTE format('SELECT count(*) FROM (%s) s', _sql) INTO v_count;
  RESET ROLE;
  RETURN v_count;
END $$;

/** Wykonuje zapis jako `authenticated`; TRUE gdy przeszedl, FALSE gdy odrzucony/bez skutku. */
CREATE OR REPLACE FUNCTION pg_temp.write_as(_user uuid, _sql text) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE v_rows bigint;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _user::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE _sql;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RETURN false;
  END;
  RESET ROLE;
  RETURN v_rows > 0;
END $$;

/**
 * Jak `write_as`, ale zwraca KOMUNIKAT bledu ('' gdy zapis przeszedl).
 *
 * Potrzebne od 2026-09-01, bo w module czatu odmowa ma DWA zrodla i nie wolno
 * ich mylic: brak GRANT-u ("permission denied") i brak/niespelniona POLITYKA
 * ("row-level security"). `write_as` widzi tylko „nie przeszlo", wiec asercja
 * o polityce przechodzilaby tam, gdzie realnie zatrzymal ja grant - czyli
 * milczalaby o tym, ze polityki nie ma wcale.
 */
CREATE OR REPLACE FUNCTION pg_temp.write_error_as(_user uuid, _sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _user::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    RETURN SQLERRM;
  END;
  RESET ROLE;
  RETURN '';
END $$;

/** Wartosc skalarna odczytana jako `authenticated` z podana tozsamoscia. */
CREATE OR REPLACE FUNCTION pg_temp.scalar_as(_user uuid, _sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_out text;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _user::text, true);
  SET LOCAL ROLE authenticated;
  EXECUTE _sql INTO v_out;
  RESET ROLE;
  RETURN v_out;
END $$;

-- ---------------------------------------------------------------------------
-- Fixture: dwa tenanty, dwaj uzytkownicy, wiersze wlasne i „dryfujace"
-- ---------------------------------------------------------------------------
-- Trzeci uzytkownik (Zofia Testowa) wchodzi z plaszczyzna czatu: bez niego nie
-- da sie oddzielic „obcy tenant" od „ten sam tenant, ale obca rozmowa", a to
-- jest w module 09 osobna granica i osobna polityka.
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000a1', 'jan.przykladowy@example.com'),
  ('b0000000-0000-0000-0000-0000000000b1', 'barbara.zmyslona@example.org'),
  ('c0000000-0000-0000-0000-0000000000c1', 'zofia.testowa@example.com');

INSERT INTO public.profiles (id, tenant_id, display_name) VALUES
  ('a0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Jan Przykladowy'),
  ('b0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'Barbara Zmyslona'),
  ('c0000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'Zofia Testowa');

-- ── MODUL 3: drzewo stron + wiersz dryfujacy ────────────────────────────────
-- Drzewo najemcy A (o-nas -> zespol) i strona najemcy B jako kandydat na
-- "obcego rodzica". `parent_id` osobnym UPDATE-em, bo wiersze odwoluja sie
-- do siebie.
INSERT INTO public.pages (id, tenant_id, slug, status) VALUES
  ('6a000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'o-nas',  'published'),
  ('6a000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'zespol', 'published'),
  ('6b000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'tajny-klient', 'published');

UPDATE public.pages SET parent_id = '6a000000-0000-0000-0000-0000000000a1'
  WHERE id = '6a000000-0000-0000-0000-0000000000a2';

-- ── Plaszczyzna wlasciciela: historia czytania i wyniki testu osobowosci ────
INSERT INTO public.user_read_history (id, user_id, tenant_id, post_id) VALUES
  ('7a000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1',
   '11111111-1111-1111-1111-111111111111', '7f000000-0000-0000-0000-0000000000f1'),
  ('7a000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000a1',
   '22222222-2222-2222-2222-222222222222', '7f000000-0000-0000-0000-0000000000f2');

INSERT INTO public.personality_result_history (id, user_id, tenant_id) VALUES
  ('7b000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-0000000000a1',
   '11111111-1111-1111-1111-111111111111'),
  ('7b000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-0000000000a1',
   '22222222-2222-2222-2222-222222222222');

-- Wiersze wlasne (tenant zgodny z profilem) + dryfujace (ten sam wlasciciel,
-- tenant obcy) - wstawiane z pominieciem RLS, bo odtwarzaja stan zastany.
INSERT INTO public.media_mentions (id, tenant_id, user_id, outlet, title, is_public) VALUES
  ('11111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-0000000000a1', 'Outlet A', 'Wlasna wzmianka A', false),
  ('11111111-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-0000000000a1', 'Outlet B', 'Dryfujaca wzmianka A w tenancie B', false),
  ('11111111-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
   'b0000000-0000-0000-0000-0000000000b1', 'Outlet B', 'Wzmianka B', true);

INSERT INTO public.saved_searches (id, tenant_id, user_id, name) VALUES
  ('22222222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-0000000000a1', 'Wlasne wyszukiwanie A'),
  ('22222222-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-0000000000a1', 'Dryfujace wyszukiwanie A'),
  ('22222222-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
   'b0000000-0000-0000-0000-0000000000b1', 'Wyszukiwanie B');

INSERT INTO public.user_follows (id, tenant_id, user_id, target_type, target_id) VALUES
  ('33333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-0000000000a1', 'author', '44444444-0000-0000-0000-000000000001'),
  ('33333333-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-0000000000a1', 'author', '44444444-0000-0000-0000-000000000002'),
  ('33333333-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
   'b0000000-0000-0000-0000-0000000000b1', 'author', '44444444-0000-0000-0000-000000000003');

\echo '== media_mentions =='
DO $$
DECLARE
  a uuid := 'a0000000-0000-0000-0000-0000000000a1';
  b uuid := 'b0000000-0000-0000-0000-0000000000b1';
BEGIN
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.media_mentions WHERE id = ''11111111-0000-0000-0000-000000000001''') = 1,
    'wlasciciel widzi wlasna wzmianke w swoim tenancie');
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.media_mentions WHERE id = ''11111111-0000-0000-0000-000000000002''') = 0,
    'wlasciciel NIE widzi wlasnej wzmianki lezacej w obcym tenancie');
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.media_mentions WHERE user_id = ''' || b || '''') = 0,
    'uzytkownik tenanta A nie widzi wzmianek uzytkownika tenanta B');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'UPDATE public.media_mentions SET title = ''przejete'' WHERE id = ''11111111-0000-0000-0000-000000000002'''),
    'wlasciciel nie zmieni wzmianki w obcym tenancie');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'DELETE FROM public.media_mentions WHERE id = ''11111111-0000-0000-0000-000000000002'''),
    'wlasciciel nie skasuje wzmianki w obcym tenancie');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'INSERT INTO public.media_mentions (tenant_id, user_id, outlet, title) VALUES ('
      || '''22222222-2222-2222-2222-222222222222'', ''' || a || ''', ''X'', ''Wstrzykniecie'')'),
    'nie da sie zapisac wzmianki do obcego tenanta');
  PERFORM pg_temp.assert(
    pg_temp.write_as(a,
      'INSERT INTO public.media_mentions (user_id, outlet, title) VALUES ('''
      || a || ''', ''X'', ''Nowa wzmianka'')'),
    'zapis do wlasnego tenanta dziala (domyslny tenant = tenant konta)');
  PERFORM pg_temp.assert(
    (SELECT tenant_id FROM public.media_mentions WHERE title = 'Nowa wzmianka')
      = '11111111-1111-1111-1111-111111111111',
    'domyslny tenant nowej wzmianki to tenant zalogowanego konta');
END $$;

\echo '== saved_searches =='
DO $$
DECLARE
  a uuid := 'a0000000-0000-0000-0000-0000000000a1';
BEGIN
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.saved_searches') = 1,
    'widoczne jest wylacznie wlasne wyszukiwanie z wlasnego tenanta');
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.saved_searches WHERE id = ''22222222-0000-0000-0000-000000000002''') = 0,
    'dryfujace wyszukiwanie w obcym tenancie jest niewidoczne');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'UPDATE public.saved_searches SET name = ''przejete'' WHERE id = ''22222222-0000-0000-0000-000000000002'''),
    'nie da sie zmienic wyszukiwania z obcego tenanta');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'DELETE FROM public.saved_searches WHERE id = ''22222222-0000-0000-0000-000000000003'''),
    'nie da sie skasowac cudzego wyszukiwania');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'INSERT INTO public.saved_searches (tenant_id, user_id, name) VALUES ('
      || '''22222222-2222-2222-2222-222222222222'', ''' || a || ''', ''Wstrzykniecie'')'),
    'nie da sie zapisac wyszukiwania do obcego tenanta');
  PERFORM pg_temp.assert(
    pg_temp.write_as(a,
      'INSERT INTO public.saved_searches (user_id, name) VALUES (''' || a || ''', ''Nowe'')'),
    'zapis wyszukiwania do wlasnego tenanta dziala');
END $$;

\echo '== user_follows =='
DO $$
DECLARE
  a uuid := 'a0000000-0000-0000-0000-0000000000a1';
BEGIN
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.user_follows') = 1,
    'widoczna jest wylacznie wlasna obserwacja z wlasnego tenanta');
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.user_follows WHERE id = ''33333333-0000-0000-0000-000000000002''') = 0,
    'dryfujaca obserwacja w obcym tenancie jest niewidoczna');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'DELETE FROM public.user_follows WHERE id = ''33333333-0000-0000-0000-000000000002'''),
    'nie da sie skasowac obserwacji z obcego tenanta');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'INSERT INTO public.user_follows (tenant_id, user_id, target_type, target_id) VALUES ('
      || '''22222222-2222-2222-2222-222222222222'', ''' || a || ''', ''author'', gen_random_uuid())'),
    'nie da sie zapisac obserwacji do obcego tenanta');
  PERFORM pg_temp.assert(
    pg_temp.write_as(a,
      'INSERT INTO public.user_follows (user_id, target_type, target_id) VALUES ('''
      || a || ''', ''author'', gen_random_uuid())'),
    'zapis obserwacji do wlasnego tenanta dziala');
END $$;

-- ---------------------------------------------------------------------------
-- ROZSZERZENIE 2026-08-31: plaszczyzna wlasciciela modulow monetyzacji.
-- Ten sam scenariusz dryfu: wiersz zalozony w tenancie B, wlasciciel (User A)
-- przepiety do tenanta A. Przed migracja 20260831060000 wlasciciel widzial
-- swoja historie zakupow, subskrypcji, przydzialow czlonkostwa, miejsc w
-- organizacji i linkow prezentowych TAKZE spoza swojego obszaru roboczego.
-- ---------------------------------------------------------------------------
INSERT INTO public.subscriptions (id, tenant_id, user_id) VALUES
  ('51111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-0000000000a1'),
  ('51111111-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-0000000000a1');

INSERT INTO public.membership_grants (id, tenant_id, user_id) VALUES
  ('52222222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-0000000000a1'),
  ('52222222-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-0000000000a1');

INSERT INTO public.organization_seats (id, tenant_id, user_id) VALUES
  ('53333333-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-0000000000a1'),
  ('53333333-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-0000000000a1');

INSERT INTO public.user_purchases (id, tenant_id, user_id, amount_cents) VALUES
  ('54444444-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-0000000000a1', 4900),
  ('54444444-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-0000000000a1', 9900);

INSERT INTO public.user_subscriptions (id, tenant_id, user_id) VALUES
  ('55555555-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-0000000000a1'),
  ('55555555-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-0000000000a1');

INSERT INTO public.post_gift_links (id, tenant_id, created_by) VALUES
  ('56666666-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-0000000000a1'),
  ('56666666-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-0000000000a1');

\echo '== subscriptions =='
DO $$
DECLARE a uuid := 'a0000000-0000-0000-0000-0000000000a1';
BEGIN
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.subscriptions WHERE id = ''51111111-0000-0000-0000-000000000001''') = 1,
    'wlasciciel widzi wlasna subskrypcje w swoim tenancie');
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.subscriptions WHERE id = ''51111111-0000-0000-0000-000000000002''') = 0,
    'wlasciciel NIE widzi wlasnej subskrypcji lezacej w obcym tenancie');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'UPDATE public.subscriptions SET status = ''cancelled'' WHERE id = ''51111111-0000-0000-0000-000000000002'''),
    'wlasciciel nie zmieni subskrypcji w obcym tenancie');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'DELETE FROM public.subscriptions WHERE id = ''51111111-0000-0000-0000-000000000002'''),
    'wlasciciel nie skasuje subskrypcji w obcym tenancie');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'INSERT INTO public.subscriptions (tenant_id, user_id) VALUES ('
      || '''22222222-2222-2222-2222-222222222222'', ''' || a || ''')'),
    'nie da sie zapisac subskrypcji do obcego tenanta');
END $$;

\echo '== membership_grants =='
DO $$
DECLARE a uuid := 'a0000000-0000-0000-0000-0000000000a1';
BEGIN
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.membership_grants') = 1,
    'widoczny jest wylacznie wlasny przydzial z wlasnego tenanta');
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.membership_grants WHERE id = ''52222222-0000-0000-0000-000000000002''') = 0,
    'dryfujacy przydzial czlonkostwa w obcym tenancie jest niewidoczny');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'UPDATE public.membership_grants SET tier_key = ''vip'' WHERE id = ''52222222-0000-0000-0000-000000000002'''),
    'nie da sie zmienic przydzialu z obcego tenanta');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'DELETE FROM public.membership_grants WHERE id = ''52222222-0000-0000-0000-000000000002'''),
    'nie da sie skasowac przydzialu z obcego tenanta');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'INSERT INTO public.membership_grants (tenant_id, user_id) VALUES ('
      || '''22222222-2222-2222-2222-222222222222'', ''' || a || ''')'),
    'nie da sie zapisac przydzialu do obcego tenanta');
END $$;

\echo '== organization_seats =='
DO $$
DECLARE a uuid := 'a0000000-0000-0000-0000-0000000000a1';
BEGIN
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.organization_seats') = 1,
    'widoczne jest wylacznie wlasne miejsce z wlasnego tenanta');
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.organization_seats WHERE id = ''53333333-0000-0000-0000-000000000002''') = 0,
    'dryfujace miejsce w organizacji obcego tenanta jest niewidoczne');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'DELETE FROM public.organization_seats WHERE id = ''53333333-0000-0000-0000-000000000002'''),
    'nie da sie skasowac miejsca z obcego tenanta');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'INSERT INTO public.organization_seats (tenant_id, user_id) VALUES ('
      || '''22222222-2222-2222-2222-222222222222'', ''' || a || ''')'),
    'nie da sie zapisac miejsca do obcego tenanta');
END $$;

\echo '== user_purchases =='
DO $$
DECLARE a uuid := 'a0000000-0000-0000-0000-0000000000a1';
BEGIN
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.user_purchases WHERE id = ''54444444-0000-0000-0000-000000000001''') = 1,
    'wlasciciel widzi wlasny zakup w swoim tenancie');
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.user_purchases WHERE id = ''54444444-0000-0000-0000-000000000002''') = 0,
    'historia zakupow z obcego tenanta jest niewidoczna');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'UPDATE public.user_purchases SET amount_cents = 1 WHERE id = ''54444444-0000-0000-0000-000000000002'''),
    'nie da sie zmienic zakupu z obcego tenanta');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'INSERT INTO public.user_purchases (tenant_id, user_id) VALUES ('
      || '''22222222-2222-2222-2222-222222222222'', ''' || a || ''')'),
    'nie da sie zapisac zakupu do obcego tenanta');
END $$;

\echo '== user_subscriptions =='
DO $$
DECLARE a uuid := 'a0000000-0000-0000-0000-0000000000a1';
BEGIN
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.user_subscriptions WHERE id = ''55555555-0000-0000-0000-000000000001''') = 1,
    'wlasciciel widzi wlasna subskrypcje uzytkownika w swoim tenancie');
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.user_subscriptions WHERE id = ''55555555-0000-0000-0000-000000000002''') = 0,
    'subskrypcja uzytkownika z obcego tenanta jest niewidoczna');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'DELETE FROM public.user_subscriptions WHERE id = ''55555555-0000-0000-0000-000000000002'''),
    'nie da sie skasowac subskrypcji uzytkownika z obcego tenanta');
END $$;

\echo '== post_gift_links =='
DO $$
DECLARE a uuid := 'a0000000-0000-0000-0000-0000000000a1';
BEGIN
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.post_gift_links WHERE id = ''56666666-0000-0000-0000-000000000001''') = 1,
    'tworca widzi wlasny link prezentowy w swoim tenancie');
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.post_gift_links WHERE id = ''56666666-0000-0000-0000-000000000002''') = 0,
    'link prezentowy zalozony w obcym tenancie jest niewidoczny (wlascicielstwo po created_by)');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'DELETE FROM public.post_gift_links WHERE id = ''56666666-0000-0000-0000-000000000002'''),
    'nie da sie skasowac linku prezentowego z obcego tenanta');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'INSERT INTO public.post_gift_links (tenant_id, created_by) VALUES ('
      || '''22222222-2222-2222-2222-222222222222'', ''' || a || ''')'),
    'nie da sie zapisac linku prezentowego do obcego tenanta');
END $$;

\echo '== kanoniczna sciezka strony (page_full_path) =='
-- Ta sekcja NIE mierzy polityki - mierzy cialo funkcji i schemat. Powod stoi
-- w harness.sql: sitemape generuje service_role (BYPASSRLS), wiec nad ta
-- funkcja nie ma zadnej polityki.
--
-- KOLEJNOSC ASERCJI JEST TU CZESCIA DOWODU i dlatego jest wymuszona:
--   1. najpierw SCHEMAT - dowod, ze migracja faktycznie sie wykonala,
--   2. potem ZAPIS - przy ograniczeniu NADAL ZALOZONYM,
--   3. na koniec ODCZYT - dopiero tu zdejmujemy ograniczenie i wstawiamy
--      wiersz dryfujacy, bo inaczej nie da sie odtworzyc stanu zastanego.
-- Odwrotna kolejnosc byla pierwsza wersja tego pliku i byla BLEDNA: wiersz
-- dryfujacy wymagal zdjecia ograniczenia w seedzie, a jego przywrocenie
-- czynilo asercje schematu SAMOSPELNIAJACA - przechodzilaby dlatego, ze test
-- sam zalozyl ograniczenie, a nie dlatego, ze zrobila to migracja.

-- 1. SCHEMAT.
DO $$
BEGIN
  PERFORM pg_temp.assert(
    EXISTS (SELECT 1 FROM pg_constraint
             WHERE conrelid = 'public.pages'::regclass
               AND conname = 'pages_parent_same_tenant_fkey'
               AND convalidated),
    'SCHEMAT: ograniczenie pages_parent_same_tenant_fkey zalozone przez migracje i ZWALIDOWANE');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace
        AND proname IN ('page_full_path', 'page_full_paths')
        AND prosrc NOT LIKE '%tenant_id%') = 0,
    'SCHEMAT: obie funkcje sciezki maja w ciele predykat najemcy');
END $$;

-- 2. ZAPIS (WITH CHECK / ograniczenie schematu) - ograniczenie jest zalozone.
DO $$
DECLARE a uuid := 'a0000000-0000-0000-0000-0000000000a1';
BEGIN
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'INSERT INTO public.pages (tenant_id, slug, status, parent_id) VALUES ('
      || '''11111111-1111-1111-1111-111111111111'', ''podszywka'', ''published'', '
      || '''6b000000-0000-0000-0000-0000000000b1'')'),
    'ZAPIS: nie da sie zalozyc strony z rodzicem u obcego najemcy');

  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'UPDATE public.pages SET parent_id = ''6b000000-0000-0000-0000-0000000000b1'' '
      || 'WHERE id = ''6a000000-0000-0000-0000-0000000000a2'''),
    'ZAPIS: nie da sie przepiac istniejacej strony pod rodzica z obcego najemcy');

  -- Kontrola dodatnia: legalny zapis w obrebie najemcy MUSI przechodzic,
  -- inaczej asercje wyzej przechodzilyby dlatego, ze zapis nie dziala WCALE.
  PERFORM pg_temp.assert(
    pg_temp.write_as(a,
      'INSERT INTO public.pages (tenant_id, slug, status, parent_id) VALUES ('
      || '''11111111-1111-1111-1111-111111111111'', ''legalna'', ''published'', '
      || '''6a000000-0000-0000-0000-0000000000a1'')'),
    'ZAPIS: legalna strona-dziecko w obrebie wlasnego najemcy przechodzi');
END $$;

-- 3. ODCZYT. Dopiero TERAZ odtwarzamy stan zastany: zdejmujemy ograniczenie
-- i wstawiamy wiersz, ktory schemat sprzed naprawy przyjmowal bez slowa -
-- strone najemcy A z rodzicem u najemcy B. To wlasnie on wnosil obcy slug do
-- sitemapy. Ograniczenie NIE jest przywracane, bo asercje schematu juz
-- zapadly i nic dalej na nim nie stoi.
ALTER TABLE public.pages DROP CONSTRAINT pages_parent_same_tenant_fkey;
INSERT INTO public.pages (id, tenant_id, slug, status, parent_id) VALUES
  ('6a000000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   'raport', 'published', '6b000000-0000-0000-0000-0000000000b1');

-- Funkcje wolane jako WLASCICIEL BAZY, czyli w ukladzie uprawnien generatora
-- sitemapy - tam wyciek jest realny. Gdyby asercja szla przez RLS,
-- przechodzilaby z zupelnie innego powodu (niewidoczny wiersz rodzica), czyli
-- mierzylaby nie to zjawisko.
DO $$
DECLARE
  v_own   text;
  v_drift text;
  v_batch text;
BEGIN
  SELECT public.page_full_path('6a000000-0000-0000-0000-0000000000a2') INTO v_own;
  PERFORM pg_temp.assert(v_own = 'o-nas/zespol',
    'ODCZYT: sciezka W OBREBIE najemcy sklada sie normalnie (predykat nie psuje drzewa)');

  SELECT public.page_full_path('6a000000-0000-0000-0000-0000000000a3') INTO v_drift;
  PERFORM pg_temp.assert(v_drift IS NULL OR v_drift NOT LIKE '%tajny-klient%',
    'ODCZYT: slug strony obcego najemcy nie wchodzi do sciezki kanonicznej');
  PERFORM pg_temp.assert(v_drift = 'raport',
    'ODCZYT: sciezka dryfujacej strony to wylacznie jej wlasny segment');

  SELECT full_path INTO v_batch FROM public.page_full_paths(
    ARRAY['6a000000-0000-0000-0000-0000000000a3'::uuid])
   WHERE page_id = '6a000000-0000-0000-0000-0000000000a3';
  PERFORM pg_temp.assert(v_batch = 'raport',
    'ODCZYT: wariant WSADOWY (obsluguje sitemape) tez urywa lancuch na granicy');
END $$;

\echo '== user_read_history =='
DO $$
DECLARE a uuid := 'a0000000-0000-0000-0000-0000000000a1';
BEGIN
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.user_read_history WHERE id = ''7a000000-0000-0000-0000-000000000001''') = 1,
    'wlasciciel widzi wlasna historie czytania z wlasnego tenanta');
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.user_read_history WHERE id = ''7a000000-0000-0000-0000-000000000002''') = 0,
    'historia czytania z obcego tenanta jest niewidoczna (RODO: co czlowiek czytal)');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'UPDATE public.user_read_history SET read_at = now() WHERE id = ''7a000000-0000-0000-0000-000000000002'''),
    'nie da sie zmienic historii czytania z obcego tenanta');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'DELETE FROM public.user_read_history WHERE id = ''7a000000-0000-0000-0000-000000000002'''),
    'nie da sie skasowac historii czytania z obcego tenanta');
  -- Zapis do obcego obszaru z JAWNYM tenant_id: default kolumny go NIE chroni,
  -- bo default dziala tylko wtedy, gdy kolumny nie ma w INSERT-cie.
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(a,
      'INSERT INTO public.user_read_history (user_id, tenant_id, post_id) VALUES ('
      || '''' || a || ''', ''22222222-2222-2222-2222-222222222222'', '
      || '''7f000000-0000-0000-0000-0000000000f3'')'),
    'nie da sie zapisac historii czytania do obcego tenanta (jawny tenant_id)');
  -- Kontrola dodatnia: zapis do WLASNEGO obszaru musi przechodzic, inaczej
  -- asercja powyzej przechodzilaby dlatego, ze INSERT nie dziala wcale.
  PERFORM pg_temp.assert(
    pg_temp.write_as(a,
      'INSERT INTO public.user_read_history (user_id, tenant_id, post_id) VALUES ('
      || '''' || a || ''', ''11111111-1111-1111-1111-111111111111'', '
      || '''7f000000-0000-0000-0000-0000000000f4'')'),
    'zapis historii czytania do WLASNEGO tenanta przechodzi');
END $$;

\echo '== personality_result_history =='
DO $$
DECLARE a uuid := 'a0000000-0000-0000-0000-0000000000a1';
BEGIN
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.personality_result_history WHERE id = ''7b000000-0000-0000-0000-000000000001''') = 1,
    'wlasciciel widzi wlasny wynik testu osobowosci z wlasnego tenanta');
  PERFORM pg_temp.assert(
    pg_temp.count_as(a, 'SELECT 1 FROM public.personality_result_history WHERE id = ''7b000000-0000-0000-0000-000000000002''') = 0,
    'wynik testu osobowosci z obcego tenanta jest niewidoczny (RODO: profil psychometryczny)');
END $$;

-- ===========================================================================
-- ROZSZERZENIE 2026-09-01: PLASZCZYZNA CZATU (MODUL 09).
--
-- Bramka statyczna `src/lib/ci/__tests__/chatPolicyContract.test.ts` dowodzi
-- KSZTALTU polityk czytanego z migracji. Ponizsze asercje domykaja to dowodem
-- WYKONAWCZYM: na zywej bazie, z rola `authenticated` i tozsamoscia z JWT.
--
-- W czacie granice sa DWIE i wykonawczo trzeba je rozdzielic:
--   * OBSZAR ROBOCZY - `tenant_id = current_tenant_id()`,
--   * ROZMOWA        - `conversation_id IN (SELECT member_conversation_ids())`.
-- Dlatego obsada to trzy osoby, a nie dwie: Jan i Zofia siedza w TYM SAMYM
-- tenancie, ale nie w tych samych rozmowach; Barbara jest w obcym tenancie.
--
--   rozmowa A  (tenant A) - Jan + Zofia
--   rozmowa A2 (tenant A) - sama Zofia; Jan jest jej OBCY mimo wspolnego tenanta
--   rozmowa B  (tenant B) - sama Barbara
-- ===========================================================================
INSERT INTO public.conversations (id, tenant_id, kind, created_by) VALUES
  ('9a000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'direct', 'a0000000-0000-0000-0000-0000000000a1'),
  ('9a000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   'direct', 'c0000000-0000-0000-0000-0000000000c1'),
  ('9b000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222',
   'direct', 'b0000000-0000-0000-0000-0000000000b1');

-- `cleared_before` Zofii stoi MIEDZY pierwsza a druga wiadomoscia rozmowy A.
-- Jan ma NULL. To jest cala pointa „wyczysc historie u mnie": ta sama rozmowa,
-- dwa rozne widoki.
INSERT INTO public.conversation_participants
  (conversation_id, user_id, tenant_id, cleared_before) VALUES
  ('9a000000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000a1',
   '11111111-1111-1111-1111-111111111111', NULL),
  ('9a000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000c1',
   '11111111-1111-1111-1111-111111111111', now() - interval '2 hours'),
  ('9a000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-0000000000c1',
   '11111111-1111-1111-1111-111111111111', NULL),
  ('9b000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-0000000000b1',
   '22222222-2222-2222-2222-222222222222', NULL);

INSERT INTO public.messages
  (id, conversation_id, tenant_id, sender_id, body, created_at, expires_at) VALUES
  -- STARA: przed `cleared_before` Zofii.
  ('9c000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-0000000000a1',
   '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-0000000000a1',
   'Umowmy sie na przyszly tydzien.', now() - interval '3 hours', NULL),
  -- NOWA: po `cleared_before` Zofii.
  ('9c000000-0000-0000-0000-000000000002', '9a000000-0000-0000-0000-0000000000a1',
   '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000c1',
   'Pasuje, odezwe sie z terminem.', now() - interval '1 hour', NULL),
  -- WYGASLA: TTL minal, wiersz nadal lezy w tabeli (purge chodzi z opoznieniem).
  ('9c000000-0000-0000-0000-000000000003', '9a000000-0000-0000-0000-0000000000a1',
   '11111111-1111-1111-1111-111111111111', 'a0000000-0000-0000-0000-0000000000a1',
   'Znikajaca notatka.', now() - interval '30 minutes', now() - interval '5 minutes'),
  -- OBCA ROZMOWA w TYM SAMYM tenancie.
  ('9c000000-0000-0000-0000-000000000004', '9a000000-0000-0000-0000-0000000000a2',
   '11111111-1111-1111-1111-111111111111', 'c0000000-0000-0000-0000-0000000000c1',
   'Watek prywatny Zofii.', now() - interval '2 hours', NULL),
  -- OBCY TENANT.
  ('9c000000-0000-0000-0000-000000000005', '9b000000-0000-0000-0000-0000000000b1',
   '22222222-2222-2222-2222-222222222222', 'b0000000-0000-0000-0000-0000000000b1',
   'Watek obszaru roboczego B.', now() - interval '2 hours', NULL);

INSERT INTO public.conversation_nicknames
  (conversation_id, user_id, tenant_id, nickname, set_by) VALUES
  ('9a000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000c1',
   '11111111-1111-1111-1111-111111111111', 'Zosia', 'a0000000-0000-0000-0000-0000000000a1'),
  ('9a000000-0000-0000-0000-0000000000a2', 'c0000000-0000-0000-0000-0000000000c1',
   '11111111-1111-1111-1111-111111111111', 'Ja', 'c0000000-0000-0000-0000-0000000000c1'),
  ('9b000000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-0000000000b1',
   '22222222-2222-2222-2222-222222222222', 'Basia', 'b0000000-0000-0000-0000-0000000000b1');

INSERT INTO public.message_reactions
  (id, message_id, conversation_id, tenant_id, user_id, emoji) VALUES
  ('9d000000-0000-0000-0000-000000000001', '9c000000-0000-0000-0000-000000000002',
   '9a000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'c0000000-0000-0000-0000-0000000000c1', ':+1:'),
  ('9d000000-0000-0000-0000-000000000002', '9c000000-0000-0000-0000-000000000004',
   '9a000000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   'c0000000-0000-0000-0000-0000000000c1', ':ok:'),
  ('9d000000-0000-0000-0000-000000000003', '9c000000-0000-0000-0000-000000000005',
   '9b000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222',
   'b0000000-0000-0000-0000-0000000000b1', ':eyes:');

-- Ta sama wiadomosc, dwie gwiazdki: Jana i Zofii. Gwiazdka jest PRYWATNA
-- zakladka, wiec Jan nie moze zobaczyc gwiazdki Zofii - i odwrotnie.
INSERT INTO public.message_stars (user_id, message_id, conversation_id, tenant_id) VALUES
  ('a0000000-0000-0000-0000-0000000000a1', '9c000000-0000-0000-0000-000000000002',
   '9a000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111'),
  ('c0000000-0000-0000-0000-0000000000c1', '9c000000-0000-0000-0000-000000000002',
   '9a000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');

-- Blokada wlasna Jana (tenant A) i blokada DRYFUJACA (ten sam wlasciciel,
-- tenant B) - ten sam scenariusz, co dla plaszczyzny wlasciciela wyzej.
INSERT INTO public.user_blocks (blocker_id, blocked_id, tenant_id) VALUES
  ('a0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000c1',
   '11111111-1111-1111-1111-111111111111'),
  ('a0000000-0000-0000-0000-0000000000a1', 'b0000000-0000-0000-0000-0000000000b1',
   '22222222-2222-2222-2222-222222222222'),
  ('c0000000-0000-0000-0000-0000000000c1', 'b0000000-0000-0000-0000-0000000000b1',
   '11111111-1111-1111-1111-111111111111');

INSERT INTO public.expert_inmails
  (id, tenant_id, sender_id, recipient_id, subject, reason) VALUES
  ('9e000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'a0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000c1',
   'Konsultacja w sprawie raportu',
   'Prosba o dwadziescia minut rozmowy na temat metodyki raportu kwartalnego.'),
  ('9e000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   'a0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-0000000000c1',
   'Prosba zlozona w obszarze B',
   'Ten sam nadawca i ten sam odbiorca, ale wiersz lezy w obcym obszarze roboczym.');

\echo '== messages =='
DO $$
DECLARE
  jan   uuid := 'a0000000-0000-0000-0000-0000000000a1';
  zofia uuid := 'c0000000-0000-0000-0000-0000000000c1';
  basia uuid := 'b0000000-0000-0000-0000-0000000000b1';
BEGIN
  PERFORM pg_temp.assert(
    pg_temp.count_as(jan,
      'SELECT 1 FROM public.messages WHERE conversation_id = ''9a000000-0000-0000-0000-0000000000a1''') = 2,
    'czlonek rozmowy czyta wiadomosci swojej rozmowy (dwie zywe, trzecia wygasla)');
  PERFORM pg_temp.assert(
    pg_temp.count_as(jan,
      'SELECT 1 FROM public.messages WHERE conversation_id = ''9a000000-0000-0000-0000-0000000000a2''') = 0,
    'uzytkownik spoza rozmowy nie widzi ani jednej wiadomosci - MIMO wspolnego tenanta');
  PERFORM pg_temp.assert(
    pg_temp.count_as(basia, 'SELECT 1 FROM public.messages WHERE tenant_id = ''11111111-1111-1111-1111-111111111111''') = 0,
    'uzytkownik obcego obszaru roboczego nie widzi ani jednej wiadomosci tenanta A');

  -- TTL: znikanie jest egzekwowane W POLITYCE, nie w kliencie. Wiersz nadal
  -- lezy w tabeli (purge chodzi z godzinna karencja), a mimo to jest niewidoczny.
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.messages WHERE id = '9c000000-0000-0000-0000-000000000003') = 1
    AND pg_temp.count_as(jan,
      'SELECT 1 FROM public.messages WHERE id = ''9c000000-0000-0000-0000-000000000003''') = 0,
    'wiadomosc z expires_at w PRZESZLOSCI jest niewidoczna, choc wiersz wciaz istnieje');

  -- Czyszczenie historii jest PER UCZESTNIK: ta sama wiadomosc, dwa widoki.
  PERFORM pg_temp.assert(
    pg_temp.count_as(jan,
      'SELECT 1 FROM public.messages WHERE id = ''9c000000-0000-0000-0000-000000000001''') = 1,
    'wiadomosc starsza niz cleared_before drugiej strony jest WIDOCZNA dla tego, kto nie czyscil');
  PERFORM pg_temp.assert(
    pg_temp.count_as(zofia,
      'SELECT 1 FROM public.messages WHERE id = ''9c000000-0000-0000-0000-000000000001''') = 0,
    'ta sama wiadomosc jest NIEWIDOCZNA dla uczestnika, ktory wyczyscil u siebie historie');
  PERFORM pg_temp.assert(
    pg_temp.count_as(zofia,
      'SELECT 1 FROM public.messages WHERE conversation_id = ''9a000000-0000-0000-0000-0000000000a1''') = 1,
    'po wyczyszczeniu historii uczestnik widzi wylacznie wiadomosci nowsze niz cleared_before');

  -- ZAPIS.
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(jan,
      'INSERT INTO public.messages (conversation_id, tenant_id, sender_id, body) VALUES ('
      || '''9a000000-0000-0000-0000-0000000000a1'', ''11111111-1111-1111-1111-111111111111'', '''
      || zofia || ''', ''Podszywam sie pod Zofie.'')'),
    'nie da sie wstawic wiadomosci z CUDZYM sender_id - polityka stempluje nadawce');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(jan,
      'INSERT INTO public.messages (conversation_id, tenant_id, sender_id, body) VALUES ('
      || '''9a000000-0000-0000-0000-0000000000a2'', ''11111111-1111-1111-1111-111111111111'', '''
      || jan || ''', ''Wchodze do cudzej rozmowy.'')'),
    'nie da sie napisac do rozmowy, do ktorej sie nie nalezy');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(jan,
      'INSERT INTO public.messages (conversation_id, tenant_id, sender_id, body) VALUES ('
      || '''9a000000-0000-0000-0000-0000000000a1'', ''22222222-2222-2222-2222-222222222222'', '''
      || jan || ''', ''Wiadomosc z obcym tenantem.'')'),
    'nie da sie wstawic wiadomosci z obcym tenant_id');
  -- Kontrola dodatnia: bez niej trzy asercje wyzej przechodzilyby takze wtedy,
  -- gdyby INSERT nie dzialal WCALE.
  PERFORM pg_temp.assert(
    pg_temp.write_as(jan,
      'INSERT INTO public.messages (conversation_id, tenant_id, sender_id, body) VALUES ('
      || '''9a000000-0000-0000-0000-0000000000a1'', ''11111111-1111-1111-1111-111111111111'', '''
      || jan || ''', ''Legalna wiadomosc.'')'),
    'legalny zapis do wlasnej rozmowy i wlasnego tenanta przechodzi');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(jan,
      'UPDATE public.messages SET body = ''przejete'' WHERE id = ''9c000000-0000-0000-0000-000000000002'''),
    'nie da sie zmienic tresci cudzej wiadomosci we wlasnej rozmowie');
END $$;

\echo '== conversations =='
-- Chwilowy GRANT INSERT jest tu CZESCIA DOWODU, a nie ulatwieniem. Na
-- produkcji `authenticated` nie ma na tej tabeli prawa INSERT - to jest zamek
-- PIERWSZY. Bez tego eksperymentu asercja „nie da sie zalozyc rozmowy"
-- przechodzilaby wylacznie dzieki grantowi i milczalaby o tym, czy DRUGI
-- zamek (brak polityki INSERT) w ogole istnieje. Grant jest zdejmowany zaraz
-- po asercji, wiec dalsze sekcje widza produkcyjny uklad uprawnien.
DO $$
DECLARE
  jan   uuid := 'a0000000-0000-0000-0000-0000000000a1';
  basia uuid := 'b0000000-0000-0000-0000-0000000000b1';
BEGIN
  PERFORM pg_temp.assert(
    pg_temp.count_as(jan, 'SELECT 1 FROM public.conversations') = 1,
    'czlonek widzi DOKLADNIE swoja rozmowe - ani obcej rozmowy z wlasnego tenanta, ani rozmowy tenanta B');
  PERFORM pg_temp.assert(
    pg_temp.count_as(basia, 'SELECT 1 FROM public.conversations WHERE id = ''9a000000-0000-0000-0000-0000000000a1''') = 0,
    'uzytkownik obcego obszaru roboczego nie widzi rozmowy tenanta A');
  PERFORM pg_temp.assert(
    pg_temp.write_error_as(jan,
      'INSERT INTO public.conversations (tenant_id, kind, created_by) VALUES ('
      || '''11111111-1111-1111-1111-111111111111'', ''direct'', ''' || jan || ''')')
      LIKE '%permission denied%',
    'ZAMEK 1: `authenticated` nie ma prawa INSERT na conversations');
END $$;

GRANT INSERT ON public.conversations TO authenticated;
DO $$
DECLARE jan uuid := 'a0000000-0000-0000-0000-0000000000a1';
BEGIN
  PERFORM pg_temp.assert(
    pg_temp.write_error_as(jan,
      'INSERT INTO public.conversations (tenant_id, kind, created_by) VALUES ('
      || '''11111111-1111-1111-1111-111111111111'', ''direct'', ''' || jan || ''')')
      LIKE '%row-level security%',
    'ZAMEK 2: nawet z prawem INSERT rozmowy nie da sie zalozyc - polityki INSERT NIE MA (zapis idzie przez RPC)');
END $$;
REVOKE INSERT ON public.conversations FROM authenticated;

\echo '== conversation_participants i conversation_nicknames =='
DO $$
DECLARE
  jan   uuid := 'a0000000-0000-0000-0000-0000000000a1';
  zofia uuid := 'c0000000-0000-0000-0000-0000000000c1';
  basia uuid := 'b0000000-0000-0000-0000-0000000000b1';
BEGIN
  PERFORM pg_temp.assert(
    pg_temp.count_as(jan, 'SELECT 1 FROM public.conversation_participants') = 2,
    'uczestnik widzi obie strony WYLACZNIE swojej rozmowy');
  PERFORM pg_temp.assert(
    pg_temp.count_as(jan,
      'SELECT 1 FROM public.conversation_participants WHERE conversation_id = ''9a000000-0000-0000-0000-0000000000a2''') = 0,
    'wiersze uczestnikow obcej rozmowy z wlasnego tenanta sa niewidoczne');
  PERFORM pg_temp.assert(
    pg_temp.count_as(basia,
      'SELECT 1 FROM public.conversation_participants WHERE tenant_id = ''11111111-1111-1111-1111-111111111111''') = 0,
    'uczestnicy rozmow tenanta A sa niewidoczni z tenanta B');

  PERFORM pg_temp.assert(
    pg_temp.count_as(jan, 'SELECT 1 FROM public.conversation_nicknames') = 1,
    'pseudonimy widac tylko w obrebie wlasnej rozmowy i wlasnego tenanta');
  PERFORM pg_temp.assert(
    pg_temp.count_as(basia,
      'SELECT 1 FROM public.conversation_nicknames WHERE tenant_id = ''11111111-1111-1111-1111-111111111111''') = 0,
    'pseudonimy tenanta A sa niewidoczne z tenanta B');

  -- ZAMEK 1 dla obu tabel: brak grantu zapisu.
  PERFORM pg_temp.assert(
    pg_temp.write_error_as(zofia,
      'UPDATE public.conversation_participants SET cleared_before = NULL WHERE user_id = ''' || zofia || '''')
      LIKE '%permission denied%',
    'ZAMEK 1: `authenticated` nie ma prawa UPDATE na conversation_participants');
  PERFORM pg_temp.assert(
    pg_temp.write_error_as(jan,
      'INSERT INTO public.conversation_participants (conversation_id, user_id, tenant_id) VALUES ('
      || '''9a000000-0000-0000-0000-0000000000a2'', ''' || jan || ''', ''11111111-1111-1111-1111-111111111111'')')
      LIKE '%permission denied%',
    'ZAMEK 1: nie da sie dopisac siebie do cudzej rozmowy - brak prawa INSERT');
  PERFORM pg_temp.assert(
    pg_temp.write_error_as(jan,
      'UPDATE public.conversation_nicknames SET nickname = ''Przezwisko'' WHERE conversation_id = ''9a000000-0000-0000-0000-0000000000a1''')
      LIKE '%permission denied%',
    'ZAMEK 1: `authenticated` nie ma prawa UPDATE na conversation_nicknames');
END $$;

-- ZAMEK 2 dla obu tabel: nawet z pelnym prawem zapisu nie ma polityki, ktora
-- by go przepuscila. Obie maja WYLACZNIE polityke SELECT - zapis idzie przez
-- RPC (`chat_set_nickname`, `chat_clear_history`, `mark_conversation_read`).
GRANT INSERT, UPDATE, DELETE ON public.conversation_participants TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.conversation_nicknames TO authenticated;
DO $$
DECLARE
  jan   uuid := 'a0000000-0000-0000-0000-0000000000a1';
  zofia uuid := 'c0000000-0000-0000-0000-0000000000c1';
BEGIN
  PERFORM pg_temp.assert(
    pg_temp.write_error_as(jan,
      'INSERT INTO public.conversation_participants (conversation_id, user_id, tenant_id) VALUES ('
      || '''9a000000-0000-0000-0000-0000000000a2'', ''' || jan || ''', ''11111111-1111-1111-1111-111111111111'')')
      LIKE '%row-level security%',
    'ZAMEK 2: dopisanie uczestnika odbija sie o BRAK polityki INSERT');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(zofia,
      'UPDATE public.conversation_participants SET cleared_before = NULL WHERE user_id = ''' || zofia || ''''),
    'ZAMEK 2: wlasnego wiersza uczestnika tez nie da sie zmienic - polityki UPDATE NIE MA');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(jan,
      'DELETE FROM public.conversation_participants WHERE conversation_id = ''9a000000-0000-0000-0000-0000000000a1'''),
    'ZAMEK 2: nie da sie wypisac nikogo z rozmowy - polityki DELETE NIE MA');
  PERFORM pg_temp.assert(
    pg_temp.write_error_as(jan,
      'INSERT INTO public.conversation_nicknames (conversation_id, user_id, tenant_id, nickname) VALUES ('
      || '''9a000000-0000-0000-0000-0000000000a1'', ''' || zofia || ''', '
      || '''11111111-1111-1111-1111-111111111111'', ''Nowe'')')
      LIKE '%row-level security%',
    'ZAMEK 2: nadanie pseudonimu odbija sie o BRAK polityki INSERT');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(jan,
      'DELETE FROM public.conversation_nicknames WHERE conversation_id = ''9a000000-0000-0000-0000-0000000000a1'''),
    'ZAMEK 2: nie da sie skasowac pseudonimu - polityki DELETE NIE MA');
END $$;
REVOKE INSERT, UPDATE, DELETE ON public.conversation_participants FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.conversation_nicknames FROM authenticated;

-- POTWIERDZENIA ODCZYTU. Wylaczenie ich ma UKRYWAC wiersz peera, a nie tylko
-- przestac go rysowac w UI - inaczej „nie pokazuj, ze przeczytalem" byloby
-- ozdoba. Wiersz WLASNY zostaje widoczny zawsze (galaz `user_id = auth.uid()`).
INSERT INTO public.notification_preferences (user_id, tenant_id, read_receipts_enabled) VALUES
  ('c0000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', false);
DO $$
DECLARE
  jan   uuid := 'a0000000-0000-0000-0000-0000000000a1';
  zofia uuid := 'c0000000-0000-0000-0000-0000000000c1';
BEGIN
  PERFORM pg_temp.assert(
    pg_temp.count_as(jan, 'SELECT 1 FROM public.conversation_participants') = 1,
    'gdy druga strona wylaczy potwierdzenia odczytu, jej wiersz uczestnika ZNIKA z widoku');
  PERFORM pg_temp.assert(
    pg_temp.count_as(zofia,
      'SELECT 1 FROM public.conversation_participants WHERE user_id = ''' || zofia || '''') = 2,
    'wlasne wiersze uczestnika zostaja widoczne mimo wylaczonych potwierdzen');
END $$;
DELETE FROM public.notification_preferences WHERE user_id = 'c0000000-0000-0000-0000-0000000000c1';

\echo '== message_reactions i message_stars =='
DO $$
DECLARE
  jan   uuid := 'a0000000-0000-0000-0000-0000000000a1';
  zofia uuid := 'c0000000-0000-0000-0000-0000000000c1';
BEGIN
  -- Odczyt reakcji jest CZLONKOWSKI, nie wlascicielski: inaczej licznik pod
  -- dymkiem pokazywalby wylacznie wlasna reakcje.
  PERFORM pg_temp.assert(
    pg_temp.count_as(jan,
      'SELECT 1 FROM public.message_reactions WHERE id = ''9d000000-0000-0000-0000-000000000001''') = 1,
    'uczestnik widzi CUDZA reakcje w swojej rozmowie (odczyt czlonkowski)');
  PERFORM pg_temp.assert(
    pg_temp.count_as(jan, 'SELECT 1 FROM public.message_reactions') = 1,
    'reakcje z obcej rozmowy i z obcego tenanta nie wchodza do widoku');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(jan,
      'INSERT INTO public.message_reactions (message_id, conversation_id, tenant_id, user_id, emoji) VALUES ('
      || '''9c000000-0000-0000-0000-000000000001'', ''9a000000-0000-0000-0000-0000000000a1'', '
      || '''11111111-1111-1111-1111-111111111111'', ''' || zofia || ''', '':x:'')'),
    'nie da sie zareagowac CUDZYM nazwiskiem - zapis reakcji jest wlascicielski');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(jan,
      'INSERT INTO public.message_reactions (message_id, conversation_id, tenant_id, user_id, emoji) VALUES ('
      || '''9c000000-0000-0000-0000-000000000004'', ''9a000000-0000-0000-0000-0000000000a2'', '
      || '''11111111-1111-1111-1111-111111111111'', ''' || jan || ''', '':x:'')'),
    'nie da sie zareagowac na wiadomosc z rozmowy, do ktorej sie nie nalezy');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(jan,
      'INSERT INTO public.message_reactions (message_id, conversation_id, tenant_id, user_id, emoji) VALUES ('
      || '''9c000000-0000-0000-0000-000000000001'', ''9a000000-0000-0000-0000-0000000000a1'', '
      || '''22222222-2222-2222-2222-222222222222'', ''' || jan || ''', '':x:'')'),
    'nie da sie zapisac reakcji do obcego tenanta');
  PERFORM pg_temp.assert(
    pg_temp.write_as(jan,
      'INSERT INTO public.message_reactions (message_id, conversation_id, tenant_id, user_id, emoji) VALUES ('
      || '''9c000000-0000-0000-0000-000000000001'', ''9a000000-0000-0000-0000-0000000000a1'', '
      || '''11111111-1111-1111-1111-111111111111'', ''' || jan || ''', '':+1:'')'),
    'wlasna reakcja we wlasnej rozmowie przechodzi (kontrola dodatnia)');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(jan,
      'DELETE FROM public.message_reactions WHERE id = ''9d000000-0000-0000-0000-000000000001'''),
    'nie da sie skasowac cudzej reakcji');

  -- Gwiazdka jest PRYWATNA zakladka - i to jest cala roznica wobec reakcji.
  PERFORM pg_temp.assert(
    pg_temp.count_as(jan, 'SELECT 1 FROM public.message_stars') = 1,
    'wlasciciel widzi WYLACZNIE wlasna gwiazdke, choc pod ta sama wiadomoscia sa dwie');
  PERFORM pg_temp.assert(
    pg_temp.count_as(jan,
      'SELECT 1 FROM public.message_stars WHERE user_id = ''' || zofia || '''') = 0,
    'cudzej gwiazdki nie widac nawet we wlasnej rozmowie (odczyt wlascicielski)');
  PERFORM pg_temp.assert(
    pg_temp.count_as(zofia,
      'SELECT 1 FROM public.message_stars WHERE user_id = ''' || zofia || '''') = 1,
    'wlasciciel gwiazdki widzi ja u siebie (kontrola dodatnia)');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(jan,
      'INSERT INTO public.message_stars (user_id, message_id, conversation_id, tenant_id) VALUES ('''
      || jan || ''', ''9c000000-0000-0000-0000-000000000001'', '
      || '''9a000000-0000-0000-0000-0000000000a1'', ''22222222-2222-2222-2222-222222222222'')'),
    'nie da sie zapisac gwiazdki do obcego tenanta');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(jan,
      'INSERT INTO public.message_stars (user_id, message_id, conversation_id, tenant_id) VALUES ('''
      || jan || ''', ''9c000000-0000-0000-0000-000000000004'', '
      || '''9a000000-0000-0000-0000-0000000000a2'', ''11111111-1111-1111-1111-111111111111'')'),
    'nie da sie oznaczyc gwiazdka wiadomosci z rozmowy, do ktorej sie nie nalezy');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(jan,
      'DELETE FROM public.message_stars WHERE user_id = ''' || zofia || ''''),
    'nie da sie skasowac cudzej gwiazdki');
END $$;

\echo '== user_blocks =='
-- DWIE FORMY WYZNACZANIA TENANTA, JEDEN WYNIK. `INSERT WITH CHECK` uzywa
-- PODZAPYTANIA do `profiles`, a `SELECT`/`DELETE` funkcji `current_tenant_id()`.
-- Bramka statyczna dowodzi, ze to ta sama kwerenda; tutaj dowodzimy tego
-- WYKONAWCZO - obiegiem zapis-odczyt: co przepuscil podzapytaniowy WITH CHECK,
-- to funkcyjny USING pokazuje, i odwrotnie.
--
-- DLACZEGO NIE PRZEZ DEFAULT KOLUMNY. `user_blocks.tenant_id` jest NOT NULL
-- i nie ma DEFAULT-u w calym lancuchu migracji (inaczej niz np.
-- `saved_searches`). Zapis „bez podania tenanta" konczy sie wiec naruszeniem
-- NOT NULL, a nie wskazaniem wlasnego obszaru - i to tez jest tu zapisane,
-- zeby nikt nie zalozyl domyslki, ktorej nie ma.
DO $$
DECLARE
  jan   uuid := 'a0000000-0000-0000-0000-0000000000a1';
  zofia uuid := 'c0000000-0000-0000-0000-0000000000c1';
BEGIN
  PERFORM pg_temp.assert(
    pg_temp.scalar_as(jan, 'SELECT public.current_tenant_id()::text')
      = pg_temp.scalar_as(jan,
          'SELECT (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid())::text'),
    'obie formy wyznaczania tenanta zwracaja te sama wartosc dla tej samej tozsamosci');

  PERFORM pg_temp.assert(
    pg_temp.count_as(jan, 'SELECT 1 FROM public.user_blocks') = 1,
    'wlasciciel widzi WYLACZNIE wlasna blokade z wlasnego obszaru roboczego');
  PERFORM pg_temp.assert(
    pg_temp.count_as(jan,
      'SELECT 1 FROM public.user_blocks WHERE tenant_id = ''22222222-2222-2222-2222-222222222222''') = 0,
    'dryfujaca blokada w obcym obszarze roboczym jest niewidoczna');
  PERFORM pg_temp.assert(
    pg_temp.count_as(jan,
      'SELECT 1 FROM public.user_blocks WHERE blocker_id = ''' || zofia || '''') = 0,
    'cudzej blokady nie widac nawet w tym samym obszarze roboczym');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(jan,
      'DELETE FROM public.user_blocks WHERE blocked_id = ''b0000000-0000-0000-0000-0000000000b1'''
      || ' AND blocker_id = ''' || jan || ''''),
    'nie da sie skasowac wlasnej blokady lezacej w obcym obszarze roboczym');
  PERFORM pg_temp.assert(
    pg_temp.write_error_as(jan,
      'INSERT INTO public.user_blocks (blocker_id, blocked_id, tenant_id) VALUES ('''
      || jan || ''', ''b0000000-0000-0000-0000-0000000000b1'', ''22222222-2222-2222-2222-222222222222'')')
      LIKE '%row-level security%',
    'PODZAPYTANIE: zapis blokady z JAWNYM obcym tenant_id jest odrzucany');
  -- „Zapis bez podania tenanta" NIE trafia do wlasnego obszaru roboczego,
  -- bo nie ma czym - kolumna nie ma DEFAULT-u (inaczej niz `saved_searches`
  -- czy `user_follows` wyzej). Odrzuca go RLS, nie NOT NULL: w PostgreSQL 16
  -- `WITH CHECK` polityki jest sprawdzany PRZED ograniczeniami kolumny,
  -- a `tenant_id = (podzapytanie)` przy NULL-u nie jest prawda.
  PERFORM pg_temp.assert(
    (SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user_blocks'
        AND column_name = 'tenant_id') IS NULL,
    'SCHEMAT: user_blocks.tenant_id nie ma DEFAULT-u - nie ma domyslki, ktora by wskazala wlasny obszar');
  PERFORM pg_temp.assert(
    pg_temp.write_error_as(jan,
      'INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('''
      || jan || ''', ''b0000000-0000-0000-0000-0000000000b1'')')
      LIKE '%row-level security%',
    'BRAK DEFAULT-u: zapis bez tenant_id jest odrzucany przez WITH CHECK, a nie po cichu przypisywany');

  -- OBIEG ZAPIS-ODCZYT na JEDNYM wierszu: kasuje go polityka DELETE
  -- (`current_tenant_id()`), a wstawia z powrotem polityka INSERT
  -- (podzapytanie do `profiles`) - i po powrocie znow go widac.
  -- To jest wykonawczy dowod, ze obie formy wskazuja ten sam obszar roboczy.
  PERFORM pg_temp.assert(
    pg_temp.write_as(jan,
      'DELETE FROM public.user_blocks WHERE blocked_id = ''' || zofia || ''''),
    'FUNKCJA: wlasna blokade z wlasnego obszaru roboczego da sie skasowac');
  PERFORM pg_temp.assert(
    pg_temp.write_as(jan,
      'INSERT INTO public.user_blocks (blocker_id, blocked_id, tenant_id) VALUES ('''
      || jan || ''', ''' || zofia || ''', ''11111111-1111-1111-1111-111111111111'')'),
    'PODZAPYTANIE: zapis blokady z wlasnym tenant_id przechodzi');
  PERFORM pg_temp.assert(
    pg_temp.count_as(jan, 'SELECT 1 FROM public.user_blocks') = 1,
    'ROWNOWAZNOSC: wiersz przepuszczony przez WITH CHECK (podzapytanie) widzi USING (current_tenant_id())');
END $$;

\echo '== prosby eksperckie: pulapka na regresje po przemianowaniu tabeli =='
-- STAN OBECNY, ZMIERZONY: prosba ekspercka NIE przecina obszarow roboczych.
--
-- Odpowiedz na pytanie audytu („czy prosba ekspercka ma przecinac obszary
-- robocze") brzmi: NIE, i zywe polityki tego pilnuja. To nie jest defekt.
-- `src/lib/ci/__tests__/chatPolicyContract.test.ts` asertuje ten sam
-- niezmiennik statycznie (kazda polityka `expert_inmails` inna niz INSERT
-- wiaze `tenant_id = current_tenant_id()`, a INSERT ma `WITH CHECK (false)`)
-- i osobnym testem przypina DUCHY, ktore zostaja w mapie `extractLatestPolicies`
-- po RENAME, ktorego statyczny parser nie umie odtworzyc:
--
--   20260723090707  CREATE TABLE public.expert_inmails  + polityki „inmails: …"
--   20260723180000  RENAME expert_inmails -> expert_requests
--                   + polityki „expert_requests: …" (BEZ tenanta) - to sa
--                     te, ktore zostaja duchami pod kluczem `expert_requests`
--   20260806160001  RENAME Z POWROTEM -> expert_inmails; komentarz w pliku:
--                   „na produkcji tabela nazywa sie expert_inmails, rename
--                    nigdy nie wjechal"
--   20260806185055  DROP wszystkich szesciu starych nazw polityk (obu rodzin)
--                   + polityki „expert_inmails: …" Z `tenant_id = current_tenant_id()`
--
-- Polityki podrozuja z tabela, wiec po powrocie nazwy stan koncowy siedzi na
-- `expert_inmails`. `extractLatestPolicies` kluczuje po nazwie tabeli
-- WYCZYTANEJ Z TEKSTU, wiec DROP-y z 20260806185055 (`ON public.expert_inmails`)
-- nie trafiaja w klucze zalozone jako `ON public.expert_requests` - i stara
-- rodzina zostaje w jej mapie jako duch.
--
-- KIEDY TE ASERCJE MAJA PASC. Gdyby ktos przywrocil nazwe `expert_requests`
-- razem z jej tenant-slepymi politykami, asercja o niewidocznosci wiersza
-- dryfujacego padnie natychmiast. To jest dokladnie ta pulapka, o ktora
-- prosil audyt - tyle ze zastawiona na regresje, a nie na obecny stan.
DO $$
DECLARE
  jan   uuid := 'a0000000-0000-0000-0000-0000000000a1';
  zofia uuid := 'c0000000-0000-0000-0000-0000000000c1';
  basia uuid := 'b0000000-0000-0000-0000-0000000000b1';
BEGIN
  PERFORM pg_temp.assert(
    pg_temp.write_error_as(jan,
      'INSERT INTO public.expert_inmails (tenant_id, sender_id, recipient_id, subject, reason) VALUES ('
      || '''11111111-1111-1111-1111-111111111111'', ''' || jan || ''', ''' || zofia || ''', '
      || '''Prosba z pominieciem RPC'', ''Tresc dluga na ponad dwadziescia znakow.'')')
      LIKE '%permission denied%',
    'ZAMEK 1: `authenticated` nie ma prawa INSERT na prosbie eksperckiej');

  PERFORM pg_temp.assert(
    pg_temp.count_as(jan,
      'SELECT 1 FROM public.expert_inmails WHERE id = ''9e000000-0000-0000-0000-000000000001''') = 1,
    'nadawca widzi swoja prosbe ekspercka we wlasnym obszarze roboczym');
  PERFORM pg_temp.assert(
    pg_temp.count_as(zofia,
      'SELECT 1 FROM public.expert_inmails WHERE id = ''9e000000-0000-0000-0000-000000000001''') = 1,
    'odbiorca widzi skierowana do niego prosbe ekspercka');
  PERFORM pg_temp.assert(
    pg_temp.count_as(basia, 'SELECT 1 FROM public.expert_inmails') = 0,
    'osoba postronna z obcego obszaru roboczego nie widzi zadnej prosby');

  -- SEDNO PULAPKI. Wiersz ma tego samego nadawce i tego samego odbiorce,
  -- a lezy w obcym obszarze roboczym - tenant-slepa polityka pokazalaby go.
  PERFORM pg_temp.assert(
    pg_temp.count_as(jan,
      'SELECT 1 FROM public.expert_inmails WHERE id = ''9e000000-0000-0000-0000-000000000002''') = 0,
    'STAN OBECNY: prosba dryfujaca do obcego obszaru roboczego jest NIEWIDOCZNA takze dla nadawcy');
  PERFORM pg_temp.assert(
    NOT pg_temp.write_as(jan,
      'UPDATE public.expert_inmails SET status = ''cancelled'' WHERE id = ''9e000000-0000-0000-0000-000000000002'''),
    'STAN OBECNY: prosby dryfujacej nie da sie takze zmienic spoza jej obszaru roboczego');
END $$;

GRANT INSERT ON public.expert_inmails TO authenticated;
DO $$
DECLARE
  jan   uuid := 'a0000000-0000-0000-0000-0000000000a1';
  zofia uuid := 'c0000000-0000-0000-0000-0000000000c1';
BEGIN
  PERFORM pg_temp.assert(
    pg_temp.write_error_as(jan,
      'INSERT INTO public.expert_inmails (tenant_id, sender_id, recipient_id, subject, reason) VALUES ('
      || '''11111111-1111-1111-1111-111111111111'', ''' || jan || ''', ''' || zofia || ''', '
      || '''Prosba z pominieciem RPC'', ''Tresc dluga na ponad dwadziescia znakow.'')')
      LIKE '%row-level security%',
    'ZAMEK 2: nawet z prawem INSERT zapis odbija sie o WITH CHECK (false) - jedyna droga to RPC');
END $$;
REVOKE INSERT ON public.expert_inmails FROM authenticated;

\echo '== podsumowanie =='
DO $$
BEGIN
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('media_mentions', 'saved_searches', 'user_follows',
                          'subscriptions', 'membership_grants', 'organization_seats',
                          'user_purchases', 'user_subscriptions', 'post_gift_links',
                          'user_read_history', 'personality_result_history')
        AND (qual LIKE '%auth.uid()%' OR with_check LIKE '%auth.uid()%')
        AND coalesce(qual, '') NOT LIKE '%current_tenant_id()%'
        AND coalesce(with_check, '') NOT LIKE '%current_tenant_id()%'
        AND policyname NOT LIKE '%staff%') = 0,
    'zadna polityka wlascicielska tych tabel nie zostala bez tenanta');

  -- Plaszczyzna czatu, ten sam inwariant liczony na STANIE BAZY, a nie na
  -- tekscie migracji - dlatego rename `expert_inmails` niczego tu nie myli.
  -- Wyjatek `with_check = 'false'`: polityka „no direct insert" nie ma czego
  -- zawezac, bo nie przepuszcza NICZEGO.
  PERFORM pg_temp.assert(
    (SELECT coalesce(string_agg(tablename || '::' || policyname, ', '), '') FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('conversations', 'conversation_participants', 'conversation_nicknames',
                          'messages', 'message_reactions', 'message_stars',
                          'user_blocks', 'expert_inmails')
        AND coalesce(with_check, '') NOT IN ('false', '(false)')
        AND coalesce(qual, '') NOT LIKE '%tenant_id%'
        AND coalesce(with_check, '') NOT LIKE '%tenant_id%') = '',
    'kazda polityka plaszczyzny czatu wiaze tenanta (poza `no direct insert`, ktora nie przepuszcza nic)');

  -- Kanaly realtime sa POZA ta atrapa - i ma to byc widoczne, a nie milczace.
  -- Gdyby ktos je tu dolozyl bez schematu `realtime`, ta asercja padnie
  -- i kaze najpierw dopisac otoczenie, a dopiero potem asercje.
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM pg_namespace WHERE nspname = 'realtime') = 0,
    'ZAKRES: atrapa nie ma schematu `realtime` - polityki kanalow nie sa tu dowodzone');
END $$;
