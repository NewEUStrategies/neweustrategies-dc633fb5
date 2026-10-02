-- pgTAP: linki do profilu osoby - slug i trasa z bazy (migracja 20261002100000).
--
-- FINDING. Trzy karty linkowały osobę, podając trasie IDENTYFIKATOR w miejscu
-- sluga: wprowadzenia (`/people/<uuid>`), rekomendacje na hubie i "Kto oglądał
-- Twój profil" (`/author/<uuid>`). `get_member_profile` szuka wyłącznie po
-- slugu, a przekierowanie nie-autora z /author na /people
-- (`member_slug_is_non_author`) też porównuje wyłącznie slug - zwykły członek
-- kończył na hubie autora albo, po F5, na trwałym 404.
--
-- Ten plik przypina KONTRAKT, na którym stoją karty: para (slug, trasa) jest
-- niepusta wyłącznie wtedy, gdy ta trasa POKAŻE wołającemu TĘ osobę:
--   'author' - hub otwiera się po slugu, także bez sesji (F5), i nie
--              przekierowuje na /people;
--   'people' - `get_member_profile(slug)` zwraca tę osobę.
-- Asercje parytetu pytają same funkcje tras, a nie kopię ich warunków.
--
-- Najemca fikstury to `public_tenant_id()` bez nagłówka hosta (domyślny) -
-- gałąź anonimowa `profiles_public` i hub patrzą na tenant żądania.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(29);

ALTER TABLE auth.users DISABLE TRIGGER USER;

CREATE TEMP TABLE plr_ctx AS SELECT public.public_tenant_id() AS home;
CREATE TEMP TABLE plr_who (k text PRIMARY KEY, id uuid, slug text);
INSERT INTO plr_who VALUES
  ('R', 'f7000000-0000-0000-0000-0000000000a0', 'plr-owner'),
  ('A', 'f7000000-0000-0000-0000-0000000000a1', 'plr-author'),
  ('H', 'f7000000-0000-0000-0000-0000000000a2', 'plr-invited-author'),
  ('B', 'f7000000-0000-0000-0000-0000000000a3', 'plr-discoverable'),
  ('C', 'f7000000-0000-0000-0000-0000000000a4', 'plr-connected'),
  ('D', 'f7000000-0000-0000-0000-0000000000a5', 'plr-badge'),
  ('E', 'f7000000-0000-0000-0000-0000000000a6', NULL),
  ('W', 'f7000000-0000-0000-0000-0000000000a7', '   '),
  ('F', 'f7000000-0000-0000-0000-0000000000a8', 'plr-anonymous'),
  ('V', 'f7000000-0000-0000-0000-0000000000b1', 'plr-viewer');
GRANT SELECT ON plr_ctx, plr_who TO anon, authenticated;

INSERT INTO auth.users (id, email) SELECT id, lower(k) || '@plr.test' FROM plr_who;

-- R  właściciel profilu (odbiorca rekomendacji, oglądany), połączony z C;
-- A  autor z rolą w tenancie = publiczna obecność (hub otwiera się bez sesji);
-- H  autor WYŁĄCZNIE z przyjętego zaproszenia: bez roli w tenancie, więc bez
--    publicznej obecności - hub po F5 dałby 404; discoverable, więc /people;
-- B  nie-autor discoverable;  C  nie-autor ukryty, połączony z R;
-- D  nie-autor z odznaką eksperta (publiczna obecność), ukryty: /author/<slug>
--    po F5 przekierowuje na /people, które go nie rozwiąże;
-- E  autor zapisany BEZ sluga, W discoverable z PUSTYM slugiem - od
--    20261002110000 wyzwalacz nadaje obu slug z nazwy ("plr-e", "plr-w"),
--    wiec link jest, a nie znika;
-- F  discoverable, przegląda w trybie anonimowym;  V  zwykły członek.
INSERT INTO public.profiles (id, email, display_name, slug, tenant_id, discoverable, profile_view_mode)
SELECT w.id, lower(w.k) || '@plr.test', 'PLR ' || w.k, w.slug, (SELECT home FROM plr_ctx),
       w.k IN ('H', 'B', 'W', 'F'),
       CASE WHEN w.k = 'F' THEN 'anonymous' ELSE 'public' END
  FROM plr_who w;

INSERT INTO public.user_roles (user_id, role, tenant_id)
SELECT id, 'author'::public.app_role, (SELECT home FROM plr_ctx)
  FROM plr_who WHERE k IN ('A', 'E');
