-- ============================================================================
-- pgTAP: komentarze wpisów ściany klubu, @wzmianki we wpisach i komentarzach,
-- podpowiedzi członków klubu i walidacja migawek linków
-- (migracje 20261007100000 i 20261007100100).
--
-- Plik przybija kontrakt na PEŁNYM schemacie:
--   1. struktura i granty: tabela bez grantów klienckich (RLS bez polityk),
--      lista dla anon, zapis i moderacja dla authenticated, pomocnicy tylko
--      service_role, pseudonim z `extensions` na search_path (pgcrypto);
--   2. `club_post_comment_create`: logowanie, prawo `can_reply`, wpis
--      opublikowany, treść 1..3000, migawka linku (tylko https, długości,
--      normalizacja do pięciu kluczy, bez znaków sterujących), limity 5/min
--      i 60/24 h;
--   3. `club_post_comments_list`: najnowsze pierwsze, kursor keyset,
--      `total_count` bez kursora, `can_manage`, pusty zbiór dla nieczytającego;
--   4. premoderacja: pending widzi autor i moderacja, licznik go nie liczy,
--      wzmianka z kolejki nie wychodzi, `can_approve` tylko dla moderacji;
--      4b. `club_post_comment_moderate`: zatwierdzenie (powiadomienie autora
--      wpisu i wzmianki dopiero teraz), ukrycie, przywrócenie bez drugiego
--      powiadomienia, dziennik moderacji (cel `post_comment`);
--   5. `club_posts_list`: `comment_count` i `can_comment` (obserwator czyta,
--      ale nie komentuje);
--   6. `club_post_comment_delete`: autor, moderacja (z wpisem w dzienniku),
--      odmowa, idempotencja;
--   7. Chatham House: autor ukryty, pseudonim per wpis; 7b. działy: tryb
--      atrybucji działu, zamrożony dział tylko do odczytu w strumieniu;
--   8. powiadomienia: autor wpisu (bez nazwiska w chatham, nie dla pending),
--      wzmianki w komentarzu i we wpisie z bramką odbiorców - osoba spoza
--      klubu prywatnego NIE dostaje powiadomienia; 8b. klub secret nie
--      emituje zdarzeń ani wzmianek;
--   9. `club_mention_visible_to` liczy prawo ODBIORCY, nie autora (osłona
--      `club_capabilities` podmienia cudze konto na wołającego - stąd
--      `club_user_can_read`) - dla wpisów, komentarzy, wątków i odpowiedzi;
--  10. `club_mention_members`: bramka, odnajdywalność, aktywne członkostwo,
--      najemca klubu, bez wołającego, dopasowanie bez wzorca LIKE, kolejność
--      bez `last_read_at`;
--  11. `club_post_create`: biała lista typów załączników, element `type=link`
--      walidowany i normalizowany;
--  12. klub publiczny: gość i osoba spoza klubu nie czytają działu
--      zamkniętego (strumień, komentarze), gość widzi tylko `visible`;
--  13. wpis usunięty: bez nowych komentarzy i bez listy;
--  14. autor wpisu bez prawa odczytu nie dostaje powiadomienia;
--  15. `club_post_create`: limity 10/min i 30/24 h;
--  16. `club_user_can_read`: gałęzie i parytet z `club_capabilities.can_read`.
--
-- Wywołania idą rolą właściciela z tożsamością w `request.jwt.claims` - jak
-- w `club_cover_write_capabilities_test.sql`: funkcje są SECURITY DEFINER
-- i rozstrzygają wołającego z JWT. Wewnątrz transakcji `now()` jest stałe,
-- więc kolejność, okna limitów i 5-minutową deduplikację powiadomień
-- (`enqueue_notification`: osoba, rodzaj, adres) ustawiamy jawnie,
-- przesuwając `created_at`.
-- ============================================================================
BEGIN;
SELECT plan(153);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- Domena najemcy: gość czyta klub publiczny po hoście (sekcja 12).
INSERT INTO public.tenants (id, name, slug, domain)
VALUES ('c9c00000-0000-0000-0000-0000000000a0', 'Tenant komentarzy', 'tenant-club-post-comments-test', 'kom.pgtap.test')
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
    ('c9000000-0000-0000-0000-000000000004'::uuid, 'moderator'),
    ('c9000000-0000-0000-0000-000000000005'::uuid, 'member')
  ) AS m(uid, role);

-- Trzy działy k1: otwarty, Chatham House w klubie jawnym i (po wpisach)
-- zamrożony - wszystkie dotąd sprawdzane ścieżki szły wyłącznie przez ścianę
-- klubu (`group_id` NULL).
SELECT set_config('test.g_open', public.admin_club_group_upsert(jsonb_build_object(
  'club_id', current_setting('test.k1'), 'slug', 'kom-g-open', 'name_pl', 'Otwarta', 'status', 'active'))::text, true);
SELECT set_config('test.g_ch', public.admin_club_group_upsert(jsonb_build_object(
  'club_id', current_setting('test.k1'), 'slug', 'kom-g-chatham', 'name_pl', 'Chatham', 'status', 'active',
  'attribution_mode', 'chatham'))::text, true);
SELECT set_config('test.g_fr', public.admin_club_group_upsert(jsonb_build_object(
  'club_id', current_setting('test.k1'), 'slug', 'kom-g-frozen', 'name_pl', 'Zamrozona', 'status', 'active'))::text, true);

-- Wpisy autorki: P1 (k1), PF (k1, pod limity tempa), P2 (k2), P3 (k3) oraz
-- po jednym w każdym dziale k1.
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000002"}', true);
SELECT set_config('test.p1', (SELECT post_id::text FROM public.club_post_create(
  current_setting('test.k1')::uuid, NULL, NULL, 'Wpis testowy', '[]'::jsonb)), true);
SELECT set_config('test.pf', (SELECT post_id::text FROM public.club_post_create(
  current_setting('test.k1')::uuid, NULL, NULL, 'Wpis pod serie', '[]'::jsonb)), true);
