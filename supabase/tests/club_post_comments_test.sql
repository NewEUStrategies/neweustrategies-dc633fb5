-- ============================================================================
-- pgTAP: komentarze wpisów ściany klubu, @wzmianki we wpisach i komentarzach,
-- podpowiedzi członków klubu i walidacja migawek linków
-- (migracje 20261007100000 i 20261007100100).
--
-- Plik przybija kontrakt na PEŁNYM schemacie:
--   1. struktura i granty: tabela bez grantów klienckich (RLS bez polityk),
--      lista dla anon, zapis dla authenticated, pomocnicy tylko service_role,
--      pseudonim z `extensions` na search_path (pgcrypto);
--   2. `club_post_comment_create`: logowanie, prawo `can_reply`, wpis
--      opublikowany, treść 1..3000, migawka linku (tylko https, długości,
--      normalizacja do pięciu kluczy), limity 5/min i 60/24 h;
--   3. `club_post_comments_list`: najnowsze pierwsze, kursor keyset,
--      `total_count` bez kursora, `can_manage`, pusty zbiór dla nieczytającego;
--   4. premoderacja: pending widzi autor i moderacja, licznik go nie liczy;
--   5. `club_posts_list`: `comment_count` i `can_comment` (obserwator czyta,
--      ale nie komentuje);
--   6. `club_post_comment_delete`: autor, moderacja, odmowa, idempotencja;
--   7. Chatham House: autor ukryty, pseudonim per wpis;
--   8. powiadomienia: autor wpisu (bez nazwiska w chatham, nie dla pending),
--      wzmianki w komentarzu i we wpisie z bramką odbiorców - osoba spoza
--      klubu prywatnego NIE dostaje powiadomienia;
--   9. `club_mention_visible_to` dla nowych źródeł liczy prawo ODBIORCY,
--      nie autora (osłona `club_capabilities` podmienia cudze konto na
--      wołającego - stąd `club_user_can_read`);
--  10. `club_mention_members`: bramka, odnajdywalność, bez wołającego,
--      dopasowanie bez wzorca LIKE;
--  11. `club_post_create`: element `type=link` walidowany i normalizowany.
--
-- Wywołania idą rolą właściciela z tożsamością w `request.jwt.claims` - jak
-- w `club_cover_write_capabilities_test.sql`: funkcje są SECURITY DEFINER
-- i rozstrzygają wołającego z JWT. Wewnątrz transakcji `now()` jest stałe,
-- więc kolejność i okna limitów ustawiamy jawnie, przesuwając `created_at`.
-- ============================================================================
BEGIN;
SELECT plan(85);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, name, slug)
VALUES ('c9c00000-0000-0000-0000-0000000000a0', 'Tenant komentarzy', 'tenant-club-post-comments-test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('c9000000-0000-0000-0000-000000000001', 'kom-admin@kom.test'),
       ('c9000000-0000-0000-0000-000000000002', 'kom-author@kom.test'),
       ('c9000000-0000-0000-0000-000000000003', 'kom-commenter@kom.test'),
       ('c9000000-0000-0000-0000-000000000004', 'kom-moderator@kom.test'),
       ('c9000000-0000-0000-0000-000000000005', 'kom-observer@kom.test'),
       ('c9000000-0000-0000-0000-000000000006', 'kom-outsider@kom.test'),
       ('c9000000-0000-0000-0000-000000000007', 'kom-burster@kom.test'),
       ('c9000000-0000-0000-0000-000000000008', 'kom-hidden@kom.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, slug, discoverable)
VALUES ('c9000000-0000-0000-0000-000000000001', 'c9c00000-0000-0000-0000-0000000000a0', 'Admin Komentarzy', 'admin-kom-test', true),
       ('c9000000-0000-0000-0000-000000000002', 'c9c00000-0000-0000-0000-0000000000a0', 'Anna Autorka', 'anna-autorka-kom', true),
       ('c9000000-0000-0000-0000-000000000003', 'c9c00000-0000-0000-0000-0000000000a0', 'Celina Komentujaca', 'celina-kom', true),
       ('c9000000-0000-0000-0000-000000000004', 'c9c00000-0000-0000-0000-0000000000a0', 'Marek Moderator', 'marek-moderator-kom', true),
       ('c9000000-0000-0000-0000-000000000005', 'c9c00000-0000-0000-0000-0000000000a0', 'Olga Obserwatorka', 'olga-obs-kom', true),
       ('c9000000-0000-0000-0000-000000000006', 'c9c00000-0000-0000-0000-0000000000a0', 'Oskar Obcy', 'oskar-obcy-kom', true),
       ('c9000000-0000-0000-0000-000000000007', 'c9c00000-0000-0000-0000-0000000000a0', 'Bartek Seria', 'bartek-seria-kom', true),
       ('c9000000-0000-0000-0000-000000000008', 'c9c00000-0000-0000-0000-0000000000a0', 'Ukryty Czlonek', 'ukryty-kom', false);

INSERT INTO public.user_roles (user_id, role, tenant_id)
VALUES ('c9000000-0000-0000-0000-000000000001', 'admin', 'c9c00000-0000-0000-0000-0000000000a0');

-- Trzy kluby prywatne: zwykły, Chatham House i z premoderacją.
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000001"}', true);
SELECT set_config('test.k1', public.admin_club_upsert(
  '{"slug":"kom-test-private","name_pl":"Komentarze","visibility":"private","status":"active"}'::jsonb)::text, true);
SELECT set_config('test.k2', public.admin_club_upsert(
  '{"slug":"kom-test-chatham","name_pl":"Chatham","visibility":"private","status":"active","attribution_mode":"chatham"}'::jsonb)::text, true);
SELECT set_config('test.k3', public.admin_club_upsert(
  '{"slug":"kom-test-pre","name_pl":"Premoderacja","visibility":"private","status":"active","moderation_mode":"pre"}'::jsonb)::text, true);

SELECT public.admin_club_member_upsert(current_setting('test.k1')::uuid, m.uid, m.role, 'active', NULL)
  FROM (VALUES
    ('c9000000-0000-0000-0000-000000000002'::uuid, 'member'),
    ('c9000000-0000-0000-0000-000000000003'::uuid, 'member'),
    ('c9000000-0000-0000-0000-000000000004'::uuid, 'moderator'),
    ('c9000000-0000-0000-0000-000000000005'::uuid, 'observer'),
    ('c9000000-0000-0000-0000-000000000007'::uuid, 'member'),
    ('c9000000-0000-0000-0000-000000000008'::uuid, 'member')
  ) AS m(uid, role);
SELECT public.admin_club_member_upsert(current_setting('test.k2')::uuid, m.uid, m.role, 'active', NULL)
  FROM (VALUES
    ('c9000000-0000-0000-0000-000000000002'::uuid, 'member'),
    ('c9000000-0000-0000-0000-000000000003'::uuid, 'member'),
    ('c9000000-0000-0000-0000-000000000004'::uuid, 'member')
  ) AS m(uid, role);
SELECT public.admin_club_member_upsert(current_setting('test.k3')::uuid, m.uid, m.role, 'active', NULL)
  FROM (VALUES
    ('c9000000-0000-0000-0000-000000000002'::uuid, 'member'),
    ('c9000000-0000-0000-0000-000000000003'::uuid, 'member'),
    ('c9000000-0000-0000-0000-000000000004'::uuid, 'moderator')
  ) AS m(uid, role);

-- Wpisy autorki: P1 (k1), PF (k1, pod limity tempa), P2 (k2), P3 (k3).
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000002"}', true);
SELECT set_config('test.p1', (SELECT post_id::text FROM public.club_post_create(
  current_setting('test.k1')::uuid, NULL, NULL, 'Wpis testowy', '[]'::jsonb)), true);
SELECT set_config('test.pf', (SELECT post_id::text FROM public.club_post_create(
  current_setting('test.k1')::uuid, NULL, NULL, 'Wpis pod serie', '[]'::jsonb)), true);
SELECT set_config('test.p2', (SELECT post_id::text FROM public.club_post_create(
  current_setting('test.k2')::uuid, NULL, NULL, 'Wpis pod regula Chatham House', '[]'::jsonb)), true);
SELECT set_config('test.p3', (SELECT post_id::text FROM public.club_post_create(
  current_setting('test.k3')::uuid, NULL, NULL, 'Wpis w klubie z premoderacja', '[]'::jsonb)), true);

-- ----------------------------------------------------------------------------
-- 1. Struktura i granty
-- ----------------------------------------------------------------------------
SELECT has_table('public', 'club_post_comments', 'tabela club_post_comments istnieje');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.club_post_comments'::regclass),
  'RLS wlaczone na club_post_comments');

SELECT is_empty($$
  SELECT grantee, privilege_type FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'club_post_comments'
     AND grantee IN ('anon', 'authenticated', 'PUBLIC')
$$, 'klient nie ma zadnego grantu na tabeli komentarzy (wzorzec club_replies)');

SELECT ok(
  has_function_privilege('anon', 'public.club_post_comments_list(uuid,integer,timestamptz,uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.club_post_comments_list(uuid,integer,timestamptz,uuid)', 'EXECUTE'),
  'lista komentarzy dostepna dla anon i authenticated');

SELECT ok(
  NOT has_function_privilege('anon', 'public.club_post_comment_create(uuid,text,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.club_post_comment_delete(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.club_mention_members(uuid,text,integer)', 'EXECUTE'),
  'anon nie pisze, nie usuwa i nie listuje czlonkow');

SELECT ok(
  has_function_privilege('authenticated', 'public.club_post_comment_create(uuid,text,jsonb)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.club_post_comment_delete(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.club_mention_members(uuid,text,integer)', 'EXECUTE'),
  'authenticated pisze, usuwa i pyta o podpowiedzi czlonkow');

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.club_post_author_alias(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.club_user_can_read(uuid,uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.club_link_snapshot_normalize(jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.club_post_seam_context(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.club_mention_visible_to(text,text,uuid)', 'EXECUTE'),
  'pomocnicy (pseudonim, prawo odczytu odbiorcy, normalizacja linku, kontekst szwow, bramka wzmianek) bez EXECUTE dla klienta');

SELECT ok(
  EXISTS (
    SELECT 1 FROM unnest((SELECT proconfig FROM pg_proc
                           WHERE oid = 'public.club_post_author_alias(uuid,uuid)'::regprocedure)) c
     WHERE c LIKE 'search_path=%extensions%'),
  'pseudonim komentarza (pgcrypto) ma extensions na search_path');

-- ----------------------------------------------------------------------------
-- 2. Nowy komentarz
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000003"}', true);
SELECT set_config('test.c1', (SELECT comment_id::text FROM public.club_post_comment_create(
  current_setting('test.p1')::uuid, '  Pierwszy komentarz  ')), true);

SELECT is(
  (SELECT status FROM public.club_post_comments WHERE id = current_setting('test.c1')::uuid),
  'visible', 'czlonek w klubie trusted publikuje komentarz od razu');
SELECT is(
  (SELECT body FROM public.club_post_comments WHERE id = current_setting('test.c1')::uuid),
  'Pierwszy komentarz', 'tresc zapisana po btrim');
SELECT ok(
  (SELECT pc.club_id = po.club_id AND pc.tenant_id = po.tenant_id
     FROM public.club_post_comments pc JOIN public.club_posts po ON po.id = pc.post_id
    WHERE pc.id = current_setting('test.c1')::uuid),
  'klub i najemca komentarza pochodza z wpisu');

SELECT set_config('request.jwt.claims', '', true);
SELECT throws_ok(
  format('SELECT * FROM public.club_post_comment_create(%L, %L)', current_setting('test.p1'), 'x'),
  '42501', 'clubs: authentication required', 'niezalogowany nie komentuje');

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000006"}', true);
SELECT throws_ok(
  format('SELECT * FROM public.club_post_comment_create(%L, %L)', current_setting('test.p1'), 'x'),
  '42501', 'clubs: forbidden', 'osoba spoza klubu prywatnego nie komentuje');

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000005"}', true);
SELECT throws_ok(
  format('SELECT * FROM public.club_post_comment_create(%L, %L)', current_setting('test.p1'), 'x'),
  '42501', 'clubs: forbidden', 'obserwator czyta, ale nie komentuje (can_reply)');

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000003"}', true);
SELECT throws_ok(
  $$SELECT * FROM public.club_post_comment_create('c9e00000-0000-0000-0000-00000000dead', 'x')$$,
  'P0002', 'clubs: post not found', 'nieistniejacy wpis: post not found');

SELECT throws_ok(
  format('SELECT * FROM public.club_post_comment_create(%L, %L)', current_setting('test.p1'), '   '),
  '22023', 'clubs: invalid comment', 'pusta tresc odrzucona');

SELECT throws_ok(
  format('SELECT * FROM public.club_post_comment_create(%L, %L)', current_setting('test.p1'), E'\n \t\n'),
  '22023', 'clubs: invalid comment', 'tresc z samych bialych znakow (nowe linie) odrzucona');

SELECT throws_ok(
  format('SELECT * FROM public.club_post_comment_create(%L, %L)', current_setting('test.p1'), repeat('a', 3001)),
  '22023', 'clubs: invalid comment', 'tresc ponad 3000 znakow odrzucona');

SELECT throws_ok(
  format('SELECT * FROM public.club_post_comment_create(%L, %L, %L::jsonb)', current_setting('test.p1'), 'z linkiem',
         '{"url":"http://example.org/a"}'),
  '22023', 'clubs: invalid link preview', 'podglad linku http (nie https) odrzucony');

SELECT throws_ok(
  format('SELECT * FROM public.club_post_comment_create(%L, %L, %L::jsonb)', current_setting('test.p1'), 'z linkiem',
         jsonb_build_object('url', 'https://example.org/a', 'title', repeat('t', 301))),
  '22023', 'clubs: invalid link preview', 'tytul podgladu ponad 300 znakow odrzucony');

SELECT throws_ok(
  format('SELECT * FROM public.club_post_comment_create(%L, %L, %L::jsonb)', current_setting('test.p1'), 'z linkiem',
         '{"url":"https://example.org/a","image":"javascript:alert(1)"}'),
  '22023', 'clubs: invalid link preview', 'obraz podgladu spoza https odrzucony');

SELECT throws_ok(
  format('SELECT * FROM public.club_post_comment_create(%L, %L, %L::jsonb)', current_setting('test.p1'), 'z linkiem', '[]'),
  '22023', 'clubs: invalid link preview', 'podglad, ktory nie jest obiektem, odrzucony');

SELECT set_config('test.c2', (SELECT comment_id::text FROM public.club_post_comment_create(
  current_setting('test.p1')::uuid, 'Zobaczcie https://example.org/a',
  '{"url":" https://example.org/a ","title":"  ","description":"Opis","image":"https://example.org/i.png","siteName":"Example","evil":"x"}'::jsonb)), true);

SELECT is(
  (SELECT array_agg(k ORDER BY k COLLATE "C") FROM jsonb_object_keys(
     (SELECT link_preview FROM public.club_post_comments WHERE id = current_setting('test.c2')::uuid)) k),
  ARRAY['description', 'image', 'siteName', 'title', 'url'],
  'migawka linku znormalizowana do DOKLADNIE pieciu kluczy (obcy klucz pominiety)');
SELECT is(
  (SELECT link_preview FROM public.club_post_comments WHERE id = current_setting('test.c2')::uuid),
  '{"url":"https://example.org/a","title":null,"description":"Opis","image":"https://example.org/i.png","siteName":"Example"}'::jsonb,
  'migawka: url przyciety, pusty tytul jako null');

-- Moderator i autorka komentuja P1; kolejnosc ustawiamy jawnie.
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000004"}', true);
SELECT set_config('test.c3', (SELECT comment_id::text FROM public.club_post_comment_create(
  current_setting('test.p1')::uuid, 'Komentarz moderatora')), true);
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000002"}', true);
SELECT set_config('test.c4', (SELECT comment_id::text FROM public.club_post_comment_create(
  current_setting('test.p1')::uuid, 'Odpowiedz autorki')), true);

UPDATE public.club_post_comments SET created_at = now() - interval '10 minutes' WHERE id = current_setting('test.c1')::uuid;
UPDATE public.club_post_comments SET created_at = now() - interval '9 minutes'  WHERE id = current_setting('test.c2')::uuid;
UPDATE public.club_post_comments SET created_at = now() - interval '8 minutes'  WHERE id = current_setting('test.c3')::uuid;
UPDATE public.club_post_comments SET created_at = now() - interval '7 minutes'  WHERE id = current_setting('test.c4')::uuid;

-- ----------------------------------------------------------------------------
-- 2b. Limity tempa (osobny czlonek i osobny wpis, zeby nie mieszac licznikow)
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000007"}', true);
DO $$
BEGIN
  FOR i IN 1..5 LOOP
    PERFORM * FROM public.club_post_comment_create(current_setting('test.pf')::uuid, 'Seria ' || i);
  END LOOP;
END $$;

SELECT is(
  (SELECT count(*)::int FROM public.club_post_comments
    WHERE author_id = 'c9000000-0000-0000-0000-000000000007'),
  5, 'piec komentarzy w minucie przechodzi');
SELECT throws_ok(
  format('SELECT * FROM public.club_post_comment_create(%L, %L)', current_setting('test.pf'), 'Szosty'),
  '42901', 'clubs: comment burst limit', 'szosty komentarz w minucie: burst limit');

-- Okno minuty puste, ale 60 komentarzy w ciagu doby (wypelniacz jako
-- 'deleted': limit liczy kazdy status, a licznik wpisu go nie widzi).
UPDATE public.club_post_comments SET created_at = now() - interval '2 hours'
 WHERE author_id = 'c9000000-0000-0000-0000-000000000007';
INSERT INTO public.club_post_comments (tenant_id, club_id, post_id, author_id, body, status, created_at)
SELECT po.tenant_id, po.club_id, po.id, 'c9000000-0000-0000-0000-000000000007', 'Wypelniacz ' || g,
       'deleted', now() - interval '3 hours'
  FROM public.club_posts po, generate_series(1, 55) g
 WHERE po.id = current_setting('test.pf')::uuid;

SELECT throws_ok(
  format('SELECT * FROM public.club_post_comment_create(%L, %L)', current_setting('test.pf'), 'Ponad dobe'),
  '42901', 'clubs: comment rate limit', '60 komentarzy w dobie: rate limit');

-- ----------------------------------------------------------------------------
-- 3. Lista
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000003"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.club_post_comments_list(current_setting('test.p1')::uuid)),
  3, 'domyslnie trzy najnowsze komentarze');
SELECT is(
  (SELECT DISTINCT total_count::int FROM public.club_post_comments_list(current_setting('test.p1')::uuid)),
  4, 'total_count liczy wszystkie widoczne komentarze');
SELECT results_eq(
  format('SELECT body FROM public.club_post_comments_list(%L, 10)', current_setting('test.p1')),
  $$VALUES ('Odpowiedz autorki'::text), ('Komentarz moderatora'), ('Zobaczcie https://example.org/a'), ('Pierwszy komentarz')$$,
  'najnowsze pierwsze');
SELECT results_eq(
  format('SELECT body FROM public.club_post_comments_list(%L, 10, %L::timestamptz, %L::uuid)',
         current_setting('test.p1'),
         (SELECT created_at FROM public.club_post_comments WHERE id = current_setting('test.c3')::uuid),
         current_setting('test.c3')),
  $$VALUES ('Zobaczcie https://example.org/a'::text), ('Pierwszy komentarz')$$,
  'kursor (created_at, id) zwraca starsze od wskazanego');
SELECT ok(
  (SELECT author_id = 'c9000000-0000-0000-0000-000000000003' AND author_slug = 'celina-kom'
          AND author_name = 'Celina Komentujaca' AND author_alias IS NULL
     FROM public.club_post_comments_list(current_setting('test.p1')::uuid, 10)
    WHERE id = current_setting('test.c1')::uuid),
  'poza chatham autor jawny, bez pseudonimu');
SELECT is(
  (SELECT array_agg(can_manage ORDER BY created_at)
     FROM public.club_post_comments_list(current_setting('test.p1')::uuid, 10)),
  ARRAY[true, true, false, false],
  'can_manage: wlasne komentarze tak, cudze nie');
SELECT is(
  (SELECT count(*)::int FROM public.club_post_comments_list(current_setting('test.p1')::uuid, 0)),
  1, 'p_limit przyciety do co najmniej 1');

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000004"}', true);
SELECT ok(
  (SELECT bool_and(can_manage) FROM public.club_post_comments_list(current_setting('test.p1')::uuid, 10)),
  'moderator zarzadza kazdym komentarzem');

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000006"}', true);
SELECT is_empty(
  format('SELECT * FROM public.club_post_comments_list(%L)', current_setting('test.p1')),
  'osoba spoza klubu prywatnego dostaje pusty zbior, nie blad');

SELECT set_config('request.jwt.claims', '', true);
SELECT is_empty(
  format('SELECT * FROM public.club_post_comments_list(%L)', current_setting('test.p1')),
  'anonim w klubie prywatnym dostaje pusty zbior');

-- ----------------------------------------------------------------------------
-- 4. Premoderacja (k3)
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000003"}', true);
SELECT set_config('test.c5', (SELECT comment_id::text FROM public.club_post_comment_create(
  current_setting('test.p3')::uuid, 'Czeka na moderacje')), true);
SELECT is(
  (SELECT status FROM public.club_post_comments WHERE id = current_setting('test.c5')::uuid),
  'pending', 'w klubie z premoderacja komentarz czlonka idzie do kolejki');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.notifications
               WHERE user_id = 'c9000000-0000-0000-0000-000000000002'
                 AND href = '/club/kom-test-pre?post=' || current_setting('test.p3')),
  'komentarz pending nie powiadamia autorki wpisu');

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000004"}', true);
SELECT is(
  (SELECT comment_status FROM public.club_post_comment_create(current_setting('test.p3')::uuid, 'Glos moderatora')),
  'visible', 'moderator omija kolejke');
SELECT is(
  (SELECT count(*)::int FROM public.club_post_comments_list(current_setting('test.p3')::uuid, 10)),
  2, 'moderator widzi komentarz pending');

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000003"}', true);
SELECT ok(
  EXISTS (SELECT 1 FROM public.club_post_comments_list(current_setting('test.p3')::uuid, 10)
           WHERE id = current_setting('test.c5')::uuid AND status = 'pending'),
  'autor widzi wlasny komentarz pending');

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000002"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.club_post_comments_list(current_setting('test.p3')::uuid, 10)),
  1, 'inny czlonek nie widzi cudzego komentarza pending');
