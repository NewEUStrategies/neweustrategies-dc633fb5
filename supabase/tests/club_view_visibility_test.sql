-- ============================================================================
-- pgTAP: karta klubu `club_view` - predykat POZYTYWNY z A19
-- (migracje 20260808210000 sekcja 1, przywrócony w 20261017120000).
--
-- A19 zamieniła filtr `WHERE cap.reason IS DISTINCT FROM 'not_found'` na
-- predykat pozytywny, bo gałąź anonimowa `club_capabilities` nie zwraca
-- 'not_found' NIGDY: anonim dostaje reason NULL dla klubu public+active,
-- a w każdym innym przypadku 'auth_required'. Migracja 20260919220300
-- (`cover_position_y`, bliźniak drizzle 0028) zrobiła DROP + CREATE z ciałem
-- sprzed A19 i anonim znów czytał przez `POST /rpc/club_view` pełną kartę
-- (nazwa, opis, ZASADY, okładka, polityka wstępu, liczniki) KAŻDEGO klubu
-- tenantu publicznego - sekretu, szkicu i archiwum też. Zalogowany spoza
-- klubu dostawał dodatkowo szkic i archiwum. Ten plik przybija kontrakt, żeby
-- następny DROP + CREATE (np. nowa kolumna karty) nie mógł go cicho cofnąć.
--
-- Oczekiwania wynikają z predykatu, nie z intuicji:
--   (a) cap.can_read                         - członek, administracja, klub otwarty,
--   (b) zalogowany + status 'active' + widoczność public/members/private,
--   (c) członkostwo w DOWOLNYM stanie (active, invited, banned, ...).
-- Anonim nie spełnia (b) ani (c), więc widzi wyłącznie public+active.
-- Kluby w każdym stanie (public/members/private/secret, draft, archived) +
-- klub publiczny obcego tenantu; aktorzy: anonim (host tenantu A i B),
-- zalogowany spoza klubu, członek sekretu i szkicu, zbanowany i zaproszony
-- w sekrecie, admin A, admin B (także z podmienionym nagłówkiem hosta).
--
-- Każdy aktor dostaje JEDNĄ asercję na pełny zbiór widocznych slugów
-- fixture'a (`is()` drukuje have/want), więc regresja mówi, CO wyciekło.
-- Wywołania idą z rolą anon/authenticated (`set local role`) i tożsamością
-- w `request.jwt.claims` - jak w `club_topics_tenant_isolation_test.sql`;
-- anonim wskazuje tenant publiczny nagłówkiem `x-tenant-host`.
--
-- Bliźniak wykonywany bez pgTAP: scripts/pg-harness/runtime_test.sql, sekcja
-- A19R (`bun run check:pg-harness`).
-- ============================================================================
BEGIN;
SELECT plan(20);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, name, slug, domain)
VALUES ('cfa00000-0000-0000-0000-000000000001', 'Club View A', 'club-view-a', 'club-view-a.example'),
       ('cfb00000-0000-0000-0000-000000000001', 'Club View B', 'club-view-b', 'club-view-b.example');

INSERT INTO auth.users (id, email)
VALUES ('cf000000-0000-0000-0000-000000000001', 'cv-admin-a@test.local'),
       ('cf000000-0000-0000-0000-000000000002', 'cv-outsider@test.local'),
       ('cf000000-0000-0000-0000-000000000003', 'cv-secret-member@test.local'),
       ('cf000000-0000-0000-0000-000000000004', 'cv-secret-banned@test.local'),
       ('cf000000-0000-0000-0000-000000000005', 'cv-secret-invited@test.local'),
       ('cf000000-0000-0000-0000-0000000000b1', 'cv-admin-b@test.local');

