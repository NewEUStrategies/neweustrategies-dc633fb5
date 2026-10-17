-- ============================================================================
-- pgTAP: listy klubów - `club_list`, `club_list_by_specialization`,
-- `club_specializations_public` (licznik) i `club_activity_feed`
-- (migracja 20261017130000, bliźniak drizzle 0298).
--
-- Co przybija:
--   * WYCIEK z 20260811110015: club_list_by_specialization nie miała bramki
--     klubu 'secret', więc każdy zalogowany z tenantu listował sekrety danej
--     specjalizacji (id, nazwa, tagline, okładka), a club_count na kaflu je
--     liczył. Bramka = ta z club_list: public/members/private albo
--     club_capabilities.can_read (aktywny członek, administracja, sztab NES).
--   * A13 (20260808150000) cofnięte przez 20260919220300 (cover_position_y):
--     strona max 200 wierszy i club_capabilities() liczone dla zwracanej
--     strony, nie dla każdego klubu tenantu przed LIMIT. Koszt mierzy
--     licznik wywołań club_capabilities (atrapa w transakcji, sekcja 7) -
--     wynik listy tego nie pokazuje.
--   * Metadane zdjęte przez DROP w 20260919220300: REVOKE ... FROM PUBLIC,
--     GRANT anon/authenticated/service_role i COMMENT na club_list,
--     club_list_by_specialization i club_activity_feed.
--   * Niezmienniki, które zostają: anonim tylko public+active, zalogowany
--     także members/private, członkostwo na początku listy, sztab NES widzi
--     sekret (semantyka cap.can_read z 0028), obcy tenant nic, strumień A15
--     bez zmian, sygnatury RETURNS TABLE bez zmian.
--
-- Każdy aktor dostaje JEDNĄ asercję na zbiór widocznych slugów fixture'a
-- (`is()` drukuje have/want), więc regresja mówi, CO wyciekło. Wywołania idą
-- z rolą anon/authenticated (`set local role`) i tożsamością w
-- `request.jwt.claims`; anonim wskazuje tenant nagłówkiem `x-tenant-host`.
-- Sekcja 7 (limit, sklejanie stron, pomiar wywołań club_capabilities) biegnie
-- jako właściciel z tożsamością w claims: referencje czytają tabele wprost,
-- a licznik podmienia funkcję, czego wolno tylko jej właścicielowi.
--
-- Bliźniak wykonywany bez pgTAP: scripts/pg-harness/runtime_test.sql, sekcja
-- A13R (`bun run check:pg-harness`).
-- ============================================================================
BEGIN;
SELECT plan(25);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, name, slug, domain)
VALUES ('cc1a0000-0000-0000-0000-00000000000a', 'Club List A', 'club-list-a', 'club-list-a.example'),
       ('cc1b0000-0000-0000-0000-00000000000b', 'Club List B', 'club-list-b', 'club-list-b.example');

INSERT INTO auth.users (id, email)
VALUES ('cc100000-0000-0000-0000-000000000001', 'cl-admin-a@test.local'),
       ('cc100000-0000-0000-0000-000000000002', 'cl-outsider@test.local'),
       ('cc100000-0000-0000-0000-000000000003', 'cl-secret-member@test.local'),
       ('cc100000-0000-0000-0000-000000000004', 'cl-editor@test.local'),
       ('cc100000-0000-0000-0000-0000000000b1', 'cl-admin-b@test.local');

INSERT INTO public.profiles (id, tenant_id, display_name, discoverable)
VALUES ('cc100000-0000-0000-0000-000000000001', 'cc1a0000-0000-0000-0000-00000000000a', 'CL Admin A', true),
       ('cc100000-0000-0000-0000-000000000002', 'cc1a0000-0000-0000-0000-00000000000a', 'CL Outsider', true),
       ('cc100000-0000-0000-0000-000000000003', 'cc1a0000-0000-0000-0000-00000000000a', 'CL Secret member', true),
       ('cc100000-0000-0000-0000-000000000004', 'cc1a0000-0000-0000-0000-00000000000a', 'CL Editor', true),
       ('cc100000-0000-0000-0000-0000000000b1', 'cc1b0000-0000-0000-0000-00000000000b', 'CL Admin B', true);