SELECT is(
  (SELECT comment_count::int FROM public.club_posts_list(current_setting('test.k3')::uuid)
    WHERE id = current_setting('test.p3')::uuid),
  1, 'comment_count nie liczy komentarza pending');

-- ----------------------------------------------------------------------------
-- 5. club_posts_list: comment_count i can_comment
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000003"}', true);
SELECT ok(
  (SELECT comment_count = 4 AND can_comment
     FROM public.club_posts_list(current_setting('test.k1')::uuid)
    WHERE id = current_setting('test.p1')::uuid),
  'czlonek: comment_count = 4 i can_comment');

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000005"}', true);
SELECT ok(
  (SELECT comment_count = 4 AND NOT can_comment
     FROM public.club_posts_list(current_setting('test.k1')::uuid)
    WHERE id = current_setting('test.p1')::uuid),
  'obserwator: widzi licznik, can_comment = false');

-- ----------------------------------------------------------------------------
-- 6. Usuwanie
-- ----------------------------------------------------------------------------
SELECT throws_ok(
  format('SELECT public.club_post_comment_delete(%L)', current_setting('test.c1')),
  '42501', 'clubs: forbidden', 'cudzego komentarza nie usunie zwykly czytelnik');

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000003"}', true);
SELECT is(public.club_post_comment_delete(current_setting('test.c1')::uuid), true,
  'autor usuwa wlasny komentarz');