SELECT set_config('test.p2', (SELECT post_id::text FROM public.club_post_create(
  current_setting('test.k2')::uuid, NULL, NULL, 'Wpis pod regula Chatham House', '[]'::jsonb)), true);
SELECT set_config('test.p3', (SELECT post_id::text FROM public.club_post_create(
  current_setting('test.k3')::uuid, NULL, NULL, 'Wpis w klubie z premoderacja', '[]'::jsonb)), true);
SELECT set_config('test.pgo', (SELECT post_id::text FROM public.club_post_create(
  current_setting('test.k1')::uuid, current_setting('test.g_open')::uuid, NULL, 'Wpis w dziale otwartym', '[]'::jsonb)), true);
SELECT set_config('test.pgc', (SELECT post_id::text FROM public.club_post_create(
  current_setting('test.k1')::uuid, current_setting('test.g_ch')::uuid, NULL, 'Wpis w dziale chatham', '[]'::jsonb)), true);
SELECT set_config('test.pgf', (SELECT post_id::text FROM public.club_post_create(
  current_setting('test.k1')::uuid, current_setting('test.g_fr')::uuid, NULL, 'Wpis w dziale zamrozonym', '[]'::jsonb)), true);
-- Limit wpisów (10/min na autora) liczy też fikstury: cofamy je o kilka
-- minut, żeby dalsze sekcje nie zależały od tego, ile wpisów powstało wyżej.
UPDATE public.club_posts SET created_at = now() - interval '5 minutes'
 WHERE author_id = 'c9000000-0000-0000-0000-000000000002';

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000001"}', true);
SELECT public.admin_club_group_upsert(jsonb_build_object('id', current_setting('test.g_fr'), 'status', 'frozen'));

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
    AND NOT has_function_privilege('anon', 'public.club_post_comment_moderate(uuid,text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.club_mention_members(uuid,text,integer)', 'EXECUTE'),
  'anon nie pisze, nie usuwa, nie moderuje i nie listuje czlonkow');

SELECT ok(
  has_function_privilege('authenticated', 'public.club_post_comment_create(uuid,text,jsonb)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.club_post_comment_delete(uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.club_post_comment_moderate(uuid,text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.club_mention_members(uuid,text,integer)', 'EXECUTE'),
  'authenticated pisze, usuwa, moderuje (prawo sprawdza cialo) i pyta o podpowiedzi czlonkow');

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

SELECT ok(
  EXISTS (SELECT 1 FROM pg_indexes
           WHERE schemaname = 'public' AND tablename = 'club_posts'
             AND indexname = 'club_posts_author_recent_idx'),
  'indeks (author_id, created_at) pod limity tempa wpisow');

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

-- Znaki sterujące (C0, DEL, C1 - np. U+0085) wypadają z tekstów migawki,
-- a w adresie dają odrzucenie; U+0000 nie przechodzi już przez `jsonb`.
SELECT is(
  public.club_link_snapshot_normalize(jsonb_build_object(
    'url', 'https://example.org/s', 'title', 'A' || chr(7) || 'B',
    'description', chr(1) || chr(31), 'siteName', 'X' || chr(127) || chr(133))),
  '{"url":"https://example.org/s","title":"AB","description":null,"image":null,"siteName":"X"}'::jsonb,
  'migawka: znaki sterujace usuniete z tekstow (sam znak sterujacy = null)');
SELECT ok(
  public.club_link_snapshot_normalize(jsonb_build_object('url', 'https://example.org/a' || chr(133) || 'b')) IS NULL
    AND public.club_link_snapshot_normalize(jsonb_build_object(
          'url', 'https://example.org/a', 'image', 'https://example.org/i' || chr(1) || '.png')) IS NULL,
  'migawka: znak sterujacy w adresie lub obrazie odrzuca migawke');

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
  (SELECT bool_and(can_manage) AND NOT bool_or(can_approve)
     FROM public.club_post_comments_list(current_setting('test.p1')::uuid, 10)),
  'moderator zarzadza kazdym komentarzem; widoczne nie czekaja na zatwierdzenie');

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

-- Wzmianka w komentarzu z kolejki: adresat nie zobaczylby tresci, a moderacja
-- nie moglaby juz cofnac powiadomienia.
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000005"}', true);
SELECT set_config('test.cm', (SELECT comment_id::text FROM public.club_post_comment_create(
  current_setting('test.p3')::uuid, 'Prosze o opinie, @marek-moderator-kom')), true);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.notifications
               WHERE user_id = 'c9000000-0000-0000-0000-000000000004'
                 AND href = '/club/kom-test-pre?post=' || current_setting('test.p3')
                 AND title_pl LIKE '%wspomniał(a) o Tobie'),
  'wzmianka w komentarzu pending nie powiadamia');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.cross_references
               WHERE source_type = 'club_post_comment' AND source_id = current_setting('test.cm')),
  'wzmianka w komentarzu pending nie zapisuje krawedzi');

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000004"}', true);
SELECT is(
  (SELECT comment_status FROM public.club_post_comment_create(current_setting('test.p3')::uuid, 'Glos moderatora')),
  'visible', 'moderator omija kolejke');
SELECT is(
  (SELECT count(*)::int FROM public.club_post_comments_list(current_setting('test.p3')::uuid, 10)),
  3, 'moderator widzi komentarze pending');
SELECT ok(
  (SELECT bool_and(can_approve = (status = 'pending')) AND count(*) FILTER (WHERE can_approve) = 2
     FROM public.club_post_comments_list(current_setting('test.p3')::uuid, 10)),
  'moderator: can_approve dokladnie dla komentarzy pending');

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000003"}', true);
SELECT ok(
  EXISTS (SELECT 1 FROM public.club_post_comments_list(current_setting('test.p3')::uuid, 10)
           WHERE id = current_setting('test.c5')::uuid AND status = 'pending'),
  'autor widzi wlasny komentarz pending');
