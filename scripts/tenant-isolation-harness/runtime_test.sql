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

\echo '== podsumowanie =='
DO $$
BEGIN
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('media_mentions', 'saved_searches', 'user_follows')
        AND (qual LIKE '%auth.uid()%' OR with_check LIKE '%auth.uid()%')
        AND coalesce(qual, '') NOT LIKE '%current_tenant_id()%'
        AND coalesce(with_check, '') NOT LIKE '%current_tenant_id()%'
        AND policyname NOT LIKE '%staff%') = 0,
    'zadna polityka wlascicielska tych tabel nie zostala bez tenanta');
END $$;