SELECT is(public.club_post_comment_delete(current_setting('test.c1')::uuid), false,
  'ponowne usuniecie: false');
SELECT is(
  (SELECT DISTINCT total_count::int FROM public.club_post_comments_list(current_setting('test.p1')::uuid)),
  3, 'usuniety komentarz znika z listy');
SELECT is(
  (SELECT status FROM public.club_post_comments WHERE id = current_setting('test.c1')::uuid),
  'deleted', 'usuniecie jest miekkie (status deleted)');

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000004"}', true);
SELECT is(public.club_post_comment_delete(current_setting('test.c4')::uuid), true,
  'moderator usuwa cudzy komentarz');
SELECT is(public.club_post_comment_delete('c9e00000-0000-0000-0000-00000000beef'::uuid), false,
  'nieistniejacy komentarz: false');

SELECT set_config('request.jwt.claims', '', true);
SELECT throws_ok(
  format('SELECT public.club_post_comment_delete(%L)', current_setting('test.c2')),
  '42501', 'clubs: authentication required', 'niezalogowany nie usuwa');

-- ----------------------------------------------------------------------------
-- 7. Chatham House (k2)
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000003"}', true);
SELECT set_config('test.k2c', (SELECT comment_id::text FROM public.club_post_comment_create(
  current_setting('test.p2')::uuid, 'Glos z sali')), true);
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000002"}', true);
SELECT set_config('test.k2a', (SELECT comment_id::text FROM public.club_post_comment_create(
  current_setting('test.p2')::uuid, 'Druga uwaga')), true);