SELECT ok(
  (SELECT can_manage AND NOT can_approve
     FROM public.club_post_comments_list(current_setting('test.p3')::uuid, 10)
    WHERE id = current_setting('test.c5')::uuid),
  'autor komentarza pending: moze usunac, nie moze zatwierdzic');

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000002"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.club_post_comments_list(current_setting('test.p3')::uuid, 10)),
  1, 'inny czlonek nie widzi cudzego komentarza pending');
SELECT is(
  (SELECT comment_count::int FROM public.club_posts_list(current_setting('test.k3')::uuid)
    WHERE id = current_setting('test.p3')::uuid),
  1, 'comment_count nie liczy komentarza pending');

-- ----------------------------------------------------------------------------
-- 4b. Moderacja komentarza: zatwierdzenie, ukrycie, przywrocenie
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000003"}', true);
SELECT throws_ok(
  format('SELECT public.club_post_comment_moderate(%L::uuid, %L)', current_setting('test.c5'), 'approve'),
  '42501', 'clubs: forbidden', 'czlonek nie zatwierdza (takze wlasnego komentarza)');

SELECT set_config('request.jwt.claims', '', true);
SELECT throws_ok(
  format('SELECT public.club_post_comment_moderate(%L::uuid, %L)', current_setting('test.c5'), 'approve'),
  '42501', 'clubs: authentication required', 'niezalogowany nie moderuje');

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000004"}', true);
SELECT throws_ok(
  format('SELECT public.club_post_comment_moderate(%L::uuid, %L)', current_setting('test.c5'), 'publish'),
  '22023', 'clubs: invalid moderation action', 'nieznana akcja moderacji odrzucona');

-- Autorka dostala juz sygnal o komentarzu moderatora pod P3, a deduplikacja
-- (osoba, rodzaj, adres) trwa 5 minut - cofamy go, zeby zatwierdzenie mialo
-- czym sie wykazac.
UPDATE public.notifications SET created_at = now() - interval '10 minutes'
 WHERE user_id = 'c9000000-0000-0000-0000-000000000002'
   AND href = '/club/kom-test-pre?post=' || current_setting('test.p3');

SELECT is(public.club_post_comment_moderate(current_setting('test.c5')::uuid, 'approve'), true,
  'moderator zatwierdza komentarz z kolejki');
SELECT is(
  (SELECT status FROM public.club_post_comments WHERE id = current_setting('test.c5')::uuid),
  'visible', 'zatwierdzony komentarz jest visible');
SELECT ok(
  EXISTS (SELECT 1 FROM public.notifications
           WHERE user_id = 'c9000000-0000-0000-0000-000000000002'
             AND href = '/club/kom-test-pre?post=' || current_setting('test.p3')
             AND created_at = now()
             AND title_pl = 'Celina Komentujaca skomentował(a) Twój wpis'),
  'zatwierdzenie z kolejki powiadamia autorke wpisu');
SELECT is(public.club_post_comment_moderate(current_setting('test.c5')::uuid, 'approve'), false,
  'ponowne zatwierdzenie: false, bez zmiany');
SELECT ok(
  EXISTS (SELECT 1 FROM public.club_moderation_log
           WHERE target_type = 'post_comment' AND target_id = current_setting('test.c5')::uuid
             AND action = 'approve' AND moderator_id = 'c9000000-0000-0000-0000-000000000004'
             AND club_id = current_setting('test.k3')::uuid),
  'zatwierdzenie w dzienniku moderacji (cel post_comment)');

SELECT is(public.club_post_comment_moderate(current_setting('test.cm')::uuid, 'approve'), true,
  'moderator zatwierdza komentarz ze wzmianka');
SELECT ok(
  EXISTS (SELECT 1 FROM public.notifications
           WHERE user_id = 'c9000000-0000-0000-0000-000000000004'
             AND href = '/club/kom-test-pre?post=' || current_setting('test.p3')
             AND title_pl = 'Olga Obserwatorka wspomniał(a) o Tobie')
    AND EXISTS (SELECT 1 FROM public.cross_references
                 WHERE source_type = 'club_post_comment' AND source_id = current_setting('test.cm')
                   AND target_id = 'c9000000-0000-0000-0000-000000000004'
                   AND created_by = 'c9000000-0000-0000-0000-000000000005'),
  'wzmianka z kolejki wychodzi dopiero po zatwierdzeniu (aktor = autor komentarza)');
SELECT ok(
  (SELECT count(*) = 1 AND bool_and(payload->>'status' = 'pending')
     FROM public.domain_events
    WHERE aggregate_type = 'club_post_comment' AND aggregate_id = current_setting('test.cm')
      AND event_type = 'club_post_comment.created.v1'),
  'zdarzenie created.v1 powstaje raz, przy zapisie (ze statusem pending)');

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000002"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.club_post_comments_list(current_setting('test.p3')::uuid, 10)),
  3, 'zatwierdzone komentarze widzi kazdy czlonek');
SELECT is(
  (SELECT comment_count::int FROM public.club_posts_list(current_setting('test.k3')::uuid)
    WHERE id = current_setting('test.p3')::uuid),
  3, 'comment_count liczy zatwierdzone komentarze');

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000004"}', true);
SELECT is(public.club_post_comment_moderate(current_setting('test.c5')::uuid, 'hide'), true,
  'moderator ukrywa widoczny komentarz');
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000002"}', true);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.club_post_comments_list(current_setting('test.p3')::uuid, 10)
               WHERE id = current_setting('test.c5')::uuid),
  'ukryty komentarz znika z listy czlonka');

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000004"}', true);
UPDATE public.notifications SET created_at = now() - interval '10 minutes'
 WHERE user_id = 'c9000000-0000-0000-0000-000000000002'
   AND href = '/club/kom-test-pre?post=' || current_setting('test.p3');
