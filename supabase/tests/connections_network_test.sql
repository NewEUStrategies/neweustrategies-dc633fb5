-- pgTAP: sieć kontaktów (user_connections, 20260717123000).
--
-- Weryfikowane wlasnosci:
--   1. Dostep: anon bez EXECUTE, authenticated bez SELECT na tabeli (RPC-only).
--   2. Zaproszenie: pending_out/pending_in, notka, powiadomienie 'connection',
--      licznik connections_pending, idempotencja ponownego zaproszenia.
--   3. Zakazy: self-invite, cross-tenant, adresat niewidoczny (discoverable).
--   4. Akceptacja: status connected po obu stronach, licznik wraca do zera,
--      powiadomienie dla zapraszajacego, my_connections/my_network_counts.
--   5. Prywatnosc odmowy: zapraszajacy dalej widzi pending_out i pozycje
--      w wyslanych; odmawiajacy nie widzi zadnej relacji; brak powiadomienia.
--   6. Krzyzujaca sie intencja: odmawiajacy sam zaprasza -> auto-akceptacja.
--   7. Blokada: zrywa relacje i uniemozliwia nowe zaproszenie.
--   8. Preferencje: enabled_connection=false wycisza powiadomienie, ale
--      licznik i recompute dzialaja; wycofanie zaproszenia zeruje licznik.
--   9. Sugestie: wspolny kontakt podbija mutual_count, polaczeni odpadaja.
--  10. Guardy: rate limit 30/24h, nielegalne przejscie statusu, pinowanie
--      tenant_id przy INSERT.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(45);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('ca111111-1111-1111-1111-111111111111', 'tenant-cn1', 'Tenant CN1'),
  ('ca222222-2222-2222-2222-222222222222', 'tenant-cn2', 'Tenant CN2');

INSERT INTO auth.users (id, email) VALUES
  ('ca000000-0000-0000-0000-0000000000aa', 'a@cn.test'),
  ('ca000000-0000-0000-0000-0000000000bb', 'b@cn.test'),
  ('ca000000-0000-0000-0000-0000000000cc', 'c@cn.test'),
  ('ca000000-0000-0000-0000-0000000000dd', 'd@cn.test'),
  ('ca000000-0000-0000-0000-0000000000ee', 'e@cn.test'),
  ('ca000000-0000-0000-0000-0000000000ff', 'f@cn.test'),
  ('ca000000-0000-0000-0000-0000000000e1', 'x@cn.test'),
  ('ca000000-0000-0000-0000-0000000000e2', 'y@cn.test');

INSERT INTO public.profiles
  (id, email, display_name, tenant_id, discoverable, current_company)
VALUES
  ('ca000000-0000-0000-0000-0000000000aa', 'a@cn.test', 'Ala CN',
   'ca111111-1111-1111-1111-111111111111', true, 'EU Institute'),
  ('ca000000-0000-0000-0000-0000000000bb', 'b@cn.test', 'Bartek CN',
   'ca111111-1111-1111-1111-111111111111', true, 'EU Institute'),
  ('ca000000-0000-0000-0000-0000000000cc', 'c@cn.test', 'Celina CN',
   'ca111111-1111-1111-1111-111111111111', false, NULL),
  ('ca000000-0000-0000-0000-0000000000dd', 'd@cn.test', 'Darek CN',
   'ca222222-2222-2222-2222-222222222222', true, NULL),
  ('ca000000-0000-0000-0000-0000000000ee', 'e@cn.test', 'Ewa CN',
   'ca111111-1111-1111-1111-111111111111', true, NULL),
  ('ca000000-0000-0000-0000-0000000000ff', 'f@cn.test', 'Filip CN',
   'ca111111-1111-1111-1111-111111111111', true, NULL),
  ('ca000000-0000-0000-0000-0000000000e1', 'x@cn.test', 'Xawery CN',
   'ca111111-1111-1111-1111-111111111111', true, 'Trade Lab'),
  ('ca000000-0000-0000-0000-0000000000e2', 'y@cn.test', 'Yga CN',
   'ca111111-1111-1111-1111-111111111111', true, NULL);