-- Redaktor = sztab NES (is_nes_staff), więc club_capabilities daje mu can_read
-- także w sekrecie - ta semantyka list zostaje z 0028.
INSERT INTO public.user_roles (user_id, role, tenant_id)
VALUES ('cc100000-0000-0000-0000-000000000001', 'admin', 'cc1a0000-0000-0000-0000-00000000000a'),
       ('cc100000-0000-0000-0000-000000000004', 'editor', 'cc1a0000-0000-0000-0000-00000000000a'),
       ('cc100000-0000-0000-0000-0000000000b1', 'admin', 'cc1b0000-0000-0000-0000-00000000000b');

INSERT INTO public.club_specializations (tenant_id, slug, key, label_pl, label_en, sort_order)
VALUES ('cc1a0000-0000-0000-0000-00000000000a', 'clv-spec', 'clvspec', 'Lista spec', 'List spec', 900);

-- Kluby tenantu A zakłada jego admin (realna ścieżka: `admin_club_upsert`
-- bierze tenanta z sesji), klub tenantu B - admin B.
SELECT set_config('request.jwt.claims', '{"sub":"cc100000-0000-0000-0000-000000000001"}', true);
SELECT public.admin_club_upsert(c.payload::jsonb)
  FROM (VALUES
    ('{"slug":"clv-public","name_pl":"CLV public","name_en":"CLV public","visibility":"public","status":"active","specialization_slug":"clv-spec"}'),
    ('{"slug":"clv-members","name_pl":"CLV members","name_en":"CLV members","visibility":"members","status":"active","specialization_slug":"clv-spec"}'),
    ('{"slug":"clv-private","name_pl":"CLV private","name_en":"CLV private","visibility":"private","status":"active","specialization_slug":"clv-spec"}'),
    ('{"slug":"clv-secret","name_pl":"CLV secret","name_en":"CLV secret","visibility":"secret","status":"active","specialization_slug":"clv-spec"}'),
    ('{"slug":"clv-draft","name_pl":"CLV draft","name_en":"CLV draft","visibility":"public","status":"draft","specialization_slug":"clv-spec"}'),
    ('{"slug":"clv-inna","name_pl":"CLV inna","name_en":"CLV other","visibility":"public","status":"active","specialization_slug":"clv-inna"}')
  ) AS c(payload);

SELECT public.admin_club_member_upsert(cl.id, 'cc100000-0000-0000-0000-000000000003', 'member', 'active', NULL)
  FROM public.clubs cl
 WHERE cl.slug = 'clv-secret' AND cl.tenant_id = 'cc1a0000-0000-0000-0000-00000000000a';

-- Wątki dla strumienia: w klubie publicznym i w sekrecie (grupa domyślna).
SELECT public.admin_club_thread_create(g.id, t.title, 'Treść tematu, dłuższa niż dziesięć znaków.', NULL, 'discussion', false)
  FROM (VALUES ('clv-public', 'Temat klubu publicznego'), ('clv-secret', 'Temat sekretu')) AS t(club_slug, title)
  JOIN public.clubs cl ON cl.slug = t.club_slug AND cl.tenant_id = 'cc1a0000-0000-0000-0000-00000000000a'
  JOIN LATERAL (SELECT g.id FROM public.club_groups g WHERE g.club_id = cl.id ORDER BY g.created_at LIMIT 1) g ON true;

SELECT set_config('request.jwt.claims', '{"sub":"cc100000-0000-0000-0000-0000000000b1"}', true);
SELECT public.admin_club_upsert(
  '{"slug":"clv-obcy","name_pl":"CLV obcy","name_en":"CLV foreign","visibility":"public","status":"active","specialization_slug":"clv-spec"}'::jsonb);
SELECT set_config('request.jwt.claims', '', true);

-- ----------------------------------------------------------------------------
-- 1. Struktura: sygnatury bez zmian, granty i komentarze wróciły
-- ----------------------------------------------------------------------------
SELECT is(
  pg_get_function_result('public.club_list(integer,integer)'::regprocedure),
  'TABLE(id uuid, slug text, name_pl text, name_en text, tagline_pl text, tagline_en text, icon text, accent_color text, cover_image_url text, cover_position_y smallint, visibility text, join_policy text, min_tier_rank integer, policy_area text, status text, member_count integer, group_count integer, thread_count integer, last_activity_at timestamp with time zone, my_role text, my_status text, can_read boolean, total_count bigint)',
  'RETURNS TABLE club_list bez zmian względem 20260919220300');