INSERT INTO public.profiles (id, tenant_id, display_name, discoverable)
VALUES ('cf000000-0000-0000-0000-000000000001', 'cfa00000-0000-0000-0000-000000000001', 'CV Admin A', true),
       ('cf000000-0000-0000-0000-000000000002', 'cfa00000-0000-0000-0000-000000000001', 'CV Outsider', true),
       ('cf000000-0000-0000-0000-000000000003', 'cfa00000-0000-0000-0000-000000000001', 'CV Secret member', true),
       ('cf000000-0000-0000-0000-000000000004', 'cfa00000-0000-0000-0000-000000000001', 'CV Banned', true),
       ('cf000000-0000-0000-0000-000000000005', 'cfa00000-0000-0000-0000-000000000001', 'CV Invited', true),
       ('cf000000-0000-0000-0000-0000000000b1', 'cfb00000-0000-0000-0000-000000000001', 'CV Admin B', true);

INSERT INTO public.user_roles (user_id, role, tenant_id)
VALUES ('cf000000-0000-0000-0000-000000000001', 'admin', 'cfa00000-0000-0000-0000-000000000001'),
       ('cf000000-0000-0000-0000-0000000000b1', 'admin', 'cfb00000-0000-0000-0000-000000000001');

-- Kluby tenantu A zakłada jego admin (realna ścieżka: `admin_club_upsert`
-- bierze tenanta z sesji), klub tenantu B - admin B.
SELECT set_config('request.jwt.claims', '{"sub":"cf000000-0000-0000-0000-000000000001"}', true);
SELECT public.admin_club_upsert(c.payload::jsonb)
  FROM (VALUES
    ('{"slug":"cv-public","name_pl":"CV public","name_en":"CV public","visibility":"public","status":"active"}'),
    ('{"slug":"cv-members","name_pl":"CV members","name_en":"CV members","visibility":"members","status":"active"}'),
    ('{"slug":"cv-private","name_pl":"CV private","name_en":"CV private","visibility":"private","status":"active"}'),
    ('{"slug":"cv-secret","name_pl":"CV secret","name_en":"CV secret","visibility":"secret","status":"active","rules_pl":"Zasady tylko dla czlonkow"}'),
    ('{"slug":"cv-draft","name_pl":"CV draft","name_en":"CV draft","visibility":"public","status":"draft"}'),
    ('{"slug":"cv-archived","name_pl":"CV archived","name_en":"CV archived","visibility":"public","status":"archived"}')
  ) AS c(payload);

SELECT public.admin_club_member_upsert(cl.id, m.uid, 'member', m.status, NULL)
  FROM (VALUES
    ('cv-secret', 'cf000000-0000-0000-0000-000000000003'::uuid, 'active'),
    ('cv-draft',  'cf000000-0000-0000-0000-000000000003'::uuid, 'active'),
    ('cv-secret', 'cf000000-0000-0000-0000-000000000004'::uuid, 'banned'),
    ('cv-secret', 'cf000000-0000-0000-0000-000000000005'::uuid, 'invited')
  ) AS m(club_slug, uid, status)
  JOIN public.clubs cl
    ON cl.slug = m.club_slug AND cl.tenant_id = 'cfa00000-0000-0000-0000-000000000001';

SELECT set_config('request.jwt.claims', '{"sub":"cf000000-0000-0000-0000-0000000000b1"}', true);
SELECT public.admin_club_upsert(
  '{"slug":"cv-obcy","name_pl":"CV obcy","name_en":"CV foreign","visibility":"public","status":"active"}'::jsonb);
SELECT set_config('request.jwt.claims', '', true);