SELECT ok(
  (SELECT bool_and(author_id IS NULL AND author_name IS NULL AND author_slug IS NULL
                   AND author_avatar IS NULL)
     FROM public.club_post_comments_list(current_setting('test.p2')::uuid, 10)),
  'chatham: lista nie zwraca autora');
SELECT ok(
  (SELECT bool_and(author_alias ~ '^[0-9A-HJKMNP-TV-Z]{5}$')
     FROM public.club_post_comments_list(current_setting('test.p2')::uuid, 10)),
  'chatham: pseudonim 5 znakow Crockford Base32');
SELECT is(
  (SELECT count(DISTINCT author_alias)::int
     FROM public.club_post_comments_list(current_setting('test.p2')::uuid, 10)),
  2, 'chatham: dwie osoby, dwa rozne pseudonimy');
SELECT is(
  (SELECT author_alias FROM public.club_post_comments_list(current_setting('test.p2')::uuid, 10)
    WHERE id = current_setting('test.k2c')::uuid),
  public.club_post_author_alias(current_setting('test.p2')::uuid, 'c9000000-0000-0000-0000-000000000003'),
  'chatham: pseudonim stabilny (ta sama funkcja per wpis)');
SELECT isnt(
  public.club_post_author_alias(current_setting('test.p2')::uuid, 'c9000000-0000-0000-0000-000000000003'),
  public.club_post_author_alias(current_setting('test.p1')::uuid, 'c9000000-0000-0000-0000-000000000003'),
  'pseudonim tej samej osoby rozny pod roznymi wpisami');