INSERT INTO public.user_invitations (tenant_id, email, role, status, auth_user_id, accepted_at)
SELECT (SELECT home FROM plr_ctx), 'h@plr.test', 'author'::public.app_role,
       'accepted'::public.invitation_status, id, now()
  FROM plr_who WHERE k = 'H';
INSERT INTO public.profile_badges (tenant_id, user_id, badge)
SELECT (SELECT home FROM plr_ctx), id, 'expert' FROM plr_who WHERE k = 'D';

-- Relacja tą samą drogą, co aplikacja: 'pending', potem 'accepted'.
INSERT INTO public.user_connections (requester_id, addressee_id)
SELECT (SELECT id FROM plr_who WHERE k = 'C'), (SELECT id FROM plr_who WHERE k = 'R');
UPDATE public.user_connections SET status = 'accepted', responded_at = now()
 WHERE requester_id = (SELECT id FROM plr_who WHERE k = 'C');

INSERT INTO public.profile_recommendations (tenant_id, recipient_id, author_id, relationship, body, status)
SELECT (SELECT home FROM plr_ctx), (SELECT id FROM plr_who WHERE k = 'R'), w.id, 'colleague',
       'Rekomendacja testowa wystarczajaco dluga dla CHECK tresci.', 'published'
  FROM plr_who w WHERE w.k IN ('A', 'H', 'B', 'C', 'D', 'E', 'W');

-- Odsłony profilu R: każdy widz woła RPC jak aplikacja (tryb z jego profilu).
SET LOCAL ROLE authenticated;
DO $$
DECLARE v uuid;
BEGIN
  FOR v IN SELECT id FROM plr_who WHERE k IN ('A', 'H', 'B', 'C', 'D', 'W', 'F') LOOP
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v, 'role', 'authenticated')::text, true);
    PERFORM public.record_profile_view((SELECT id FROM plr_who WHERE k = 'R'));
  END LOOP;
END $$;
RESET ROLE;

-- Para (slug, trasa) rekomendacji autorstwa osoby k, z perspektywy wołającego.
CREATE FUNCTION pg_temp.plr_rec(p_k text) RETURNS text[] LANGUAGE sql AS $$
  SELECT ARRAY[l.author_slug, l.author_route]
    FROM public.list_recommendations((SELECT id FROM plr_who WHERE k = 'R')) l
   WHERE l.author_id = (SELECT id FROM plr_who WHERE k = p_k) $$;
-- To samo dla listy widzów R (wołający = R).
CREATE FUNCTION pg_temp.plr_view(p_k text) RETURNS text[] LANGUAGE sql AS $$
  SELECT ARRAY[v.viewer_slug, v.viewer_route]
    FROM public.my_profile_viewers(100) v
   WHERE v.viewer_id = (SELECT id FROM plr_who WHERE k = p_k) $$;
-- Czy trasa naprawdę pokaże tę osobę - pytamy SAME funkcje tras. SECURITY
-- DEFINER, bo Postgres sprawdza EXECUTE dla każdej funkcji w wyrażeniu, także
-- w niewykonanej gałęzi CASE (anon nie ma `get_member_profile`); tożsamość
-- wołającego i tak idzie z `request.jwt.claims`, nie z roli.
CREATE FUNCTION pg_temp.plr_route_ok(p_route text, p_slug text, p_id uuid) RETURNS boolean
LANGUAGE sql SECURITY DEFINER AS $$
  SELECT CASE p_route
    WHEN 'author' THEN public.get_expert_hub(p_slug) -> 'profile' ->> 'id' = p_id::text
                   AND NOT public.member_slug_is_non_author(p_slug)
                   AND public.profile_has_public_presence(p_id, (SELECT home FROM plr_ctx))
    WHEN 'people' THEN public.get_member_profile(p_slug) ->> 'id' = p_id::text
    ELSE false END $$;
-- [ile wierszy z trasą, ile z nich NIE pokaże osoby] - pierwsza liczba pilnuje,
-- żeby zero w drugiej nie było puste.
CREATE FUNCTION pg_temp.plr_rec_parity() RETURNS int[] LANGUAGE sql AS $$
  SELECT ARRAY[count(*) FILTER (WHERE l.author_route IS NOT NULL),
               count(*) FILTER (WHERE l.author_route IS NOT NULL
                                  AND NOT pg_temp.plr_route_ok(l.author_route, l.author_slug, l.author_id))
                        + count(*) FILTER (WHERE (l.author_route IS NULL) <> (l.author_slug IS NULL))]::int[]
    FROM public.list_recommendations((SELECT id FROM plr_who WHERE k = 'R')) l $$;
