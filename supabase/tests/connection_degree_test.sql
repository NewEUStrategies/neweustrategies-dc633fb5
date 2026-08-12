-- pgTAP: STOPIEN ODDALENIA w sieci kontaktow (migracja 20260807100000).
--
-- Luka #6 audytu: drugi stopien byl LICZONY wewnatrz connection_suggestions
-- (agregat `mutual`) i nigdzie nie wychodzil - klient nie dostawal ani
-- etykiety „2°", ani mostu („Ty -> Anna -> Marek"). Trzeci stopien nie istnial
-- w ogole. Ten plik przybija kontrakt, ktory to domyka.
--
-- Weryfikowane wlasnosci:
--   1. Semantyka dystansu na grafie ZAAKCEPTOWANYCH relacji: 1 (polaczeni),
--      2 (wspolny kontakt), 3 (kontakt kontaktu mojego kontaktu), 0 (dalej
--      albo brak drogi). Zaproszenie w toku NIE robi 1. stopnia.
--   2. Most = MOJ kontakt 1. stopnia. Przy 1. stopniu mostu nie ma (nie ma
--      czego mostkowac), przy 3. stopniu most to WEJSCIE do mojej sieci,
--      a srodkowy wezel pozostaje nieujawniony (nie ma go w zwrotce).
--   3. Prywatnosc mostu: nazwiemy go WYLACZNIE, gdy ma opt-in `discoverable`
--      (ta sama zasada, co lista wspolnych kontaktow). Sam DYSTANS jest od
--      tego niezalezny - inaczej „2°" znikaloby wybiorczo.
--   4. connection_suggestions zwraca ten sam stopien i ten sam most, a trzeci
--      stopien dokłada punkt w rankingu, ale NIE przebija wspolnego kontaktu.
--   5. Granice: obcy tenant poza zasiegiem, anon bez wierszy i bez EXECUTE.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(24);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('cd111111-1111-1111-1111-111111111111', 'tenant-cd1', 'Tenant CD1'),
  ('cd222222-2222-2222-2222-222222222222', 'tenant-cd2', 'Tenant CD2');

INSERT INTO auth.users (id, email) VALUES
  ('cd000000-0000-0000-0000-0000000000aa', 'a@cd.test'),
  ('cd000000-0000-0000-0000-0000000000bb', 'b@cd.test'),
  ('cd000000-0000-0000-0000-0000000000cc', 'c@cd.test'),
  ('cd000000-0000-0000-0000-0000000000dd', 'd@cd.test'),
  ('cd000000-0000-0000-0000-0000000000ee', 'e@cd.test'),
  ('cd000000-0000-0000-0000-0000000000ff', 'f@cd.test'),
  ('cd000000-0000-0000-0000-000000000099', 'h@cd.test'),
  ('cd000000-0000-0000-0000-000000000088', 'i@cd.test'),
  ('cd000000-0000-0000-0000-000000000077', 'z@cd.test');

-- H celowo BEZ `discoverable`: to most, ktorego nie wolno nam nazwac.
INSERT INTO public.profiles (id, email, display_name, tenant_id, discoverable) VALUES
  ('cd000000-0000-0000-0000-0000000000aa', 'a@cd.test', 'Ala CD',
   'cd111111-1111-1111-1111-111111111111', true),
  ('cd000000-0000-0000-0000-0000000000bb', 'b@cd.test', 'Bartek CD',
   'cd111111-1111-1111-1111-111111111111', true),
  ('cd000000-0000-0000-0000-0000000000cc', 'c@cd.test', 'Celina CD',
   'cd111111-1111-1111-1111-111111111111', true),
  ('cd000000-0000-0000-0000-0000000000dd', 'd@cd.test', 'Dorota CD',
   'cd111111-1111-1111-1111-111111111111', true),
  ('cd000000-0000-0000-0000-0000000000ee', 'e@cd.test', 'Ewa CD',
   'cd111111-1111-1111-1111-111111111111', true),
  ('cd000000-0000-0000-0000-0000000000ff', 'f@cd.test', 'Filip CD',
   'cd111111-1111-1111-1111-111111111111', true),
  ('cd000000-0000-0000-0000-000000000099', 'h@cd.test', 'Halina CD',
   'cd111111-1111-1111-1111-111111111111', false),
  ('cd000000-0000-0000-0000-000000000088', 'i@cd.test', 'Iwo CD',
   'cd111111-1111-1111-1111-111111111111', true),
  ('cd000000-0000-0000-0000-000000000077', 'z@cd.test', 'Zenon CD',
   'cd222222-2222-2222-2222-222222222222', true);