-- ----------------------------------------------------------------------------
-- 8. Powiadomienia
-- ----------------------------------------------------------------------------
SELECT ok(
  EXISTS (SELECT 1 FROM public.notifications
           WHERE user_id = 'c9000000-0000-0000-0000-000000000002' AND kind = 'club'
             AND href = '/club/kom-test-private?post=' || current_setting('test.p1')
             AND title_pl LIKE '%skomentował(a) Twój wpis'),
  'autorka wpisu dostaje powiadomienie o komentarzu z adresem ?post=');
SELECT is(
  (SELECT title_pl FROM public.notifications
    WHERE user_id = 'c9000000-0000-0000-0000-000000000002'
      AND href = '/club/kom-test-chatham?post=' || current_setting('test.p2')),
  'Uczestnik dyskusji skomentował(a) Twój wpis',
  'chatham: powiadomienie bez nazwiska komentujacego');
-- Komentarz pod WLASNYM wpisem nie powiadamia autorki.
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000002"}', true);
SELECT set_config('test.p6', (SELECT post_id::text FROM public.club_post_create(
  current_setting('test.k1')::uuid, NULL, NULL, 'Wpis bez gosci', '[]'::jsonb)), true);
SELECT is(
  (SELECT comment_status FROM public.club_post_comment_create(current_setting('test.p6')::uuid, 'Sama sobie')),
  'visible', 'autorka komentuje wlasny wpis');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.notifications
               WHERE user_id = 'c9000000-0000-0000-0000-000000000002'
                 AND href = '/club/kom-test-private?post=' || current_setting('test.p6')),
  'brak samopowiadomienia o komentarzu pod wlasnym wpisem');