GRANT EXECUTE ON FUNCTION pg_temp.plr_rec(text), pg_temp.plr_view(text),
  pg_temp.plr_route_ok(text, text, uuid), pg_temp.plr_rec_parity() TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Kontrakt funkcji (1-7)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT is(pg_get_function_result('public.list_recommendations(uuid)'::regprocedure),
  'TABLE(id uuid, author_id uuid, author_name text, author_avatar text, author_headline text, relationship text, body text, status text, created_at timestamp with time zone, author_slug text, author_route text)',
  'list_recommendations: dotychczasowe kolumny bez zmian + author_slug, author_route na końcu');
SELECT is(pg_get_function_result('public.my_profile_viewers(integer)'::regprocedure),
  'TABLE(viewed_at timestamp with time zone, viewer_mode text, viewer_id uuid, display_name text, avatar_url text, job_title text, company text, viewer_slug text, viewer_route text)',
  'my_profile_viewers: dotychczasowe kolumny bez zmian + viewer_slug, viewer_route na końcu');
SELECT is(pg_get_function_result('public.my_introduction_requests(text)'::regprocedure),
  'TABLE(id uuid, requester_id uuid, requester_name text, requester_avatar text, target_id uuid, target_name text, target_avatar text, bridge_id uuid, bridge_name text, bridge_avatar text, message text, status text, created_at timestamp with time zone, requester_slug text, requester_route text, target_slug text, target_route text, bridge_slug text, bridge_route text)',
  'my_introduction_requests: dotychczasowe kolumny bez zmian + pary slug/trasa na końcu');
SELECT is(
  (SELECT count(*)::int FROM pg_proc
    WHERE oid IN ('public._profile_link_route(uuid)'::regprocedure,
                  'public.my_introduction_requests(text)'::regprocedure,
                  'public.list_recommendations(uuid)'::regprocedure,
                  'public.my_profile_viewers(integer)'::regprocedure)
      AND prosecdef AND proconfig = ARRAY['search_path=public, pg_temp']),
  4,
  'cztery funkcje: SECURITY DEFINER z search_path = public, pg_temp (DROP + CREATE gubi proconfig)');
SELECT ok(
  NOT has_function_privilege('anon', 'public._profile_link_route(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._profile_link_route(uuid)', 'EXECUTE'),
  'acl: helper trasy nie jest wołalny z API - wołają go wyłącznie funkcje SECURITY DEFINER');
SELECT ok(has_function_privilege('anon', 'public.list_recommendations(uuid)', 'EXECUTE'),
  'acl: anon zachowuje list_recommendations (sekcja na publicznym hubie)');
SELECT ok(NOT has_function_privilege('anon', 'public.my_profile_viewers(integer)', 'EXECUTE'),
  'acl: anon nie wykonuje my_profile_viewers');

-- ═══════════════════════════════════════════════════════════════════════════
-- Rekomendacje - gość na publicznym hubie (8-11)
-- ═══════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SELECT is(pg_temp.plr_rec('A'), ARRAY['plr-author', 'author'],
  'gość: autor z publicznym hubem -> /author/<slug>');
SELECT is(pg_temp.plr_rec('D'), ARRAY[NULL, NULL]::text[],
  'gość: nie-autor z odznaką -> bez linku (/author przekierowałby na bramkę /people)');
SELECT is(
  (SELECT count(*)::int FROM public.list_recommendations((SELECT id FROM plr_who WHERE k = 'R')) l
    WHERE l.author_id IN (SELECT id FROM plr_who WHERE k IN ('H', 'B', 'C', 'W'))
      AND (l.author_slug IS NOT NULL OR l.author_route IS NOT NULL)),
  0,
  'gość: nikt bez publicznego huba nie dostaje linku (gość nie otworzy /people)');
SELECT is(pg_temp.plr_rec_parity(), ARRAY[2, 0],
  'gość: każda zwrócona trasa naprawdę pokazuje tę osobę');

-- ═══════════════════════════════════════════════════════════════════════════
-- Rekomendacje - zalogowany członek bez połączeń (12-17)
-- ═══════════════════════════════════════════════════════════════════════════
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  format('{"sub":"%s","role":"authenticated"}', (SELECT id FROM plr_who WHERE k = 'V')), true);
SELECT is(pg_temp.plr_rec('A'), ARRAY['plr-author', 'author'],
  'członek: autor z publicznym hubem -> /author/<slug>');
SELECT is(pg_temp.plr_rec('B'), ARRAY['plr-discoverable', 'people'],
  'członek: nie-autor discoverable -> /people/<slug>');