-- Lancuch: A-B (1°), B-C (C = 2°), C-D (D = 3°), D-E (E = 4° -> poza zasiegiem).
-- Osobno: A-H (most ukryty), H-I (I = 2° z mostem, ktorego nie nazwiemy).
-- Filip zostaje bez zadnej krawedzi - kontrola „brak drogi".
-- Guard `tg_user_connections_guard` dopuszcza wylacznie INSERT w stanie
-- 'pending' i przejscie pending->accepted, wiec fikstura idzie ta sama droga,
-- co aplikacja. `responded_at` zostaje jawne: kolejnosc mostow sortuje sie po
-- „od kiedy sie znamy" (`sp.via_since`), wiec now() zrobiloby remis.
INSERT INTO public.user_connections
  (tenant_id, requester_id, addressee_id) VALUES
  ('cd111111-1111-1111-1111-111111111111',
   'cd000000-0000-0000-0000-0000000000aa', 'cd000000-0000-0000-0000-0000000000bb'),
  ('cd111111-1111-1111-1111-111111111111',
   'cd000000-0000-0000-0000-0000000000bb', 'cd000000-0000-0000-0000-0000000000cc'),
  ('cd111111-1111-1111-1111-111111111111',
   'cd000000-0000-0000-0000-0000000000cc', 'cd000000-0000-0000-0000-0000000000dd'),
  ('cd111111-1111-1111-1111-111111111111',
   'cd000000-0000-0000-0000-0000000000dd', 'cd000000-0000-0000-0000-0000000000ee'),
  ('cd111111-1111-1111-1111-111111111111',
   'cd000000-0000-0000-0000-0000000000aa', 'cd000000-0000-0000-0000-000000000099'),
  ('cd111111-1111-1111-1111-111111111111',
   'cd000000-0000-0000-0000-000000000099', 'cd000000-0000-0000-0000-000000000088');

UPDATE public.user_connections c
   SET status = 'accepted', responded_at = v.responded_at
  FROM (VALUES
    ('cd000000-0000-0000-0000-0000000000aa'::uuid,
     'cd000000-0000-0000-0000-0000000000bb'::uuid, '2026-01-01T10:00:00Z'::timestamptz),
    ('cd000000-0000-0000-0000-0000000000bb'::uuid,
     'cd000000-0000-0000-0000-0000000000cc'::uuid, '2026-01-02T10:00:00Z'::timestamptz),
    ('cd000000-0000-0000-0000-0000000000cc'::uuid,
     'cd000000-0000-0000-0000-0000000000dd'::uuid, '2026-01-03T10:00:00Z'::timestamptz),
    ('cd000000-0000-0000-0000-0000000000dd'::uuid,
     'cd000000-0000-0000-0000-0000000000ee'::uuid, '2026-01-04T10:00:00Z'::timestamptz),
    ('cd000000-0000-0000-0000-0000000000aa'::uuid,
     'cd000000-0000-0000-0000-000000000099'::uuid, '2026-01-05T10:00:00Z'::timestamptz),
    ('cd000000-0000-0000-0000-000000000099'::uuid,
     'cd000000-0000-0000-0000-000000000088'::uuid, '2026-01-06T10:00:00Z'::timestamptz)
  ) AS v(requester_id, addressee_id, responded_at)
 WHERE c.requester_id = v.requester_id
   AND c.addressee_id = v.addressee_id;