-- Wzmianki w komentarzu: moderator (czlonek) tak, osoba spoza klubu - nie.
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000003"}', true);
SELECT set_config('test.c6', (SELECT comment_id::text FROM public.club_post_comment_create(
  current_setting('test.p1')::uuid, 'Pytanie do @marek-moderator-kom i @oskar-obcy-kom')), true);

SELECT ok(
  EXISTS (SELECT 1 FROM public.notifications
           WHERE user_id = 'c9000000-0000-0000-0000-000000000004' AND kind = 'club'
             AND href = '/club/kom-test-private?post=' || current_setting('test.p1')
             AND title_pl = 'Celina Komentujaca wspomniał(a) o Tobie'),
  'wzmianka czlonka w komentarzu: powiadomienie z adresem wpisu');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.notifications
               WHERE user_id = 'c9000000-0000-0000-0000-000000000006' AND kind = 'club'),
  'wzmianka osoby spoza klubu prywatnego: brak powiadomienia (bramka odbiorcy)');
SELECT ok(
  EXISTS (SELECT 1 FROM public.cross_references
           WHERE source_type = 'club_post_comment' AND source_id = current_setting('test.c6')
             AND target_type = 'profile' AND target_id = 'c9000000-0000-0000-0000-000000000004'
             AND created_by = 'c9000000-0000-0000-0000-000000000003'),
  'wzmianka w komentarzu zapisuje krawedz z aktorem');