SELECT is(public.club_post_comment_moderate(current_setting('test.c5')::uuid, 'approve'), true,
  'ukryty komentarz mozna przywrocic');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.notifications
               WHERE user_id = 'c9000000-0000-0000-0000-000000000002'
                 AND href = '/club/kom-test-pre?post=' || current_setting('test.p3')
                 AND created_at = now()),
  'przywrocenie ukrytego komentarza nie powiadamia drugi raz');
SELECT is(
  (SELECT array_agg(action ORDER BY action) FROM public.club_moderation_log
    WHERE target_type = 'post_comment' AND target_id = current_setting('test.c5')::uuid),
  ARRAY['approve', 'approve', 'hide'],
  'kazda zmiana stanu ma wpis w dzienniku, wywolanie bez zmiany - nie');
SELECT is(public.club_post_comment_moderate('c9e00000-0000-0000-0000-00000000dead'::uuid, 'hide'), false,
  'nieistniejacy komentarz: false');

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
SELECT ok(
  EXISTS (SELECT 1 FROM public.club_moderation_log
           WHERE target_type = 'post_comment' AND target_id = current_setting('test.c4')::uuid
             AND action = 'delete' AND moderator_id = 'c9000000-0000-0000-0000-000000000004')
    AND NOT EXISTS (SELECT 1 FROM public.club_moderation_log
                     WHERE target_id = current_setting('test.c1')::uuid),
  'usuniecie cudzego komentarza trafia do dziennika, wlasnego - nie');
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
-- 7b. Dzialy: can_comment per dzial wpisu, tryb atrybucji dzialu
--     (czlonek 008 nie ma wczesniejszych komentarzy - limity innych bez zmian)
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000008"}', true);
SELECT ok(
  (SELECT count(*) = 4
          AND bool_and(CASE WHEN id = current_setting('test.pgf')::uuid THEN NOT can_comment ELSE can_comment END)
     FROM public.club_posts_list(current_setting('test.k1')::uuid, NULL, NULL, 50)
    WHERE id IN (current_setting('test.p1')::uuid, current_setting('test.pgo')::uuid,
                 current_setting('test.pgc')::uuid, current_setting('test.pgf')::uuid)),
  'can_comment per dzial wpisu: sciana, dzial otwarty i chatham tak, zamrozony nie');
SELECT throws_ok(
  format('SELECT * FROM public.club_post_comment_create(%L, %L)', current_setting('test.pgf'), 'x'),
  '42501', 'clubs: forbidden', 'zamrozony dzial: komentarz odrzucony mimo can_reply w klubie');
SELECT set_config('test.cgc', (SELECT comment_id::text FROM public.club_post_comment_create(
  current_setting('test.pgc')::uuid, 'Glos w dziale chatham')), true);
SELECT ok(
  (SELECT author_id IS NULL AND author_name IS NULL AND author_slug IS NULL AND author_alias IS NOT NULL
     FROM public.club_post_comments_list(current_setting('test.pgc')::uuid)
    WHERE id = current_setting('test.cgc')::uuid),
  'dzial chatham w klubie jawnym: autor komentarza ukryty (tryb dzial -> klub)');
SELECT is(
  (SELECT title_pl FROM public.notifications
    WHERE user_id = 'c9000000-0000-0000-0000-000000000002'
      AND href = '/club/kom-test-private?post=' || current_setting('test.pgc')),
  'Uczestnik dyskusji skomentował(a) Twój wpis',
  'dzial chatham: powiadomienie autorki bez nazwiska komentujacego');

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
-- 8b. Klub secret: wpis i komentarz nie emituja zdarzen ani wzmianek
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000001"}', true);
SELECT set_config('test.k4', public.admin_club_upsert(
  '{"slug":"kom-test-secret","name_pl":"Tajny","visibility":"secret","status":"active"}'::jsonb)::text, true);
SELECT public.admin_club_member_upsert(current_setting('test.k4')::uuid, m.uid, 'member', 'active', NULL)
  FROM (VALUES ('c9000000-0000-0000-0000-000000000003'::uuid),
               ('c9000000-0000-0000-0000-000000000004'::uuid),
               ('c9000000-0000-0000-0000-000000000005'::uuid)) AS m(uid);
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000004"}', true);
SELECT set_config('test.pk4', (SELECT post_id::text FROM public.club_post_create(
  current_setting('test.k4')::uuid, NULL, NULL, 'Tajna narada, @celina-kom', '[]'::jsonb)), true);
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000005"}', true);
SELECT set_config('test.ck4', (SELECT comment_id::text FROM public.club_post_comment_create(
  current_setting('test.pk4')::uuid, 'Zgoda, @celina-kom')), true);

SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.domain_events
               WHERE aggregate_type = 'club_post_comment' AND aggregate_id = current_setting('test.ck4')),
  'klub secret: komentarz nie emituje zdarzenia na szynie');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.notifications
               WHERE user_id = 'c9000000-0000-0000-0000-000000000003'
                 AND href = '/club/kom-test-secret?post=' || current_setting('test.pk4'))
    AND NOT EXISTS (SELECT 1 FROM public.cross_references
                     WHERE source_id IN (current_setting('test.pk4'), current_setting('test.ck4'))),
  'klub secret: wzmianki we wpisie i komentarzu bez powiadomienia i bez krawedzi');
SELECT is(
  (SELECT title_pl FROM public.notifications
    WHERE user_id = 'c9000000-0000-0000-0000-000000000004'
      AND href = '/club/kom-test-secret?post=' || current_setting('test.pk4')),
  'Olga Obserwatorka skomentował(a) Twój wpis',
  'klub secret: autor wpisu (czlonek) dostaje powiadomienie o komentarzu');

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