SELECT set_config('request.jwt.claims',
  '{"sub":"cd000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

-- ---------------------------------------------------------------------------
-- 1-3. Pierwszy stopien: polaczeni, bez mostu
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT cs.degree FROM public.connection_statuses(
     ARRAY['cd000000-0000-0000-0000-0000000000bb'::uuid]) cs),
  1::smallint,
  'polaczenie daje 1. stopien'
);

SELECT ok(
  (SELECT cs.bridge_id IS NULL FROM public.connection_statuses(
     ARRAY['cd000000-0000-0000-0000-0000000000bb'::uuid]) cs),
  '1. stopien nie ma mostu - nie ma czego mostkowac'
);

SELECT is(
  (SELECT cs.status FROM public.connection_statuses(
     ARRAY['cd000000-0000-0000-0000-0000000000bb'::uuid]) cs),
  'connected',
  'stopien nie rozjezdza sie ze statusem relacji'
);

-- ---------------------------------------------------------------------------
-- 4-6. Drugi stopien: wspolny kontakt jest mostem i jest NAZWANY
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT cs.degree FROM public.connection_statuses(
     ARRAY['cd000000-0000-0000-0000-0000000000cc'::uuid]) cs),
  2::smallint,
  'wspolny kontakt daje 2. stopien'
);

SELECT is(
  (SELECT cs.bridge_id FROM public.connection_statuses(
     ARRAY['cd000000-0000-0000-0000-0000000000cc'::uuid]) cs),
  'cd000000-0000-0000-0000-0000000000bb'::uuid,
  'most 2. stopnia to moj kontakt 1. stopnia'
);

SELECT is(
  (SELECT cs.bridge_name FROM public.connection_statuses(
     ARRAY['cd000000-0000-0000-0000-0000000000cc'::uuid]) cs),
  'Bartek CD',
  'most przychodzi z nazwa - inaczej sciezki nie da sie narysowac'
);

-- ---------------------------------------------------------------------------
-- 7-9. Trzeci stopien: droga istnieje, most to WEJSCIE do mojej sieci,
--      srodkowy wezel pozostaje nieujawniony
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT cs.degree FROM public.connection_statuses(
     ARRAY['cd000000-0000-0000-0000-0000000000dd'::uuid]) cs),
  3::smallint,
  'kontakt kontaktu mojego kontaktu to 3. stopien'
);

SELECT is(
  (SELECT cs.bridge_id FROM public.connection_statuses(
     ARRAY['cd000000-0000-0000-0000-0000000000dd'::uuid]) cs),
  'cd000000-0000-0000-0000-0000000000bb'::uuid,
  'most 3. stopnia to moj kontakt, nie osoba posrednia'
);

SELECT is(
  (SELECT cs.mutual_count FROM public.connection_statuses(
     ARRAY['cd000000-0000-0000-0000-0000000000dd'::uuid]) cs),
  0::bigint,
  '3. stopien nie ma wspolnych kontaktow - to go odroznia od 2.'
);

-- ---------------------------------------------------------------------------
-- 10-11. Poza zasiegiem: czwarty przeskok i brak jakiejkolwiek drogi
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT cs.degree FROM public.connection_statuses(
     ARRAY['cd000000-0000-0000-0000-0000000000ee'::uuid]) cs),
  0::smallint,
  'czwarty przeskok to juz poza zasiegiem (0), a nie „3+"'
);

SELECT is(
  (SELECT cs.degree FROM public.connection_statuses(
     ARRAY['cd000000-0000-0000-0000-0000000000ff'::uuid]) cs),
  0::smallint,
  'brak krawedzi to brak stopnia'
);

-- ---------------------------------------------------------------------------
-- 12-13. Prywatnosc mostu: dystans niezalezny od `discoverable`, nazwa - nie
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT cs.degree FROM public.connection_statuses(
     ARRAY['cd000000-0000-0000-0000-000000000088'::uuid]) cs),
  2::smallint,
  'ukryty most nie kasuje dystansu - 2. stopien zostaje'
);