SELECT is(
  pg_get_function_result('public.club_list_by_specialization(text,integer,integer)'::regprocedure),
  'TABLE(id uuid, slug text, name_pl text, name_en text, tagline_pl text, tagline_en text, icon text, accent_color text, cover_image_url text, cover_position_y smallint, visibility text, join_policy text, min_tier_rank integer, policy_area text, specialization_slug text, status text, member_count integer, group_count integer, thread_count integer, last_activity_at timestamp with time zone, my_role text, my_status text, can_read boolean, total_count bigint)',
  'RETURNS TABLE club_list_by_specialization bez zmian względem 20260919220300');
SELECT is(
  pg_get_function_result('public.club_activity_feed(integer,text,text,integer)'::regprocedure),
  'TABLE(thread_id uuid, thread_slug text, title text, kind text, status text, excerpt text, club_id uuid, club_slug text, club_name_pl text, club_name_en text, club_policy_area text, club_cover_image_url text, club_cover_position_y smallint, group_name_pl text, group_name_en text, is_anonymous boolean, author_name text, author_alias text, reply_count integer, participant_count integer, last_reply_at timestamp with time zone, created_at timestamp with time zone)',
  'RETURNS TABLE club_activity_feed bez zmian względem 20260919220300');

SELECT is(
  (SELECT COALESCE(string_agg(f.name, ',' ORDER BY f.name), '-')
     FROM (VALUES ('club_activity_feed', 'public.club_activity_feed(integer,text,text,integer)'::regprocedure),
                  ('club_list', 'public.club_list(integer,integer)'::regprocedure),
                  ('club_list_by_specialization', 'public.club_list_by_specialization(text,integer,integer)'::regprocedure),
                  ('club_specializations_public', 'public.club_specializations_public()'::regprocedure)) f(name, oid)
     JOIN pg_proc p ON p.oid = f.oid
    WHERE p.proacl IS NULL
       OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')),
  '-',
  'PUBLIC nie wykonuje żadnej z czterech list (REVOKE zdjęty przez DROP w 20260919220300 wrócił)');
SELECT ok(
  (SELECT bool_and(has_function_privilege(r, f.oid, 'EXECUTE'))
     FROM (VALUES ('public.club_activity_feed(integer,text,text,integer)'::regprocedure),
                  ('public.club_list(integer,integer)'::regprocedure),
                  ('public.club_list_by_specialization(text,integer,integer)'::regprocedure),
                  ('public.club_specializations_public()'::regprocedure)) f(oid)
    CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) r),
  'anon, authenticated i service_role wykonają wszystkie cztery listy (powierzchnia publiczna)');
SELECT is(
  (SELECT COALESCE(string_agg(f.name, ',' ORDER BY f.name), '-')
     FROM (VALUES ('club_activity_feed', 'public.club_activity_feed(integer,text,text,integer)'::regprocedure),
                  ('club_list', 'public.club_list(integer,integer)'::regprocedure),
                  ('club_list_by_specialization', 'public.club_list_by_specialization(text,integer,integer)'::regprocedure),
                  ('club_specializations_public', 'public.club_specializations_public()'::regprocedure)) f(name, oid)
    WHERE obj_description(f.oid::oid, 'pg_proc') IS NULL),
  '-',
  'każda z czterech list ma COMMENT');

-- ----------------------------------------------------------------------------
-- 2. Anonim na domenie tenantu A: wyłącznie public+active
-- ----------------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.headers', '{"x-tenant-host":"club-list-a.example"}', true);
SELECT is(
  (SELECT COALESCE(string_agg(slug, ',' ORDER BY slug), '-')
     FROM public.club_list_by_specialization('clv-spec', 200, 0) WHERE slug LIKE 'clv-%'),
  'clv-public',
  'anonim widzi w specjalizacji wyłącznie klub public+active');
SELECT is(
  (SELECT COALESCE(string_agg(slug, ',' ORDER BY slug), '-')
     FROM public.club_list(200, 0) WHERE slug LIKE 'clv-%'),
  'clv-inna,clv-public',
  'anonim widzi w club_list wyłącznie kluby public+active');