-- 9b. Watki i odpowiedzi ida przez ta sama bramke odbiorcy. Watek zaklada
-- moderator (klub domyslnie: who_can_post = moderators), odpowiada czlonkini.
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000004"}', true);
SELECT set_config('test.t1', (SELECT id::text FROM public.club_create_thread(
  current_setting('test.g_open')::uuid, 'Watek ze wzmiankami',
  'Pytanie do @olga-obs-kom i @oskar-obcy-kom w dziale otwartym.', 'discussion', false)), true);
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000003"}', true);
SELECT set_config('test.r1', (SELECT reply_id::text FROM public.club_reply(
  current_setting('test.t1')::uuid, 'Dorzucam pytanie do @oskar-obcy-kom', NULL, false)), true);
SELECT ok(
  NOT public.club_mention_visible_to('club_thread', current_setting('test.t1'), 'c9000000-0000-0000-0000-000000000006')
    AND public.club_mention_visible_to('club_thread', current_setting('test.t1'), 'c9000000-0000-0000-0000-000000000005'),
  'watek: obcy nie, obserwator klubu tak (prawo odbiorcy)');
SELECT ok(
  NOT public.club_mention_visible_to('club_reply', current_setting('test.r1'), 'c9000000-0000-0000-0000-000000000006')
    AND public.club_mention_visible_to('club_reply', current_setting('test.r1'), 'c9000000-0000-0000-0000-000000000004'),
  'odpowiedz: obcy nie, moderator tak (prawo odbiorcy, galaz JOIN watku)');
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.notifications
               WHERE user_id = 'c9000000-0000-0000-0000-000000000006' AND kind = 'club')
    AND EXISTS (SELECT 1 FROM public.notifications
                 WHERE user_id = 'c9000000-0000-0000-0000-000000000005' AND kind = 'club'
                   AND title_pl = 'Marek Moderator wspomniał(a) o Tobie'
                   AND href LIKE '/club/kom-test-private/t/%'),
  'wzmianka w watku: czlonek klubu powiadomiony, osoba spoza klubu prywatnego nie');

-- ----------------------------------------------------------------------------
-- 10. club_mention_members
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000003"}', true);

-- Czlonkowie nieaktywni i profil z obcego najemcy nie moga trafic do
-- podpowiedzi. Wstawiamy wprost (rola wlasciciela): admin_club_member_upsert
-- odrzuca obcego najemce; trigger przypina club_members.tenant_id z klubu.
INSERT INTO public.tenants (id, name, slug)
VALUES ('c9c00000-0000-0000-0000-0000000000b0', 'Obcy tenant komentarzy', 'tenant-club-post-comments-other')
ON CONFLICT (id) DO NOTHING;
INSERT INTO auth.users (id, email)
VALUES ('c9000000-0000-0000-0000-000000000009', 'kom-banned@kom.test'),
       ('c9000000-0000-0000-0000-00000000000a', 'kom-left@kom.test'),
       ('c9000000-0000-0000-0000-00000000000b', 'kom-foreign@kom.test')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.profiles (id, tenant_id, display_name, slug, discoverable)
VALUES ('c9000000-0000-0000-0000-000000000009', 'c9c00000-0000-0000-0000-0000000000a0', 'Bogdan Zbanowany', 'bogdan-ban-kom', true),
       ('c9000000-0000-0000-0000-00000000000a', 'c9c00000-0000-0000-0000-0000000000a0', 'Lena Odeszla', 'lena-left-kom', true),
       ('c9000000-0000-0000-0000-00000000000b', 'c9c00000-0000-0000-0000-0000000000b0', 'Franek Obcy Tenant', 'franek-tenant-kom', true);
INSERT INTO public.club_members (club_id, user_id, role, status)
VALUES (current_setting('test.k1')::uuid, 'c9000000-0000-0000-0000-000000000009', 'member', 'banned'),
       (current_setting('test.k1')::uuid, 'c9000000-0000-0000-0000-00000000000a', 'member', 'left'),
       (current_setting('test.k1')::uuid, 'c9000000-0000-0000-0000-00000000000b', 'member', 'active');

SELECT set_eq(
  format('SELECT slug FROM public.club_mention_members(%L, NULL, 20)', current_setting('test.k1')),
  $$VALUES ('anna-autorka-kom'::text), ('marek-moderator-kom'), ('olga-obs-kom'), ('bartek-seria-kom')$$,
  'aktywni, odnajdywalni czlonkowie z najemcy klubu - bez wolajacego, profilu ukrytego, zbanowanego, odchodzacego i obcego najemcy');
SELECT results_eq(
  format('SELECT slug FROM public.club_mention_members(%L, NULL, 20)', current_setting('test.k1')),
  $$VALUES ('anna-autorka-kom'::text), ('bartek-seria-kom'), ('marek-moderator-kom'), ('olga-obs-kom')$$,
  'pusta fraza: alfabetycznie');
-- last_read_at to prywatny stan czytania - kolejnosc nie moze go zdradzac.
UPDATE public.club_members SET last_read_at = now()
 WHERE club_id = current_setting('test.k1')::uuid AND user_id = 'c9000000-0000-0000-0000-000000000005';
UPDATE public.club_members SET last_read_at = now() - interval '1 year'
 WHERE club_id = current_setting('test.k1')::uuid AND user_id = 'c9000000-0000-0000-0000-000000000002';
SELECT results_eq(
  format('SELECT slug FROM public.club_mention_members(%L, NULL, 20)', current_setting('test.k1')),
  $$VALUES ('anna-autorka-kom'::text), ('bartek-seria-kom'), ('marek-moderator-kom'), ('olga-obs-kom')$$,
  'kolejnosc nie zalezy od last_read_at');
SELECT results_eq(
  format('SELECT slug FROM public.club_mention_members(%L, %L)', current_setting('test.k1'), 'o'),
  $$VALUES ('olga-obs-kom'::text), ('anna-autorka-kom'), ('bartek-seria-kom'), ('marek-moderator-kom')$$,
  'trafienie od poczatku pierwsze, reszta alfabetycznie');