-- ---------------------------------------------------------------------------
-- 1-2. Powierzchnia dostepu: RPC tylko dla authenticated, tabela dla nikogo
-- ---------------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT throws_like(
  $$SELECT public.connection_request('ca000000-0000-0000-0000-0000000000bb')$$,
  '%permission denied%',
  'anon nie moze wolac connection_request (REVOKE)'
);
RESET ROLE;

SELECT ok(
  has_function_privilege('authenticated',
    'public.connection_request(uuid, text)', 'EXECUTE')
  AND has_function_privilege('authenticated',
    'public.my_connections(text, integer, integer)', 'EXECUTE'),
  'authenticated ma EXECUTE na RPC sieci kontaktow'
);

-- ---------------------------------------------------------------------------
-- 3-10. Zaproszenie A -> B (claims ustawiane bez zmiany roli: RPC sa SECURITY
--      DEFINER, wiec zachowanie jest identyczne, a asercje moga czytac tabele)
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT ok(
  public.connection_request(
    'ca000000-0000-0000-0000-0000000000bb', 'Dzien dobry z Brukseli') IS NOT NULL,
  'connection_request zwraca id zaproszenia'
);

SELECT is(
  (SELECT cs.status FROM public.connection_statuses(
     ARRAY['ca000000-0000-0000-0000-0000000000bb'::uuid]) cs),
  'pending_out',
  'zapraszajacy widzi pending_out'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT is(
  (SELECT cs.status FROM public.connection_statuses(
     ARRAY['ca000000-0000-0000-0000-0000000000aa'::uuid]) cs),
  'pending_in',
  'adresat widzi pending_in'
);

SELECT is(
  (SELECT r.message FROM public.my_connection_requests('in') r
    WHERE r.user_id = 'ca000000-0000-0000-0000-0000000000aa'),
  'Dzien dobry z Brukseli',
  'skrzynka odbiorcza pokazuje notke zaproszenia'
);

SELECT is(
  (SELECT c.value FROM public.user_pending_counters c
    WHERE c.user_id = 'ca000000-0000-0000-0000-0000000000bb'
      AND c.counter_key = 'connections_pending'),
  1,
  'licznik connections_pending adresata = 1'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = 'ca000000-0000-0000-0000-0000000000bb'
      AND n.kind = 'connection'),
  1,
  'adresat dostal powiadomienie rodzaju connection'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT is(
  public.connection_request('ca000000-0000-0000-0000-0000000000bb'),
  (SELECT c.id FROM public.user_connections c
    WHERE c.requester_id = 'ca000000-0000-0000-0000-0000000000aa'
      AND c.addressee_id = 'ca000000-0000-0000-0000-0000000000bb'),
  'ponowne zaproszenie jest idempotentne (to samo id)'
);

SELECT throws_like(
  $$SELECT public.connection_request('ca000000-0000-0000-0000-0000000000aa')$$,
  '%invalid peer%',
  'nie mozna zaprosic samego siebie'
);

-- ---------------------------------------------------------------------------
-- 11-12. Izolacja tenanta + wymog widocznosci adresata
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-0000-0000-0000000000dd","role":"authenticated"}', true);

SELECT throws_like(
  $$SELECT public.connection_request('ca000000-0000-0000-0000-0000000000bb')$$,
  '%peer not available%',
  'zaproszenie cross-tenant jest odrzucane'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT throws_like(
  $$SELECT public.connection_request('ca000000-0000-0000-0000-0000000000cc')$$,
  '%peer not available%',
  'adresat z wylaczona widocznoscia nie dostaje swiezych zaproszen'
);

-- ---------------------------------------------------------------------------
-- 13-19. Akceptacja przez adresata
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT lives_ok(
  $$SELECT public.connection_respond(
      (SELECT r.connection_id FROM public.my_connection_requests('in') r
        WHERE r.user_id = 'ca000000-0000-0000-0000-0000000000aa'),
      true)$$,
  'adresat akceptuje zaproszenie'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT is(
  (SELECT cs.status FROM public.connection_statuses(
     ARRAY['ca000000-0000-0000-0000-0000000000bb'::uuid]) cs),
  'connected',
  'po akceptacji obie strony maja status connected'
);

SELECT is(
  (SELECT c.value FROM public.user_pending_counters c
    WHERE c.user_id = 'ca000000-0000-0000-0000-0000000000bb'
      AND c.counter_key = 'connections_pending'),
  0,
  'licznik adresata wraca do zera po odpowiedzi'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = 'ca000000-0000-0000-0000-0000000000aa'
      AND n.kind = 'connection'),
  1,
  'zapraszajacy dostal powiadomienie o akceptacji'
);

SELECT is(
  (SELECT mc.display_name FROM public.my_connections('') mc),
  'Bartek CN',
  'my_connections zwraca nowego czlonka sieci'
);

SELECT is(
  (SELECT nc.connections::int FROM public.my_network_counts() nc),
  1,
  'my_network_counts liczy zaakceptowane polaczenia'
);

SET LOCAL ROLE authenticated;
SELECT throws_like(
  $$SELECT count(*) FROM public.user_connections$$,
  '%permission denied%',
  'authenticated nie czyta user_connections bezposrednio (RPC-only)'
);
RESET ROLE;

-- ---------------------------------------------------------------------------
-- 20-26. Usuniecie polaczenia + prywatnosc odmowy
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT lives_ok(
  $$SELECT public.connection_remove('ca000000-0000-0000-0000-0000000000bb')$$,
  'usuniecie polaczenia dziala dla kazdej ze stron'
);

SELECT is(
  (SELECT count(*)::int FROM public.my_connections('')),
  0,
  'po usunieciu siec jest pusta'
);

SELECT ok(
  public.connection_request('ca000000-0000-0000-0000-0000000000bb') IS NOT NULL,
  'po usunieciu mozna zaprosic ponownie (swiezy wiersz pending)'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT lives_ok(
  $$SELECT public.connection_respond(
      (SELECT r.connection_id FROM public.my_connection_requests('in') r
        WHERE r.user_id = 'ca000000-0000-0000-0000-0000000000aa'),
      false)$$,
  'adresat odrzuca zaproszenie'
);

SELECT is(
  (SELECT count(*)::int FROM public.connection_statuses(
     ARRAY['ca000000-0000-0000-0000-0000000000aa'::uuid])),
  0,
  'odmawiajacy nie widzi po odmowie zadnej relacji'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT is(
  (SELECT cs.status FROM public.connection_statuses(
     ARRAY['ca000000-0000-0000-0000-0000000000bb'::uuid]) cs),
  'pending_out',
  'odmowa jest niewidoczna: zapraszajacy dalej widzi pending_out'
);

SELECT is(
  (SELECT count(*)::int FROM public.my_connection_requests('out') r
    WHERE r.user_id = 'ca000000-0000-0000-0000-0000000000bb'),
  1,
  'odrzucone zaproszenie wciaz figuruje w wyslanych'
);

-- ---------------------------------------------------------------------------
-- 27-30. Krzyzujaca sie intencja + blokada zrywa relacje
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

-- Dwie osobne asercje: wywolanie RPC musi sie wykonac PRZED odczytem statusu
-- (w jednym wyrazeniu porzadek ewaluacji nie jest gwarantowany).
SELECT ok(
  public.connection_request('ca000000-0000-0000-0000-0000000000aa') IS NOT NULL,
  'odmawiajacy moze sam wyslac zaproszenie'
);

SELECT is(
  (SELECT c.status FROM public.user_connections c
    WHERE c.requester_id = 'ca000000-0000-0000-0000-0000000000aa'
      AND c.addressee_id = 'ca000000-0000-0000-0000-0000000000bb'),
  'accepted',
  'zaproszenie od odmawiajacego = obopolna intencja -> auto-akceptacja'
);

-- A blokuje B: relacja znika w dowolnym statusie.
INSERT INTO public.user_blocks (blocker_id, blocked_id, tenant_id) VALUES
  ('ca000000-0000-0000-0000-0000000000aa',
   'ca000000-0000-0000-0000-0000000000bb',
   'ca111111-1111-1111-1111-111111111111');

SELECT is(
  (SELECT count(*)::int FROM public.user_connections c
    WHERE c.requester_id IN ('ca000000-0000-0000-0000-0000000000aa',
                             'ca000000-0000-0000-0000-0000000000bb')
      AND c.addressee_id IN ('ca000000-0000-0000-0000-0000000000aa',
                             'ca000000-0000-0000-0000-0000000000bb')),
  0,
  'blokada zrywa istniejace polaczenie'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT throws_like(
  $$SELECT public.connection_request('ca000000-0000-0000-0000-0000000000bb')$$,
  '%blocked%',
  'nie mozna zaprosic osoby w blokadzie (dowolny kierunek)'
);

-- ---------------------------------------------------------------------------
-- 31-36. Preferencje powiadomien + liczniki + wycofanie zaproszenia
-- ---------------------------------------------------------------------------
INSERT INTO public.notification_preferences (user_id, enabled_connection)
VALUES ('ca000000-0000-0000-0000-0000000000ff', false);

SELECT set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-0000-0000-0000000000ee","role":"authenticated"}', true);

SELECT ok(
  public.connection_request('ca000000-0000-0000-0000-0000000000ff') IS NOT NULL,
  'zaproszenie E -> F przechodzi'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = 'ca000000-0000-0000-0000-0000000000ff'
      AND n.kind = 'connection'),
  0,
  'enabled_connection=false wycisza powiadomienie o zaproszeniu'
);

SELECT is(
  (SELECT c.value FROM public.user_pending_counters c
    WHERE c.user_id = 'ca000000-0000-0000-0000-0000000000ff'
      AND c.counter_key = 'connections_pending'),
  1,
  'licznik dziala niezaleznie od preferencji powiadomien'
);

SELECT recompute_user_pending_counters('ca000000-0000-0000-0000-0000000000ff');
SELECT is(
  (SELECT c.value FROM public.user_pending_counters c
    WHERE c.user_id = 'ca000000-0000-0000-0000-0000000000ff'
      AND c.counter_key = 'connections_pending'),
  1,
  'recompute_user_pending_counters liczy connections_pending'
);

SELECT lives_ok(
  $$SELECT public.connection_cancel(
      (SELECT c.id FROM public.user_connections c
        WHERE c.requester_id = 'ca000000-0000-0000-0000-0000000000ee'
          AND c.addressee_id = 'ca000000-0000-0000-0000-0000000000ff'))$$,
  'zapraszajacy moze wycofac zaproszenie'
);

SELECT is(
  (SELECT c.value FROM public.user_pending_counters c
    WHERE c.user_id = 'ca000000-0000-0000-0000-0000000000ff'
      AND c.counter_key = 'connections_pending'),
  0,
  'wycofanie zaproszenia zeruje licznik adresata'
);

-- ---------------------------------------------------------------------------
-- 37-38. Sugestie: wspolny kontakt (A-Y, X-Y) -> X sugerowany dla A
-- ---------------------------------------------------------------------------
INSERT INTO public.user_connections (tenant_id, requester_id, addressee_id) VALUES
  ('ca111111-1111-1111-1111-111111111111',
   'ca000000-0000-0000-0000-0000000000e2',   -- Y -> A
   'ca000000-0000-0000-0000-0000000000aa'),
  ('ca111111-1111-1111-1111-111111111111',
   'ca000000-0000-0000-0000-0000000000e1',   -- X -> Y
   'ca000000-0000-0000-0000-0000000000e2');
UPDATE public.user_connections SET status = 'accepted'
 WHERE requester_id IN ('ca000000-0000-0000-0000-0000000000e2',
                        'ca000000-0000-0000-0000-0000000000e1');

SELECT set_config('request.jwt.claims',
  '{"sub":"ca000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT is(
  (SELECT s.mutual_count::int FROM public.connection_suggestions(24) s
    WHERE s.user_id = 'ca000000-0000-0000-0000-0000000000e1'),
  1,
  'sugestie: wspolny kontakt daje mutual_count = 1'
);

SELECT is(
  (SELECT count(*)::int FROM public.connection_suggestions(24) s
    WHERE s.user_id = 'ca000000-0000-0000-0000-0000000000e2'),
  0,
  'sugestie pomijaja osoby juz polaczone'
);

-- ---------------------------------------------------------------------------
-- 39. Rate limit: 30 zaproszen / 24h
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  i int;
  v_uid uuid;
BEGIN
  FOR i IN 1..30 LOOP
    v_uid := ('ca000000-0000-0000-0000-' || lpad((100 + i)::text, 12, '0'))::uuid;
    INSERT INTO auth.users (id, email) VALUES (v_uid, 'seed' || i || '@cn.test');
    INSERT INTO public.profiles (id, email, display_name, tenant_id, discoverable)
    VALUES (v_uid, 'seed' || i || '@cn.test', 'Seed ' || i,
            'ca111111-1111-1111-1111-111111111111', true);
    INSERT INTO public.user_connections (tenant_id, requester_id, addressee_id)
    VALUES ('ca111111-1111-1111-1111-111111111111',
            'ca000000-0000-0000-0000-0000000000aa', v_uid);
  END LOOP;
END $$;

SELECT throws_like(
  $$SELECT public.connection_request('ca000000-0000-0000-0000-0000000000e1')$$,
  '%rate limited%',
  'rate limit: 31. zaproszenie w 24h jest odrzucane'
);

-- ---------------------------------------------------------------------------
-- 40-41. Guard: nielegalne przejscie statusu + pinowanie tenant_id
-- ---------------------------------------------------------------------------
SELECT throws_like(
  $$UPDATE public.user_connections SET status = 'pending'
     WHERE requester_id = 'ca000000-0000-0000-0000-0000000000e2'
       AND addressee_id = 'ca000000-0000-0000-0000-0000000000aa'$$,
  '%illegal status transition%',
  'guard odrzuca przejscie accepted -> pending'
);

INSERT INTO public.user_connections (tenant_id, requester_id, addressee_id)
VALUES ('ca222222-2222-2222-2222-222222222222',    -- zly tenant w INSERT
        'ca000000-0000-0000-0000-0000000000ee',
        'ca000000-0000-0000-0000-0000000000e1');
SELECT is(
  (SELECT c.tenant_id FROM public.user_connections c
    WHERE c.requester_id = 'ca000000-0000-0000-0000-0000000000ee'
      AND c.addressee_id = 'ca000000-0000-0000-0000-0000000000e1'),
  'ca111111-1111-1111-1111-111111111111',
  'tenant_id jest pinowany do tenanta zapraszajacego'
);

-- ---------------------------------------------------------------------------
-- 42-45. Konstrukcja tabeli: RLS wlaczone, brak polityk, indeks pary
-- ---------------------------------------------------------------------------
SELECT ok(
  (SELECT relrowsecurity FROM pg_class
    WHERE oid = 'public.user_connections'::regclass),
  'RLS na user_connections jest wlaczone (deny-all bez polityk)'
);

SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_connections'),
  0,
  'user_connections nie ma polityk RLS (dostep wylacznie przez RPC)'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.user_connections', 'SELECT'),
  'authenticated nie ma grantu SELECT na user_connections'
);

SELECT throws_like(
  $$INSERT INTO public.user_connections (tenant_id, requester_id, addressee_id)
    VALUES ('ca111111-1111-1111-1111-111111111111',
            'ca000000-0000-0000-0000-0000000000ee',
            'ca000000-0000-0000-0000-0000000000e1')$$,
  '%duplicate key%',
  'unikalny indeks pary blokuje duplikat relacji'
);

SELECT * FROM finish();
ROLLBACK;