SELECT is(
  (SELECT club_count FROM public.club_specializations_public() WHERE slug = 'clv-spec'),
  1,
  'licznik specjalizacji anonima = 1 (tylko klub publiczny)');
RESET ROLE;
SELECT set_config('request.headers', '', true);

-- ----------------------------------------------------------------------------
-- 3. Zalogowany spoza klubu: members/private tak, sekret NIE (wyciek z 20260811110015)
-- ----------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"cc100000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT is(
  (SELECT COALESCE(string_agg(slug, ',' ORDER BY slug), '-')
     FROM public.club_list_by_specialization('clv-spec', 200, 0) WHERE slug LIKE 'clv-%'),
  'clv-members,clv-private,clv-public',
  'zalogowany spoza klubu NIE listuje sekretu specjalizacji (KRYTYCZNE)');
SELECT is(
  (SELECT club_count FROM public.club_specializations_public() WHERE slug = 'clv-spec'),
  3,
  'licznik specjalizacji zalogowanego spoza klubu nie liczy sekretu');
SELECT is(
  (SELECT COALESCE(string_agg(slug, ',' ORDER BY slug), '-')
     FROM public.club_list(200, 0) WHERE slug LIKE 'clv-%'),
  'clv-inna,clv-members,clv-private,clv-public',
  'club_list zalogowanego spoza klubu: bez sekretu i szkicu');
RESET ROLE;

-- ----------------------------------------------------------------------------
-- 4. Członek sekretu: lista, licznik i pierwszy wiersz club_list
-- ----------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"cc100000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT is(
  (SELECT COALESCE(string_agg(slug || ':' || can_read::text, ',' ORDER BY slug), '-')
     FROM public.club_list_by_specialization('clv-spec', 200, 0) WHERE slug LIKE 'clv-%'),
  'clv-members:true,clv-private:false,clv-public:true,clv-secret:true',
  'członek sekretu listuje go z can_read (private dalej bez treści)');
SELECT is(
  (SELECT club_count FROM public.club_specializations_public() WHERE slug = 'clv-spec'),
  4,
  'licznik specjalizacji członka sekretu liczy jego sekret');
SELECT is(
  (SELECT slug FROM public.club_list(200, 0) LIMIT 1),
  'clv-secret',
  'członkostwo na początku club_list (klucz sortowania A13)');
RESET ROLE;

-- ----------------------------------------------------------------------------
-- 5. Sztab NES widzi sekret; admin obcego tenantu nic - także z cudzym hostem
-- ----------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"cc100000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT is(
  (SELECT COALESCE(string_agg(slug, ',' ORDER BY slug), '-')
     FROM public.club_list_by_specialization('clv-spec', 200, 0) WHERE slug LIKE 'clv-%'),
  'clv-members,clv-private,clv-public,clv-secret',
  'sztab NES (redaktor) widzi sekret - can_read z club_capabilities, jak w 0028');
SELECT set_config('request.jwt.claims', '{"sub":"cc100000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SELECT set_config('request.headers', '{"x-tenant-host":"club-list-a.example"}', true);
SELECT is(
  (SELECT COALESCE(string_agg(slug, ',' ORDER BY slug), '-')
     FROM public.club_list_by_specialization('clv-spec', 200, 0) WHERE slug LIKE 'clv-%'),
  'clv-obcy',
  'admin tenantu B widzi wyłącznie swój tenant, podmieniony x-tenant-host niczego nie otwiera');
RESET ROLE;
SELECT set_config('request.headers', '', true);

-- ----------------------------------------------------------------------------
-- 6. club_activity_feed: ciało A15 bez zmian
-- ----------------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.headers', '{"x-tenant-host":"club-list-a.example"}', true);
SELECT is(
  (SELECT COALESCE(string_agg(DISTINCT club_slug, ',' ORDER BY club_slug), '-')
     FROM public.club_activity_feed(30, 'new', NULL, 10) WHERE club_slug LIKE 'clv-%'),
  'clv-public',
  'anonim widzi w strumieniu wyłącznie wątki klubu publicznego');
RESET ROLE;
SELECT set_config('request.headers', '', true);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"cc100000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT is(
  (SELECT COALESCE(string_agg(DISTINCT club_slug, ',' ORDER BY club_slug), '-')
     FROM public.club_activity_feed(30, 'new', NULL, 10) WHERE club_slug LIKE 'clv-%'),
  'clv-public',
  'zalogowany spoza klubu nie dostaje wątku sekretu w strumieniu');