SELECT results_eq(
  format('SELECT slug FROM public.club_mention_members(%L, %L)', current_setting('test.k1'), 'ser'),
  $$VALUES ('bartek-seria-kom'::text), ('olga-obs-kom')$$,
  'poczatek slowa przed trafieniem w srodku');
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
-- 11. club_post_create: walidacja zalacznikow
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000002"}', true);
SELECT throws_ok(
  format('SELECT * FROM public.club_post_create(%L, NULL, NULL, %L, %L::jsonb)',
         current_setting('test.k1'), 'Link',
         '[{"type":"link","url":"http://example.org/x","title":"T"}]'),
  '22023', 'clubs: invalid link attachment', 'zalacznik-link spoza https odrzucony');
-- Klient przycina typ przed odczytem - typ z bialym znakiem nie moze omijac
-- walidacji linku, a element spoza ksztaltu klienta nie trafia do bazy.
SELECT throws_ok(
  format('SELECT * FROM public.club_post_create(%L, NULL, NULL, %L, %L::jsonb)',
         current_setting('test.k1'), 'Link',
         '[{"type":"link ","url":"http://example.org/x"}]'),
  '22023', 'club_post_create: invalid attachment', 'typ z bialym znakiem nie omija walidacji linku');
SELECT throws_ok(
  format('SELECT * FROM public.club_post_create(%L, NULL, NULL, %L, %L::jsonb)',
         current_setting('test.k1'), 'Link', '["https://example.org/x"]'),
  '22023', 'club_post_create: invalid attachment', 'element, ktory nie jest obiektem, odrzucony');

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

-- ----------------------------------------------------------------------------
-- 12. Klub publiczny: gosc i osoba spoza klubu a dzial zamkniety
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000001"}', true);
SELECT set_config('test.k5', public.admin_club_upsert(
  '{"slug":"kom-test-public","name_pl":"Publiczny","visibility":"public","status":"active","moderation_mode":"pre"}'::jsonb)::text, true);
SELECT public.admin_club_member_upsert(current_setting('test.k5')::uuid, m.uid, m.role, 'active', NULL)
  FROM (VALUES
    ('c9000000-0000-0000-0000-000000000004'::uuid, 'moderator'),
    ('c9000000-0000-0000-0000-000000000005'::uuid, 'member')
  ) AS m(uid, role);
SELECT set_config('test.g5p', public.admin_club_group_upsert(jsonb_build_object(
  'club_id', current_setting('test.k5'), 'slug', 'kom-pub-private', 'name_pl', 'Zamknieta',
  'status', 'active', 'visibility', 'private'))::text, true);
SELECT set_config('test.g5m', public.admin_club_group_upsert(jsonb_build_object(
  'club_id', current_setting('test.k5'), 'slug', 'kom-pub-members', 'name_pl', 'Dla zalogowanych',
  'status', 'active', 'visibility', 'members'))::text, true);
SELECT set_config('test.g5o', public.admin_club_group_upsert(jsonb_build_object(
  'club_id', current_setting('test.k5'), 'slug', 'kom-pub-open', 'name_pl', 'Otwarta', 'status', 'active'))::text, true);
SELECT set_config('test.g5d', public.admin_club_group_upsert(jsonb_build_object(
  'club_id', current_setting('test.k5'), 'slug', 'kom-pub-draft', 'name_pl', 'Robocza', 'status', 'draft'))::text, true);

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000004"}', true);
SELECT set_config('test.pw', (SELECT post_id::text FROM public.club_post_create(
  current_setting('test.k5')::uuid, NULL, NULL, 'Wpis na scianie publicznej', '[]'::jsonb)), true);
SELECT set_config('test.pz', (SELECT post_id::text FROM public.club_post_create(
  current_setting('test.k5')::uuid, current_setting('test.g5p')::uuid, NULL, 'Wpis w dziale zamknietym', '[]'::jsonb)), true);
SELECT set_config('test.cw', (SELECT comment_id::text FROM public.club_post_comment_create(
  current_setting('test.pw')::uuid, 'Widoczny dla gosci')), true);
SELECT set_config('test.cz', (SELECT comment_id::text FROM public.club_post_comment_create(
  current_setting('test.pz')::uuid, 'Za zamknietymi drzwiami')), true);
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000005"}', true);
SELECT set_config('test.cq', (SELECT comment_id::text FROM public.club_post_comment_create(
  current_setting('test.pw')::uuid, 'W kolejce')), true);

SELECT ok(
  (SELECT comment_count = 1 FROM public.club_posts_list(current_setting('test.k5')::uuid)
    WHERE id = current_setting('test.pz')::uuid),
  'czlonek klubu czyta wpis z dzialu zamknietego');

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000006"}', true);
SELECT ok(
  EXISTS (SELECT 1 FROM public.club_posts_list(current_setting('test.k5')::uuid)
           WHERE id = current_setting('test.pw')::uuid)
    AND NOT EXISTS (SELECT 1 FROM public.club_posts_list(current_setting('test.k5')::uuid)
                     WHERE id = current_setting('test.pz')::uuid),
  'osoba spoza klubu: strumien klubu bez wpisu z dzialu zamknietego');
SELECT is(
  (SELECT DISTINCT total_count::int FROM public.club_posts_list(current_setting('test.k5')::uuid)),
  1, 'osoba spoza klubu: total_count bez wpisow dzialu zamknietego');
SELECT is_empty(
  format('SELECT * FROM public.club_post_comments_list(%L)', current_setting('test.pz')),
  'osoba spoza klubu: komentarze dzialu zamknietego puste');

-- Gosc: bez JWT, klub publiczny czytany po hoscie najemcy.
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.headers', '{"x-tenant-host":"kom.pgtap.test"}', true);
SELECT ok(
  EXISTS (SELECT 1 FROM public.club_posts_list(current_setting('test.k5')::uuid)
           WHERE id = current_setting('test.pw')::uuid)
    AND NOT EXISTS (SELECT 1 FROM public.club_posts_list(current_setting('test.k5')::uuid)
                     WHERE id = current_setting('test.pz')::uuid),
  'gosc: strumien klubu publicznego bez wpisu z dzialu zamknietego');