SELECT is(pg_temp.plr_rec('H'), ARRAY['plr-invited-author', 'people'],
  'członek: autor BEZ publicznej obecności -> /people (hub po F5 dałby 404)');
SELECT is(pg_temp.plr_rec('C'), ARRAY[NULL, NULL]::text[],
  'członek: ukryty, niepołączony -> bez linku');
SELECT is(pg_temp.plr_rec('D'), ARRAY[NULL, NULL]::text[],
  'członek: nie-autor z odznaką, którego /people nie rozwiąże -> bez linku');
SELECT is(pg_temp.plr_rec_parity(), ARRAY[5, 0],
  'członek: każda zwrócona trasa naprawdę pokazuje tę osobę');

-- ═══════════════════════════════════════════════════════════════════════════
-- Rekomendacje - właściciel profilu, połączony z C (18-21)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT set_config('request.jwt.claims',
  format('{"sub":"%s","role":"authenticated"}', (SELECT id FROM plr_who WHERE k = 'R')), true);
SELECT is(pg_temp.plr_rec('C'), ARRAY['plr-connected', 'people'],
  'właściciel: połączony autor rekomendacji -> /people/<slug>');
SELECT is(
  (SELECT array_agg(l.author_slug || ':' || l.author_route ORDER BY l.author_slug)
     FROM public.list_recommendations((SELECT id FROM plr_who WHERE k = 'R')) l
    WHERE l.author_id IN (SELECT id FROM plr_who WHERE k IN ('E', 'W'))),
  ARRAY['plr-e:author', 'plr-w:people'],
  'właściciel: zapis bez sluga / z pustym slugiem -> slug z nazwy (20261002110000), nigdy id');
SELECT is(pg_temp.plr_rec_parity(), ARRAY[6, 0],
  'właściciel: każda zwrócona trasa naprawdę pokazuje tę osobę');
SELECT ok(NOT EXISTS (
    SELECT 1 FROM public.list_recommendations((SELECT id FROM plr_who WHERE k = 'R')) l
     WHERE l.author_slug = l.author_id::text),
  'author_slug nigdy nie jest UUID-em');

-- ═══════════════════════════════════════════════════════════════════════════
-- Kto oglądał profil R - wołający R (22-29)
-- ═══════════════════════════════════════════════════════════════════════════
SELECT is(pg_temp.plr_view('A'), ARRAY['plr-author', 'author'],
  'widzowie: autor z publicznym hubem -> /author/<slug> (dotąd /author/<uuid>)');
SELECT is(pg_temp.plr_view('B'), ARRAY['plr-discoverable', 'people'],
  'widzowie: nie-autor discoverable -> /people/<slug>');
SELECT is(pg_temp.plr_view('C'), ARRAY['plr-connected', 'people'],
  'widzowie: połączony widz -> /people/<slug>');
SELECT is(pg_temp.plr_view('H'), ARRAY['plr-invited-author', 'people'],
  'widzowie: autor bez publicznej obecności -> /people, nie /author');
SELECT is(pg_temp.plr_view('D'), ARRAY[NULL, NULL]::text[],
  'widzowie: nie-autor z odznaką, którego /people nie rozwiąże -> bez linku');
SELECT is(pg_temp.plr_view('W'), ARRAY['plr-w', 'people'],
  'widzowie: zapis z pustym slugiem -> slug z nazwy i link na /people');
SELECT is(
  (SELECT ARRAY[count(*),
                count(*) FILTER (WHERE v.viewer_id IS NOT NULL OR v.viewer_slug IS NOT NULL
                                    OR v.viewer_route IS NOT NULL)]::int[]
     FROM public.my_profile_viewers(100) v
    WHERE v.viewer_mode <> 'public'),
  ARRAY[1, 0],
  'widzowie: wiersz anonimowy nie niesie id, sluga ani trasy (slug pod tym samym warunkiem co tożsamość)');
SELECT is(
  (SELECT ARRAY[count(*) FILTER (WHERE v.viewer_route IS NOT NULL),
                count(*) FILTER (WHERE v.viewer_route IS NOT NULL
                                   AND NOT pg_temp.plr_route_ok(v.viewer_route, v.viewer_slug, v.viewer_id))
                + count(*) FILTER (WHERE (v.viewer_route IS NULL) <> (v.viewer_slug IS NULL))]::int[]
     FROM public.my_profile_viewers(100) v),
  ARRAY[5, 0],
  'widzowie: każda zwrócona trasa naprawdę pokazuje tę osobę');

SELECT * FROM finish();
ROLLBACK;