SELECT set_config('request.jwt.claims', '{"sub":"cc100000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT is(
  (SELECT COALESCE(string_agg(DISTINCT club_slug, ',' ORDER BY club_slug), '-')
     FROM public.club_activity_feed(30, 'new', NULL, 10) WHERE club_slug LIKE 'clv-%'),
  'clv-public,clv-secret',
  'członek sekretu dostaje jego wątek w strumieniu');
RESET ROLE;

-- ----------------------------------------------------------------------------
-- 7. Limit strony 200 i zdolności liczone tylko dla strony (A13)
-- ----------------------------------------------------------------------------
-- Ponad 200 klubów jednym INSERT-em zamiast dwustu wywołań admin_club_upsert.
INSERT INTO public.clubs (tenant_id, slug, name_pl, name_en, visibility, status, specialization_slug)
SELECT 'cc1a0000-0000-0000-0000-00000000000a', format('clv-bulk-%s', lpad(i::text, 3, '0')),
       format('CLV bulk %s', lpad(i::text, 3, '0')), format('CLV bulk %s', i), 'public', 'active', 'clv-bulk'
  FROM generate_series(1, 205) i;

-- Ta sekcja biegnie jako WŁAŚCICIEL z tożsamością obcego w claims: referencje
-- czytają clubs/club_members wprost (pod rolą authenticated RLS by je
-- przyciął), a licznik niżej zmienia nazwę club_capabilities, czego wolno
-- tylko właścicielowi. Granty ról przybija sekcja 1, a role
-- anon/authenticated - sekcje 2-6.
SELECT set_config('request.jwt.claims', '{"sub":"cc100000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int || '/' || max(total_count) FROM public.club_list(10000, 0)),
  '200/' || (SELECT count(*) FROM public.clubs
              WHERE tenant_id = 'cc1a0000-0000-0000-0000-00000000000a' AND status = 'active' AND visibility <> 'secret'),
  'club_list(10000) oddaje najwyżej 200 wierszy, total_count dalej pełny');
SELECT is(
  (SELECT count(*)::int || '/' || max(total_count) FROM public.club_list_by_specialization('clv-bulk', 10000, 0)),
  '200/205',
  'club_list_by_specialization(10000) oddaje najwyżej 200 wierszy, total_count dalej pełny');
-- Strony sklejone przez p_offset = pełna lista 0028: ten sam zbiór, a kolejność
-- porównana po KLUCZACH sortowania (remis kluczy = dowolna kolejność wierszy).
SELECT ok(
  (SELECT array_agg(f.id ORDER BY f.id)
     FROM (VALUES (0), (100), (200)) pg(o) CROSS JOIN LATERAL public.club_list(100, pg.o) f)
  = (SELECT array_agg(c.id ORDER BY c.id) FROM public.clubs c
       CROSS JOIN LATERAL public.club_capabilities(c.id, NULL, auth.uid()) k
      WHERE c.tenant_id = 'cc1a0000-0000-0000-0000-00000000000a' AND c.status = 'active'
        AND (c.visibility IN ('public', 'members', 'private') OR k.can_read))
  AND (SELECT array_agg((f.my_status IS NOT NULL, f.last_activity_at, lower(f.name_pl))::text ORDER BY pg.o, f.ordinality)
         FROM (VALUES (0), (100), (200)) pg(o) CROSS JOIN LATERAL public.club_list(100, pg.o) WITH ORDINALITY f)
  = (SELECT array_agg((m.user_id IS NOT NULL, c.last_activity_at, lower(c.name_pl))::text
                      ORDER BY (m.user_id IS NOT NULL) DESC, c.last_activity_at DESC NULLS LAST, lower(c.name_pl) ASC)
       FROM public.clubs c
       LEFT JOIN public.club_members m ON m.club_id = c.id AND m.user_id = auth.uid() AND m.status = 'active'
       CROSS JOIN LATERAL public.club_capabilities(c.id, NULL, auth.uid()) k
      WHERE c.tenant_id = 'cc1a0000-0000-0000-0000-00000000000a' AND c.status = 'active'
        AND (c.visibility IN ('public', 'members', 'private') OR k.can_read)),
  'strony 100+100+100 składają się w pełną listę 0028 - ten sam zbiór i ta sama kolejność');