SELECT is_empty(
  format('SELECT * FROM public.club_post_comments_list(%L)', current_setting('test.pz')),
  'gosc: komentarze dzialu zamknietego puste (club_capabilities sprawdza dzial)');
SELECT results_eq(
  format('SELECT body FROM public.club_post_comments_list(%L, 10)', current_setting('test.pw')),
  $$VALUES ('Widoczny dla gosci'::text)$$,
  'gosc: wylacznie komentarze visible (bez pending)');
SELECT ok(
  (SELECT NOT bool_or(can_manage OR can_approve) AND bool_and(total_count = 1)
     FROM public.club_post_comments_list(current_setting('test.pw')::uuid, 10)),
  'gosc: bez prawa usuwania i zatwierdzania, total_count tylko widocznych');
SELECT ok(
  (SELECT NOT can_comment AND comment_count = 1 FROM public.club_posts_list(current_setting('test.k5')::uuid)
    WHERE id = current_setting('test.pw')::uuid),
  'gosc: licznik komentarzy widoczny, can_comment = false');
SELECT ok(
  (SELECT NOT can_read AND reason = 'auth_required'
     FROM public.club_capabilities(current_setting('test.k5')::uuid, current_setting('test.g5p')::uuid, NULL))
    AND (SELECT NOT can_read
           FROM public.club_capabilities(current_setting('test.k5')::uuid, current_setting('test.g5m')::uuid, NULL))
    AND (SELECT NOT can_read AND reason = 'not_open_yet'
           FROM public.club_capabilities(current_setting('test.k5')::uuid, current_setting('test.g5d')::uuid, NULL))
    AND (SELECT can_read
           FROM public.club_capabilities(current_setting('test.k5')::uuid, current_setting('test.g5o')::uuid, NULL))
    AND (SELECT can_read FROM public.club_capabilities(current_setting('test.k5')::uuid, NULL, NULL)),
  'gosc: dzial z wlasna widocznoscia i roboczy niedostepne, dzial otwarty i sciana czytelne');
SELECT set_config('request.headers', '', true);

-- ----------------------------------------------------------------------------
-- 13. Wpis usuniety (status removed): bez nowych komentarzy i bez listy
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000002"}', true);
SELECT is(public.club_post_delete(current_setting('test.p1')::uuid), true,
  'autorka usuwa wpis P1 (status removed)');

SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000003"}', true);
SELECT throws_ok(
  format('SELECT * FROM public.club_post_comment_create(%L, %L)', current_setting('test.p1'), 'Za pozno'),
  'P0002', 'clubs: post not found', 'usuniety wpis: nowy komentarz odrzucony (post not found)');
SELECT is_empty(
  format('SELECT * FROM public.club_post_comments_list(%L, 10)', current_setting('test.p1')),
  'usuniety wpis: lista komentarzy pusta, choc komentarze visible istnieja');

-- ----------------------------------------------------------------------------
-- 14. Autorka wpisu bez prawa odczytu nie dostaje wycinka komentarza
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000001"}', true);
SELECT public.admin_club_member_upsert(
  current_setting('test.k1')::uuid, 'c9000000-0000-0000-0000-000000000002', 'member', 'banned', NULL);
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000008"}', true);
SELECT ok(
  (SELECT comment_status = 'visible' FROM public.club_post_comment_create(
     current_setting('test.p6')::uuid, 'Komentarz po banie autorki'))
    AND NOT EXISTS (SELECT 1 FROM public.notifications
                     WHERE user_id = 'c9000000-0000-0000-0000-000000000002'
                       AND href = '/club/kom-test-private?post=' || current_setting('test.p6')),
  'zbanowana autorka wpisu nie dostaje powiadomienia o komentarzu (club_user_can_read)');

-- ----------------------------------------------------------------------------
-- 15. club_post_create: limity tempa (osobny autor)
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000007"}', true);
DO $$
BEGIN
  FOR i IN 1..10 LOOP
    PERFORM * FROM public.club_post_create(
      current_setting('test.k1')::uuid, NULL, NULL, 'Seria wpisow ' || i, '[]'::jsonb);
  END LOOP;
END $$;
SELECT is(
  (SELECT count(*)::int FROM public.club_posts WHERE author_id = 'c9000000-0000-0000-0000-000000000007'),
  10, 'dziesiec wpisow w minucie przechodzi');
SELECT throws_ok(
  format('SELECT * FROM public.club_post_create(%L, NULL, NULL, %L, %L::jsonb)',
         current_setting('test.k1'), 'Jedenasty', '[]'),
  '42901', 'clubs: post burst limit', 'jedenasty wpis w minucie: burst limit');

-- Okno minuty puste, ale 30 wpisow w ciagu doby (wypelniacz jako 'removed':
-- usuniecie wpisu nie zwraca przydzialu).
UPDATE public.club_posts SET created_at = now() - interval '2 hours'
 WHERE author_id = 'c9000000-0000-0000-0000-000000000007';
INSERT INTO public.club_posts (tenant_id, club_id, author_id, body, status, created_at)
SELECT c.tenant_id, c.id, 'c9000000-0000-0000-0000-000000000007', 'Wypelniacz ' || g,
       'removed', now() - interval '3 hours'
  FROM public.clubs c, generate_series(1, 20) g
 WHERE c.id = current_setting('test.k1')::uuid;
SELECT throws_ok(
  format('SELECT * FROM public.club_post_create(%L, NULL, NULL, %L, %L::jsonb)',
         current_setting('test.k1'), 'Ponad dobe', '[]'),
  '42901', 'clubs: post rate limit', '30 wpisow w dobie (takze usunietych): rate limit');