-- ----------------------------------------------------------------------------
-- 1. Struktura: sygnatura karty, SECURITY DEFINER, granty
-- ----------------------------------------------------------------------------
SELECT has_function('public', 'club_view', ARRAY['text'], 'club_view(text) istnieje');
SELECT is_definer('public', 'club_view', ARRAY['text'], 'club_view jest SECURITY DEFINER');
SELECT is(
  pg_get_function_result('public.club_view(text)'::regprocedure),
  'TABLE(id uuid, slug text, name_pl text, name_en text, tagline_pl text, tagline_en text, description_pl text, description_en text, rules_pl text, rules_en text, icon text, accent_color text, cover_image_url text, cover_position_y smallint, visibility text, join_policy text, min_tier_rank integer, attribution_mode text, who_can_post text, moderation_mode text, policy_area text, status text, layout text, member_count integer, group_count integer, thread_count integer, last_activity_at timestamp with time zone, created_at timestamp with time zone, my_role text, my_status text, rules_accepted_at timestamp with time zone, can_read boolean, can_post_thread boolean, can_reply boolean, can_moderate boolean, can_manage boolean, can_invite boolean, can_see_members boolean, reason text)',
  'RETURNS TABLE karty bez zmian względem 20260919220300 (kolumny i kolejność, z cover_position_y)');
SELECT ok(
  has_function_privilege('anon', 'public.club_view(text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.club_view(text)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.club_view(text)', 'EXECUTE'),
  'anon, authenticated i service_role wykonają club_view (karta jest publiczną powierzchnią)');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
               WHERE p.oid = 'public.club_view(text)'::regprocedure AND a.grantee = 0)
    AND (SELECT proacl IS NOT NULL FROM pg_proc WHERE oid = 'public.club_view(text)'::regprocedure),
  'PUBLIC nie ma EXECUTE na club_view (REVOKE z A19 wrócił po DROP)');

-- ----------------------------------------------------------------------------
-- 2. Anonim na domenie tenantu A: wyłącznie public+active
-- ----------------------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.headers', '{"x-tenant-host":"club-view-a.example"}', true);

SELECT is(
  (SELECT string_agg(s, ',' ORDER BY s)
     FROM unnest(ARRAY['cv-archived','cv-draft','cv-members','cv-obcy','cv-private','cv-public','cv-secret']) s
    WHERE EXISTS (SELECT 1 FROM public.club_view(s))),
  'cv-public',
  'anonim widzi WYŁĄCZNIE kartę klubu public+active (members/private/secret/draft/archived i obcy tenant - zero wierszy)');
SELECT is((SELECT count(*)::int FROM public.club_view('cv-secret')), 0,
  'anonim NIE dostaje karty klubu secret (nazwa, zasady, okładka) - KRYTYCZNE z A19');
SELECT is((SELECT count(*)::int FROM public.club_view('cv-draft')), 0,
  'anonim NIE dostaje szkicu (status draft)');
SELECT ok(
  (SELECT can_read AND reason IS NULL AND cover_position_y = 50 FROM public.club_view('cv-public')),
  'anonim czyta klub public+active, karta niesie cover_position_y');

-- Ten sam anonim na domenie tenantu B widzi klub B i nic z A.
SELECT set_config('request.headers', '{"x-tenant-host":"club-view-b.example"}', true);
SELECT is(
  (SELECT string_agg(s, ',' ORDER BY s)
     FROM unnest(ARRAY['cv-archived','cv-draft','cv-members','cv-obcy','cv-private','cv-public','cv-secret']) s
    WHERE EXISTS (SELECT 1 FROM public.club_view(s))),
  'cv-obcy',
  'anonim na domenie tenantu B widzi wyłącznie klub publiczny B');
RESET ROLE;
SELECT set_config('request.headers', '', true);

-- ----------------------------------------------------------------------------
-- 3. Zalogowany spoza klubu: karta members/private, bez sekretu, szkicu, archiwum
-- ----------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"cf000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT is(
  (SELECT string_agg(s, ',' ORDER BY s)
     FROM unnest(ARRAY['cv-archived','cv-draft','cv-members','cv-obcy','cv-private','cv-public','cv-secret']) s
    WHERE EXISTS (SELECT 1 FROM public.club_view(s))),
  'cv-members,cv-private,cv-public',
  'zalogowany spoza klubu widzi karty public/members/private - bez sekretu, szkicu i archiwum');