SELECT ok(
  (SELECT cs.bridge_id IS NULL AND cs.bridge_name IS NULL
     FROM public.connection_statuses(
       ARRAY['cd000000-0000-0000-0000-000000000088'::uuid]) cs),
  'mostu bez opt-inu `discoverable` nie nazywamy'
);

-- ---------------------------------------------------------------------------
-- 14-15. Zaproszenie w toku nie jest stopniem (graf relacji, nie intencji)
-- ---------------------------------------------------------------------------
SELECT public.connection_request('cd000000-0000-0000-0000-0000000000ff');

SELECT is(
  (SELECT cs.status FROM public.connection_statuses(
     ARRAY['cd000000-0000-0000-0000-0000000000ff'::uuid]) cs),
  'pending_out',
  'wyslane zaproszenie widac w statusie'
);

SELECT is(
  (SELECT cs.degree FROM public.connection_statuses(
     ARRAY['cd000000-0000-0000-0000-0000000000ff'::uuid]) cs),
  0::smallint,
  'wyslane zaproszenie NIE robi 1. stopnia'
);

-- ---------------------------------------------------------------------------
-- 16. Obcy tenant: poza zasiegiem niezaleznie od grafu
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT cs.degree FROM public.connection_statuses(
     ARRAY['cd000000-0000-0000-0000-000000000077'::uuid]) cs),
  0::smallint,
  'profil z obcego tenanta jest poza zasiegiem sieci'
);

-- ---------------------------------------------------------------------------
-- 17-21. connection_suggestions: ten sam stopien, ten sam most, ranking
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT s.degree FROM public.connection_suggestions(24) s
    WHERE s.user_id = 'cd000000-0000-0000-0000-0000000000cc'),
  2::smallint,
  'sugestia mowi, ze to 2. stopien (a nie liczy go po cichu)'
);

SELECT is(
  (SELECT s.bridge_name FROM public.connection_suggestions(24) s
    WHERE s.user_id = 'cd000000-0000-0000-0000-0000000000cc'),
  'Bartek CD',
  'sugestia niesie most - „przez kogo", nie tylko „ile"'
);

SELECT is(
  (SELECT s.degree FROM public.connection_suggestions(24) s
    WHERE s.user_id = 'cd000000-0000-0000-0000-0000000000dd'),
  3::smallint,
  'sugestia rozpoznaje 3. stopien'
);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.connection_suggestions(24) s
               WHERE s.user_id = 'cd000000-0000-0000-0000-0000000000bb'),
  'osoba z istniejaca relacja nie wraca w sugestiach'
);

-- Ranking: wspolny kontakt (Celina, 2°) przed samym 3. stopniem (Dorota).
SELECT ok(
  (SELECT array_position(
            array_agg(s.user_id ORDER BY s.ord),
            'cd000000-0000-0000-0000-0000000000cc'::uuid)
          <
          array_position(
            array_agg(s.user_id ORDER BY s.ord),
            'cd000000-0000-0000-0000-0000000000dd'::uuid)
     FROM (SELECT user_id, row_number() OVER () AS ord
             FROM public.connection_suggestions(24)) s),
  '3. stopien dokłada punkt, ale nie przebija wspolnego kontaktu'
);

-- ---------------------------------------------------------------------------
-- 22-24. Anon: zero wierszy i zero EXECUTE
-- ---------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '', true);

SELECT is(
  (SELECT count(*) FROM public.connection_statuses(
     ARRAY['cd000000-0000-0000-0000-0000000000bb'::uuid])),
  0::bigint,
  'anon nie dostaje zadnego wiersza stopnia'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.connection_statuses(uuid[])', 'EXECUTE'),
  'anon bez EXECUTE na connection_statuses'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.connection_suggestions(integer)', 'EXECUTE'),
  'anon bez EXECUTE na connection_suggestions'
);

SELECT * FROM finish();
ROLLBACK;