-- ----------------------------------------------------------------------------
-- 16. club_user_can_read: galezie i parytet z club_capabilities.can_read
--
-- `club_user_can_read` jest RECZNA kopia galezi odczytu `club_capabilities`
-- (bez oslony przed sondowaniem). Parytet liczymy tam, gdzie obie funkcje
-- maja odpowiedziec to samo: pytany = wolajacy (k1 i k5 bez progu planu).
-- Zmiana reguly odczytu w jednej funkcji bez drugiej czerwieni te asercje.
-- ----------------------------------------------------------------------------
CREATE FUNCTION pg_temp.kom_read_parity(p_club uuid, p_groups uuid[], p_users uuid[])
RETURNS boolean
LANGUAGE plpgsql AS $f$
DECLARE
  v_group uuid;
  v_user  uuid;
  v_cap   boolean;
  v_ok    boolean := true;
BEGIN
  FOREACH v_group IN ARRAY p_groups LOOP
    FOREACH v_user IN ARRAY p_users LOOP
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
      SELECT cc.can_read INTO v_cap FROM public.club_capabilities(p_club, v_group, v_user) cc;
      IF public.club_user_can_read(p_club, v_group, v_user) IS DISTINCT FROM COALESCE(v_cap, false) THEN
        RAISE NOTICE 'rozjazd odczytu: klub %, dzial %, osoba %', p_club, v_group, v_user;
        v_ok := false;
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_ok;
END
$f$;

SELECT set_config('test.users', ARRAY[
  'c9000000-0000-0000-0000-000000000001', 'c9000000-0000-0000-0000-000000000002',
  'c9000000-0000-0000-0000-000000000003', 'c9000000-0000-0000-0000-000000000004',
  'c9000000-0000-0000-0000-000000000005', 'c9000000-0000-0000-0000-000000000006',
  'c9000000-0000-0000-0000-000000000008', 'c9000000-0000-0000-0000-000000000009',
  'c9000000-0000-0000-0000-00000000000a', 'c9000000-0000-0000-0000-00000000000b']::text, true);

SELECT ok(
  NOT public.club_user_can_read(current_setting('test.k1')::uuid, NULL, 'c9000000-0000-0000-0000-000000000009')
    AND NOT public.club_user_can_read(current_setting('test.k1')::uuid, NULL, 'c9000000-0000-0000-0000-00000000000a')
    AND NOT public.club_user_can_read(current_setting('test.k1')::uuid, NULL, 'c9000000-0000-0000-0000-00000000000b')
    AND public.club_user_can_read(current_setting('test.k1')::uuid, NULL, 'c9000000-0000-0000-0000-000000000001'),
  'club_user_can_read: zbanowany, odchodzacy i obcy najemca nie; administrator tak');

UPDATE public.club_groups SET status = 'draft' WHERE id = current_setting('test.g_open')::uuid;
SELECT ok(
  NOT public.club_user_can_read(current_setting('test.k1')::uuid, current_setting('test.g_open')::uuid,
                                'c9000000-0000-0000-0000-000000000004')
    AND public.club_user_can_read(current_setting('test.k1')::uuid, current_setting('test.g_open')::uuid,
                                  'c9000000-0000-0000-0000-000000000001')
    AND NOT public.club_mention_visible_to('club_thread', current_setting('test.t1'), 'c9000000-0000-0000-0000-000000000004')
    AND NOT public.club_mention_visible_to('club_reply', current_setting('test.r1'), 'c9000000-0000-0000-0000-000000000004'),
  'dzial roboczy: moderator klubu nie (takze dla wzmianek w watku i odpowiedzi), administrator tak');
SELECT set_config('request.jwt.claims', '{"sub":"c9000000-0000-0000-0000-000000000003"}', true);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM public.club_posts_list(current_setting('test.k1')::uuid, NULL, NULL, 50)
               WHERE id = current_setting('test.pgo')::uuid)
    AND EXISTS (SELECT 1 FROM public.club_posts_list(current_setting('test.k1')::uuid, NULL, NULL, 50)
                 WHERE id = current_setting('test.pgc')::uuid),
  'strumien klubu bez wpisu z dzialu roboczego (prawo odczytu dzialu wpisu)');
SELECT ok(
  pg_temp.kom_read_parity(current_setting('test.k1')::uuid,
    ARRAY[NULL, current_setting('test.g_open'), current_setting('test.g_ch'), current_setting('test.g_fr')]::uuid[],
    current_setting('test.users')::uuid[]),
  'parytet: klub prywatny - sciana, dzial roboczy, chatham i zamrozony');

UPDATE public.club_groups SET status = 'active', opens_at = now() + interval '1 day'
 WHERE id = current_setting('test.g_open')::uuid;
SELECT is(
  public.club_user_can_read(current_setting('test.k1')::uuid, current_setting('test.g_open')::uuid,
                            'c9000000-0000-0000-0000-000000000004'),
  false, 'dzial przed opens_at ukryty');

UPDATE public.clubs SET visibility = 'members' WHERE id = current_setting('test.k1')::uuid;
SELECT ok(
  pg_temp.kom_read_parity(current_setting('test.k1')::uuid,
    ARRAY[NULL, current_setting('test.g_open'), current_setting('test.g_fr')]::uuid[],
    current_setting('test.users')::uuid[]),
  'parytet: klub members - sciana, dzial przed opens_at i zamrozony');
UPDATE public.clubs SET visibility = 'secret' WHERE id = current_setting('test.k1')::uuid;
SELECT ok(
  pg_temp.kom_read_parity(current_setting('test.k1')::uuid,
    ARRAY[NULL, current_setting('test.g_ch')]::uuid[],
    current_setting('test.users')::uuid[]),
  'parytet: klub secret');
SELECT ok(
  pg_temp.kom_read_parity(current_setting('test.k5')::uuid,
    ARRAY[NULL, current_setting('test.g5p'), current_setting('test.g5m'),
          current_setting('test.g5o'), current_setting('test.g5d')]::uuid[],
    current_setting('test.users')::uuid[]),
  'parytet: klub publiczny z dzialami o roznej widocznosci');

SELECT * FROM finish();
ROLLBACK;