-- Wzmianka w komentarzu pod regula Chatham House: bez aktora.
SELECT set_config('test.c7', (SELECT comment_id::text FROM public.club_post_comment_create(
  current_setting('test.p2')::uuid, 'Zgoda, @marek-moderator-kom')), true);
SELECT is(
  (SELECT title_pl FROM public.notifications
    WHERE user_id = 'c9000000-0000-0000-0000-000000000004'
      AND href = '/club/kom-test-chatham?post=' || current_setting('test.p2')),
  'Uczestnik dyskusji wspomniał(a) o Tobie',
  'chatham: wzmianka podpisana etykieta, nie nazwiskiem');
SELECT ok(
  EXISTS (SELECT 1 FROM public.cross_references
           WHERE source_type = 'club_post_comment' AND source_id = current_setting('test.c7')
             AND target_id = 'c9000000-0000-0000-0000-000000000004' AND created_by IS NULL),
  'chatham: krawedz wzmianki bez aktora');
SELECT ok(
  EXISTS (SELECT 1 FROM public.domain_events
           WHERE aggregate_type = 'club_post_comment' AND aggregate_id = current_setting('test.c7')
             AND event_type = 'club_post_comment.created.v1' AND actor_id IS NULL
             AND payload->>'post_id' = current_setting('test.p2')),
  'chatham: zdarzenie club_post_comment.created.v1 bez aktora');

-- Wzmianka w nowym wpisie sciany.
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000002"}', true);
SELECT set_config('test.p4', (SELECT post_id::text FROM public.club_post_create(
  current_setting('test.k1')::uuid, NULL, NULL, 'Zobacz, @olga-obs-kom, i ty @oskar-obcy-kom', '[]'::jsonb)), true);
SELECT ok(
  EXISTS (SELECT 1 FROM public.notifications
           WHERE user_id = 'c9000000-0000-0000-0000-000000000005' AND kind = 'club'
             AND href = '/club/kom-test-private?post=' || current_setting('test.p4')
             AND title_pl = 'Anna Autorka wspomniał(a) o Tobie'),
  'wzmianka we wpisie sciany powiadamia czlonka z adresem ?post=');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.notifications
               WHERE user_id = 'c9000000-0000-0000-0000-000000000006' AND kind = 'club'),
  'wzmianka we wpisie nie dociera do osoby spoza klubu prywatnego');