-- Ile razy club_capabilities() biegnie na jedno wywołanie listy. A13: strona
-- (5) plus bramka sekretów tenantu - nie każdy z ponad 200 klubów.
--
-- Licznik to ATRAPA W TRANSAKCJI, nie `track_functions`: w CI
-- (`supabase test db`) plik biegnie jako `postgres`, który nie jest
-- superużytkownikiem, a track_functions to parametr SUSET - czy supautils
-- go przepuści, zależy od obrazu bazy, a odmowa przerwałaby transakcję
-- i resztę pliku. Prawdziwa funkcja dostaje inną nazwę (OID, ciało
-- i SECURITY DEFINER bez zmian), a pod jej nazwą staje licznik z tą samą
-- sygnaturą, zwrotką, zmiennością i ROWS, który ją woła. Ciała list
-- (LANGUAGE sql bez BEGIN ATOMIC) rozwiązują `public.club_capabilities` przy
-- każdym parsowaniu, więc trafiają w licznik; plpgsql nie da się wpleść
-- (inline), więc każde wywołanie przechodzi przez nextval(). ROLLBACK na
-- końcu pliku przywraca katalog.
CREATE SEQUENCE pg_temp.clv_capcalls_seq;
DO $do$
DECLARE
  f regprocedure := 'public.club_capabilities(uuid,uuid,uuid)'::regprocedure;
  v_rows real;
BEGIN
  SELECT p.prorows INTO v_rows FROM pg_proc p WHERE p.oid = f;
  EXECUTE format('ALTER FUNCTION %s RENAME TO club_capabilities_clv_real', f);
  EXECUTE format(
    $f$CREATE FUNCTION public.club_capabilities(%s) RETURNS %s
       LANGUAGE plpgsql STABLE ROWS %s AS $b$
       BEGIN
         PERFORM nextval('pg_temp.clv_capcalls_seq');
         RETURN QUERY SELECT * FROM public.club_capabilities_clv_real($1, $2, $3);
       END $b$$f$,
    pg_get_function_arguments(f), pg_get_function_result(f), v_rows);
END $do$;
CREATE FUNCTION pg_temp.clv_capcalls(_sql text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE v_before bigint; v_after bigint;
BEGIN
  v_before := nextval('pg_temp.clv_capcalls_seq');
  EXECUTE _sql;
  v_after := nextval('pg_temp.clv_capcalls_seq');
  RETURN v_after - v_before - 1;
END $$;
-- Dwie granice w jednej asercji: górna to dowód A13 (strona plus bramka
-- sekretów, nie każdy klub tenantu), dolna - że licznik w ogóle widzi
-- wywołania Z WNĘTRZA list (strona 5 wierszy = co najmniej 5 wywołań
-- LATERAL). Bez dolnej ślepy licznik (np. ciało przypięte do OID przez
-- BEGIN ATOMIC) dawałby zero i asercja przechodziłaby po cichu.
SELECT ok(
  k.calls BETWEEN 5 AND 5 + s.secrets,
  format('club_list(5) woła club_capabilities dla strony i sekretów (5..%s), nie dla każdego klubu tenantu (wołał: %s)',
         5 + s.secrets, k.calls))
  FROM (SELECT pg_temp.clv_capcalls('SELECT count(*) FROM public.club_list(5, 0)') AS calls) k,
       (SELECT count(*) AS secrets FROM public.clubs
         WHERE tenant_id = 'cc1a0000-0000-0000-0000-00000000000a' AND status = 'active' AND visibility = 'secret') s;
SELECT is(
  pg_temp.clv_capcalls('SELECT count(*) FROM public.club_list_by_specialization(''clv-bulk'', 5, 0)'),
  5::bigint,
  'club_list_by_specialization(5) woła club_capabilities wyłącznie dla zwracanej strony (specjalizacja bez sekretów: dokładnie 5)');
SELECT set_config('request.jwt.claims', '', true);

SELECT * FROM finish();
ROLLBACK;