SELECT ok(
  (SELECT NOT can_read AND reason = 'not_member' FROM public.club_view('cv-private')),
  'karta klubu private jest jawna dla zalogowanego, treść nie (can_read = false, reason = not_member)');
RESET ROLE;

-- ----------------------------------------------------------------------------
-- 4. Członkostwo w dowolnym stanie odsłania kartę - i nic poza nią
-- ----------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"cf000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT is(
  (SELECT string_agg(s, ',' ORDER BY s)
     FROM unnest(ARRAY['cv-archived','cv-draft','cv-members','cv-obcy','cv-private','cv-public','cv-secret']) s
    WHERE EXISTS (SELECT 1 FROM public.club_view(s))),
  'cv-draft,cv-members,cv-private,cv-public,cv-secret',
  'członek sekretu i szkicu widzi oba kluby, cudzego archiwum nie');
SELECT ok(
  (SELECT can_read AND my_status = 'active' FROM public.club_view('cv-secret')),
  'członek czyta klub secret');

SELECT set_config('request.jwt.claims', '{"sub":"cf000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
SELECT is(
  (SELECT string_agg(s, ',' ORDER BY s)
     FROM unnest(ARRAY['cv-archived','cv-draft','cv-members','cv-obcy','cv-private','cv-public','cv-secret']) s
    WHERE EXISTS (SELECT 1 FROM public.club_view(s))),
  'cv-members,cv-private,cv-public,cv-secret',
  'zbanowany widzi kartę swojego sekretu (inaczej nie wie, że został zbanowany)');
SELECT ok(
  (SELECT NOT can_read AND reason = 'banned' AND my_status = 'banned' FROM public.club_view('cv-secret')),
  'zbanowany dostaje kartę z reason = banned, bez treści');

SELECT set_config('request.jwt.claims', '{"sub":"cf000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
SELECT is(
  (SELECT string_agg(s, ',' ORDER BY s)
     FROM unnest(ARRAY['cv-archived','cv-draft','cv-members','cv-obcy','cv-private','cv-public','cv-secret']) s
    WHERE EXISTS (SELECT 1 FROM public.club_view(s))),
  'cv-members,cv-private,cv-public,cv-secret',
  'zaproszony widzi kartę sekretu, do którego go zaproszono');
RESET ROLE;

-- ----------------------------------------------------------------------------
-- 5. Administracja tenantu widzi wszystko; obcy tenant nic - także z cudzym hostem
-- ----------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"cf000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
SELECT is(
  (SELECT string_agg(s, ',' ORDER BY s)
     FROM unnest(ARRAY['cv-archived','cv-draft','cv-members','cv-obcy','cv-private','cv-public','cv-secret']) s
    WHERE EXISTS (SELECT 1 FROM public.club_view(s))),
  'cv-archived,cv-draft,cv-members,cv-private,cv-public,cv-secret',
  'admin tenantu A widzi każdy klub A (szkic, archiwum, sekret), klubu B nie');

SELECT set_config('request.jwt.claims', '{"sub":"cf000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SELECT is(
  (SELECT string_agg(s, ',' ORDER BY s)
     FROM unnest(ARRAY['cv-archived','cv-draft','cv-members','cv-obcy','cv-private','cv-public','cv-secret']) s
    WHERE EXISTS (SELECT 1 FROM public.club_view(s))),
  'cv-obcy',
  'admin tenantu B nie widzi po slugu żadnego klubu A');
SELECT set_config('request.headers', '{"x-tenant-host":"club-view-a.example"}', true);
SELECT is(
  (SELECT string_agg(s, ',' ORDER BY s)
     FROM unnest(ARRAY['cv-archived','cv-draft','cv-members','cv-obcy','cv-private','cv-public','cv-secret']) s
    WHERE EXISTS (SELECT 1 FROM public.club_view(s))),
  'cv-obcy',
  'podmieniony nagłówek x-tenant-host niczego nie otwiera - zalogowany zostaje w swoim tenancie');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