-- ----------------------------------------------------------------------------
-- 9. club_mention_visible_to: prawo ODBIORCY, nie wolajacego
-- ----------------------------------------------------------------------------
-- Tozsamosc = autor komentarza, dokladnie jak w triggerze szwow.
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000003"}', true);
SELECT is(
  public.club_mention_visible_to('club_post_comment', current_setting('test.c2'), 'c9000000-0000-0000-0000-000000000006'),
  false, 'komentarz: osoba spoza klubu prywatnego nie jest odbiorca (choc wolajacy czyta)');
SELECT is(
  public.club_mention_visible_to('club_post_comment', current_setting('test.c2'), 'c9000000-0000-0000-0000-000000000004'),
  true, 'komentarz: czlonek klubu jest odbiorca');
SELECT ok(
  NOT public.club_mention_visible_to('club_post', current_setting('test.p1'), 'c9000000-0000-0000-0000-000000000006')
    AND public.club_mention_visible_to('club_post', current_setting('test.p1'), 'c9000000-0000-0000-0000-000000000005'),
  'wpis: obcy nie, obserwator (czyta) tak');
SELECT is(
  public.club_mention_visible_to('comments', 'c9e00000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000006'),
  true, 'zrodla spoza klubow bez zmian (true)');

-- ----------------------------------------------------------------------------
-- 10. club_mention_members
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000003"}', true);
SELECT set_eq(
  format('SELECT slug FROM public.club_mention_members(%L, NULL, 20)', current_setting('test.k1')),
  $$VALUES ('anna-autorka-kom'::text), ('marek-moderator-kom'), ('olga-obs-kom'), ('bartek-seria-kom')$$,
  'aktywni, odnajdywalni czlonkowie bez wolajacego i bez profilu ukrytego');
SELECT results_eq(
  format('SELECT slug FROM public.club_mention_members(%L, %L)', current_setting('test.k1'), 'mar'),
  $$VALUES ('marek-moderator-kom'::text)$$,
  'dopasowanie po poczatku imienia');
SELECT results_eq(
  format('SELECT slug FROM public.club_mention_members(%L, %L)', current_setting('test.k1'), '@ANNA'),
  $$VALUES ('anna-autorka-kom'::text)$$,
  'wiodacy @ i wielkosc liter nie przeszkadzaja');
SELECT ok(
  (SELECT bool_and(kind = 'person' AND logo_url IS NULL AND website IS NULL AND label IS NOT NULL)
     FROM public.club_mention_members(current_setting('test.k1')::uuid)),
  'ksztalt wiersza jak search_mention_targets (kind person, bez logo i www)');
SELECT is_empty(
  format('SELECT * FROM public.club_mention_members(%L, %L)', current_setting('test.k1'), '%'),
  'fraza nie jest wzorcem LIKE: %% nie pasuje do wszystkich');
SELECT is(
  (SELECT count(*)::int FROM public.club_mention_members(current_setting('test.k1')::uuid, NULL, 1)),
  1, 'p_limit respektowany');

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000006"}', true);
SELECT is_empty(
  format('SELECT * FROM public.club_mention_members(%L)', current_setting('test.k1')),
  'osoba bez prawa do listy czlonkow dostaje pusty zbior');

-- ----------------------------------------------------------------------------
-- 11. club_post_create: walidacja zalacznikow-linkow
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000002"}', true);
SELECT throws_ok(
  format('SELECT * FROM public.club_post_create(%L, NULL, NULL, %L, %L::jsonb)',
         current_setting('test.k1'), 'Link',
         '[{"type":"link","url":"http://example.org/x","title":"T"}]'),
  '22023', 'clubs: invalid link attachment', 'zalacznik-link spoza https odrzucony');

SELECT set_config('test.p5', (SELECT post_id::text FROM public.club_post_create(
  current_setting('test.k1')::uuid, NULL, NULL, 'Link poprawny',
  '[{"type":"link","url":"https://example.org/x","title":"T","tracker":"x"},{"type":"file","path":"u/x.pdf","name":"x.pdf"}]'::jsonb)), true);
SELECT is(
  (SELECT attachments->0 FROM public.club_posts WHERE id = current_setting('test.p5')::uuid),
  '{"type":"link","url":"https://example.org/x","title":"T","description":null,"image":null,"siteName":null}'::jsonb,
  'zalacznik-link zapisany w postaci kanonicznej (obcy klucz pominiety)');
SELECT is(
  (SELECT attachments->1 FROM public.club_posts WHERE id = current_setting('test.p5')::uuid),
  '{"type":"file","path":"u/x.pdf","name":"x.pdf"}'::jsonb,
  'zalaczniki innych typow bez zmian');

SELECT * FROM finish();
ROLLBACK;
