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

-- ---------------------------------------------------------------------------
-- Fixture: dwa tenanty, dwaj uzytkownicy, wiersze wlasne i „dryfujace"
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000a1', 'user-a@t'),
  ('b0000000-0000-0000-0000-0000000000b1', 'user-b@t');

INSERT INTO public.profiles (id, tenant_id, display_name) VALUES
  ('a0000000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'User A'),
  ('b0000000-0000-0000-0000-0000000000b1', '22222222-2222-2222-2222-222222222222', 'User B');

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
END $$;
