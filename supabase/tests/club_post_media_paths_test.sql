-- ============================================================================
-- pgTAP: załącznik-plik wpisu ściany nie otwiera cudzego pliku
-- (migracja 20261026090000).
--
-- Do tej migracji `club_post_create` normalizował tylko element `type=link`,
-- a `image`/`video`/`file` szły do bazy z DOWOLNYM `path`. Polityka odczytu
-- kubełka `club-media` wpuszcza aktywnego członka klubu, w którego wpisie
-- ścieżka występuje (`club_media_path_readable`), więc wpis we własnym klubie
-- ze ścieżką `<uid ofiary>/<plik>` otwierał cudzy plik autorowi i wszystkim
-- członkom jego klubu.
--
-- Plik przybija kontrakt na PEŁNYM schemacie:
--   1. struktura i granty: normalizator tylko dla service_role, predykat
--      polityki dla authenticated (nie anon), polityka odczytu kubełka dalej
--      pyta predykat;
--   2. `club_post_media_normalize`: postać kanoniczna (siedem kluczy, obce
--      klucze odpadają, znaki sterujące z tekstów), granice i odrzucenia
--      (obcy katalog, zagnieżdżenie, `.`/`..`, znaki sterujące, długości,
--      typy pól);
--   3. `club_post_create`: zgłoszony scenariusz (obca ścieżka) dla każdego
--      typu pliku i obejść ścieżki odrzucony bez zapisu, własny plik zapisany
--      kanonicznie;
--   4. `club_media_path_readable`: wpis wstrzyknięty PRZED migracją (obca
--      ścieżka w jsonb) nie otwiera pliku ani autorowi, ani członkom jego
--      klubu; kontrole dodatnie (członek klubu wpisu czyta plik autora),
--      osoba spoza klubu, były członek, wpis usunięty, katalog nie-uuid bez
--      wyjątku w środku polityki; konto autora usunięte (`author_id` NULL
--      po ON DELETE SET NULL): jego pliki dalej otwarte dla klubu, a obca
--      ścieżka ŻYJĄCEGO użytkownika we wpisie bez autora - nie.
--
-- Stan po usunięciu konta jest tu SYMULOWANY (identyfikator spoza
-- `auth.users`, wpis z `author_id` NULL), bez `DELETE FROM auth.users`:
-- przedmiotem jest predykat, a kaskadę FK na żywo sprawdza sekcja CM harnessu.
--
-- Wykonanie polityki `storage.objects` z roli `authenticated` (SELECT jak
-- przy podpisywaniu adresu) żyje w `scripts/pg-harness/runtime_test.sql`
-- (sekcja CM): tam schemat storage jest atrapą harnessu, a przedmiotem tego
-- pliku jest predykat i RPC.
--
-- Wywołania idą rolą właściciela z tożsamością w `request.jwt.claims` - jak
-- w `club_post_comments_test.sql`: funkcje są SECURITY DEFINER i rozstrzygają
-- wołającego z JWT.
-- ============================================================================
BEGIN;
SELECT plan(33);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, name, slug)
VALUES ('c7d00000-0000-0000-0000-0000000000a0', 'Tenant plikow wpisow', 'tenant-club-media-paths-test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('c7000000-0000-0000-0000-000000000001', 'cm-admin@cm.test'),
       ('c7000000-0000-0000-0000-000000000002', 'cm-victim@cm.test'),
       ('c7000000-0000-0000-0000-000000000003', 'cm-attacker@cm.test'),
       ('c7000000-0000-0000-0000-000000000004', 'cm-accomplice@cm.test'),
       ('c7000000-0000-0000-0000-000000000005', 'cm-colleague@cm.test'),
       ('c7000000-0000-0000-0000-000000000006', 'cm-left@cm.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, discoverable)
VALUES ('c7000000-0000-0000-0000-000000000001', 'c7d00000-0000-0000-0000-0000000000a0', 'Admin Plikow', true),
       ('c7000000-0000-0000-0000-000000000002', 'c7d00000-0000-0000-0000-0000000000a0', 'Wiktoria Ofiara', true),
       ('c7000000-0000-0000-0000-000000000003', 'c7d00000-0000-0000-0000-0000000000a0', 'Adam Napastnik', true),
       ('c7000000-0000-0000-0000-000000000004', 'c7d00000-0000-0000-0000-0000000000a0', 'Marta Wspolniczka', true),
       ('c7000000-0000-0000-0000-000000000005', 'c7d00000-0000-0000-0000-0000000000a0', 'Kasia Kolezanka', true),
       ('c7000000-0000-0000-0000-000000000006', 'c7d00000-0000-0000-0000-0000000000a0', 'Leon Byly', true);

INSERT INTO public.user_roles (user_id, role, tenant_id)
VALUES ('c7000000-0000-0000-0000-000000000001', 'admin', 'c7d00000-0000-0000-0000-0000000000a0');

-- KV: klub ofiary (prywatny), KA: klub napastnika (prywatny). Napastnik
-- i wspólniczka NIE należą do KV - jedyną drogą do pliku ofiary był wpis
-- w ich własnym klubie.
SELECT set_config('request.jwt.claims', '{"sub":"c7000000-0000-0000-0000-000000000001"}', true);
SELECT set_config('test.kv', public.admin_club_upsert(
  '{"slug":"cm-test-victim","name_pl":"Klub ofiary","visibility":"private","status":"active"}'::jsonb)::text, true);
SELECT set_config('test.ka', public.admin_club_upsert(
  '{"slug":"cm-test-attacker","name_pl":"Klub napastnika","visibility":"private","status":"active"}'::jsonb)::text, true);
SELECT public.admin_club_member_upsert(current_setting('test.kv')::uuid, m.uid, 'member', 'active', NULL)
  FROM (VALUES ('c7000000-0000-0000-0000-000000000002'::uuid),
               ('c7000000-0000-0000-0000-000000000005'::uuid)) AS m(uid);
SELECT public.admin_club_member_upsert(current_setting('test.ka')::uuid, m.uid, 'member', m.status, NULL)
  FROM (VALUES ('c7000000-0000-0000-0000-000000000003'::uuid, 'active'),
               ('c7000000-0000-0000-0000-000000000004'::uuid, 'active'),
               ('c7000000-0000-0000-0000-000000000006'::uuid, 'left')) AS m(uid, status);

SELECT set_config('test.victim_path', 'c7000000-0000-0000-0000-000000000002/lq0x1-a1b2c3-raport-zarzadu.pdf', true);
SELECT set_config('test.attacker_path', 'c7000000-0000-0000-0000-000000000003/lq0x2-d4e5f6-notatka.pdf', true);

-- Ofiara publikuje plik w swoim klubie - to jest ścieżka, którą ktoś z KV
-- (albo były członek) mógł zobaczyć i przekazać dalej.
SELECT set_config('request.jwt.claims', '{"sub":"c7000000-0000-0000-0000-000000000002"}', true);
SELECT set_config('test.pv', (SELECT post_id::text FROM public.club_post_create(
  current_setting('test.kv')::uuid, NULL, NULL, 'Raport zarzadu',
  jsonb_build_array(jsonb_build_object('type', 'file', 'path', current_setting('test.victim_path'),
    'name', 'raport-zarzadu.pdf', 'mime', 'application/pdf', 'size', 52000)))), true);

-- ----------------------------------------------------------------------------
-- 1. Struktura i granty
-- ----------------------------------------------------------------------------
SELECT has_function('public', 'club_post_media_normalize', ARRAY['jsonb', 'uuid'],
  'normalizator zalacznika-pliku istnieje');
SELECT ok(
  has_function_privilege('service_role', 'public.club_post_media_normalize(jsonb,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.club_post_media_normalize(jsonb,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.club_post_media_normalize(jsonb,uuid)', 'EXECUTE'),
  'normalizator wykonuje tylko service_role (wolajacy RPC jest SECURITY DEFINER)');
SELECT ok(
  has_function_privilege('authenticated', 'public.club_media_path_readable(text)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.club_media_path_readable(text)', 'EXECUTE')
    AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.club_media_path_readable(text)'::regprocedure),
  'predykat polityki: SECURITY DEFINER, authenticated wykona, anon nie');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'club media member read'
      AND qual ~ 'club_media_path_readable'),
  1, 'polityka odczytu club-media dalej rozstrzyga przez club_media_path_readable');
SELECT ok(
  has_function_privilege('authenticated', 'public.club_post_create(uuid,uuid,uuid,text,jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.club_post_create(uuid,uuid,uuid,text,jsonb)', 'EXECUTE'),
  'club_post_create: granty bez zmian (authenticated tak, anon nie)');

-- ----------------------------------------------------------------------------
-- 2. club_post_media_normalize
-- ----------------------------------------------------------------------------
SELECT is(
  public.club_post_media_normalize(
    '{"type":"image","path":"c7000000-0000-0000-0000-000000000003/a.jpg","name":" Zdj\u0001ecie.jpg ","mime":"image/jpeg","size":1234,"width":800,"height":600,"url":"https://evil.example/x","signedUrl":"https://evil.example/y"}'::jsonb,
    'c7000000-0000-0000-0000-000000000003'),
  '{"type":"image","path":"c7000000-0000-0000-0000-000000000003/a.jpg","name":"Zdjecie.jpg","mime":"image/jpeg","size":1234,"width":800,"height":600}'::jsonb,
  'postac kanoniczna: siedem kluczy, obce klucze odpadaja, znaki sterujace z nazwy usuniete');
SELECT is(
  public.club_post_media_normalize(
    '{"type":"file","path":"c7000000-0000-0000-0000-000000000003/x.pdf","name":"","mime":null}'::jsonb,
    'c7000000-0000-0000-0000-000000000003'),
  '{"type":"file","path":"c7000000-0000-0000-0000-000000000003/x.pdf","name":null,"mime":null,"size":null,"width":null,"height":null}'::jsonb,
  'brakujace i puste pola to null (klient ma dla nich wartosci zastepcze)');
SELECT ok(
  public.club_post_media_normalize(jsonb_build_object('type', 'video',
      'path', 'c7000000-0000-0000-0000-000000000003/' || repeat('v', 987),
      'name', repeat('n', 255), 'size', 52428800, 'width', 100000, 'height', 1),
    'c7000000-0000-0000-0000-000000000003') IS NOT NULL
  AND public.club_post_media_normalize(
    '{"type":"file","path":"c7000000-0000-0000-0000-000000000003/x.pdf","size":0}'::jsonb,
    'c7000000-0000-0000-0000-000000000003') IS NOT NULL,
  'granice wlacznie: sciezka 1024 znaki, nazwa 255, rozmiar 0 i 52428800, wymiary 1 i 100000');

-- Lista przypadków odrzuconych: asercja wypisuje te, które PRZESZŁY.
SELECT is(
  (SELECT string_agg(c.label, ', ' ORDER BY c.label)
     FROM (VALUES
       ('obcy katalog', '{"type":"file","path":"c7000000-0000-0000-0000-000000000002/raport.pdf"}'),
       ('zagniezdzenie', '{"type":"file","path":"c7000000-0000-0000-0000-000000000003/a/b.pdf"}'),
       ('przejscie ..', '{"type":"file","path":"c7000000-0000-0000-0000-000000000003/../c7000000-0000-0000-0000-000000000002/raport.pdf"}'),
       ('plik ..', '{"type":"file","path":"c7000000-0000-0000-0000-000000000003/.."}'),
       ('plik .', '{"type":"file","path":"c7000000-0000-0000-0000-000000000003/."}'),
       ('bez katalogu', '{"type":"file","path":"raport.pdf"}'),
       ('sam katalog', '{"type":"file","path":"c7000000-0000-0000-0000-000000000003"}'),
       ('pusty plik', '{"type":"file","path":"c7000000-0000-0000-0000-000000000003/"}'),
       ('wiodacy ukosnik', '{"type":"file","path":"/c7000000-0000-0000-0000-000000000003/x.pdf"}'),
       ('katalog wielkimi', '{"type":"file","path":"C7000000-0000-0000-0000-000000000003/x.pdf"}'),
       ('spacja przed', '{"type":"file","path":" c7000000-0000-0000-0000-000000000003/x.pdf"}'),
       ('znak sterujacy', '{"type":"file","path":"c7000000-0000-0000-0000-000000000003/x\u0001.pdf"}'),
       ('sciezka liczba', '{"type":"file","path":42}'),
       ('bez sciezki', '{"type":"file","name":"x.pdf"}'),
       ('typ link', '{"type":"link","path":"c7000000-0000-0000-0000-000000000003/x.pdf"}'),
       ('typ wielka litera', '{"type":"Image","path":"c7000000-0000-0000-0000-000000000003/x.jpg"}'),
       ('nazwa liczba', '{"type":"file","path":"c7000000-0000-0000-0000-000000000003/x.pdf","name":7}'),
       ('mime obiekt', '{"type":"file","path":"c7000000-0000-0000-0000-000000000003/x.pdf","mime":{}}'),
       ('rozmiar ujemny', '{"type":"file","path":"c7000000-0000-0000-0000-000000000003/x.pdf","size":-1}'),
       ('rozmiar ulamkowy', '{"type":"file","path":"c7000000-0000-0000-0000-000000000003/x.pdf","size":1.5}'),
       ('rozmiar ponad kubelek', '{"type":"file","path":"c7000000-0000-0000-0000-000000000003/x.pdf","size":52428801}'),
       ('rozmiar tekst', '{"type":"file","path":"c7000000-0000-0000-0000-000000000003/x.pdf","size":"12"}'),
       ('szerokosc zero', '{"type":"image","path":"c7000000-0000-0000-0000-000000000003/x.jpg","width":0}'),
       ('wysokosc ponad', '{"type":"image","path":"c7000000-0000-0000-0000-000000000003/x.jpg","height":100001}'),
       ('nie obiekt', '["c7000000-0000-0000-0000-000000000003/x.pdf"]')
     ) AS c(label, el)
    WHERE public.club_post_media_normalize(c.el::jsonb, 'c7000000-0000-0000-0000-000000000003') IS NOT NULL),
  NULL,
  'odrzucenia: obcy katalog, zagniezdzenie, ./.., ksztalt sciezki, znaki sterujace, typy i zakresy pol');
SELECT ok(
  public.club_post_media_normalize(jsonb_build_object('type', 'file',
      'path', 'c7000000-0000-0000-0000-000000000003/' || repeat('v', 988)),
    'c7000000-0000-0000-0000-000000000003') IS NULL
  AND public.club_post_media_normalize(jsonb_build_object('type', 'file',
      'path', 'c7000000-0000-0000-0000-000000000003/x.pdf', 'name', repeat('n', 256)),
    'c7000000-0000-0000-0000-000000000003') IS NULL
  AND public.club_post_media_normalize(
    '{"type":"file","path":"c7000000-0000-0000-0000-000000000003/x.pdf"}'::jsonb, NULL) IS NULL,
  'ponad granica: sciezka 1025 znakow, nazwa 256; brak wlasciciela to odmowa');

-- ----------------------------------------------------------------------------
-- 3. club_post_create: zgłoszony scenariusz i obejścia
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"c7000000-0000-0000-0000-000000000003"}', true);
SELECT throws_ok(
  format('SELECT * FROM public.club_post_create(%L, NULL, NULL, %L, %L::jsonb)',
         current_setting('test.ka'), '',
         jsonb_build_array(jsonb_build_object('type', 'file', 'path', current_setting('test.victim_path')))),
  '22023', 'clubs: invalid media attachment',
  'ZGLOSZONY SCENARIUSZ: wpis we wlasnym klubie ze sciezka pliku ofiary odrzucony');
SELECT throws_ok(
  format('SELECT * FROM public.club_post_create(%L, NULL, NULL, %L, %L::jsonb)',
         current_setting('test.ka'), 'Zdjecie',
         jsonb_build_array(jsonb_build_object('type', 'image', 'path', current_setting('test.victim_path')))),
  '22023', 'clubs: invalid media attachment', 'typ image z obca sciezka odrzucony');
SELECT throws_ok(
  format('SELECT * FROM public.club_post_create(%L, NULL, NULL, %L, %L::jsonb)',
         current_setting('test.ka'), 'Wideo',
         jsonb_build_array(jsonb_build_object('type', 'video', 'path', current_setting('test.victim_path')))),
  '22023', 'clubs: invalid media attachment', 'typ video z obca sciezka odrzucony');
SELECT throws_ok(
  format('SELECT * FROM public.club_post_create(%L, NULL, NULL, %L, %L::jsonb)',
         current_setting('test.ka'), 'Obejscie',
         jsonb_build_array(jsonb_build_object('type', 'file',
           'path', 'c7000000-0000-0000-0000-000000000003/../' || current_setting('test.victim_path')))),
  '22023', 'clubs: invalid media attachment', 'przejscie ../ z wlasnego katalogu do cudzego odrzucone');
-- Obca ścieżka schowana za poprawnym elementem: walidacja jest per element,
-- więc wpis pada w całości, a nie zapisuje „dobrej połowy".
SELECT throws_ok(
  format('SELECT * FROM public.club_post_create(%L, NULL, NULL, %L, %L::jsonb)',
         current_setting('test.ka'), 'Dwa pliki',
         jsonb_build_array(
           jsonb_build_object('type', 'file', 'path', current_setting('test.attacker_path')),
           jsonb_build_object('type', 'file', 'path', current_setting('test.victim_path')))),
  '22023', 'clubs: invalid media attachment', 'obca sciezka za poprawnym zalacznikiem odrzuca caly wpis');
SELECT throws_ok(
  format('SELECT * FROM public.club_post_create(%L, NULL, NULL, %L, %L::jsonb)',
         current_setting('test.ka'), 'Bez sciezki', '[{"type":"file","name":"raport.pdf"}]'),
  '22023', 'clubs: invalid media attachment', 'plik bez sciezki odrzucony');
SELECT is(
  (SELECT count(*)::int FROM public.club_posts WHERE club_id = current_setting('test.ka')::uuid),
  0, 'zadna odrzucona proba nie zapisala wpisu');

SELECT set_config('test.pa', (SELECT post_id::text FROM public.club_post_create(
  current_setting('test.ka')::uuid, NULL, NULL, 'Moja notatka',
  jsonb_build_array(jsonb_build_object('type', 'file', 'path', current_setting('test.attacker_path'),
    'name', 'notatka.pdf', 'mime', 'application/pdf', 'size', 1024, 'width', NULL, 'height', NULL,
    'owner', 'c7000000-0000-0000-0000-000000000002')))), true);
SELECT is(
  (SELECT attachments FROM public.club_posts WHERE id = current_setting('test.pa')::uuid),
  jsonb_build_array(jsonb_build_object('type', 'file', 'path', current_setting('test.attacker_path'),
    'name', 'notatka.pdf', 'mime', 'application/pdf', 'size', 1024, 'width', NULL, 'height', NULL)),
  'plik z wlasnego katalogu zapisany w postaci kanonicznej (obcy klucz pominiety)');
SELECT is(
  (SELECT attachments FROM public.club_posts WHERE id = current_setting('test.pv')::uuid),
  jsonb_build_array(jsonb_build_object('type', 'file', 'path', current_setting('test.victim_path'),
    'name', 'raport-zarzadu.pdf', 'mime', 'application/pdf', 'size', 52000, 'width', NULL, 'height', NULL)),
  'wpis ofiary z jej wlasnym plikiem zapisany (ksztalt uploadClubPostMedia przechodzi)');

-- ----------------------------------------------------------------------------
-- 4. club_media_path_readable: wpisy wstrzyknięte PRZED migracją
--
-- Wiersze wprost w tabeli - tak wyglądają wpisy zapisane starym
-- `club_post_create`, którego walidacja ich już nie zatrzyma.
-- ----------------------------------------------------------------------------
INSERT INTO public.club_posts (tenant_id, club_id, author_id, body, attachments)
VALUES ('c7d00000-0000-0000-0000-0000000000a0', current_setting('test.ka')::uuid,
        'c7000000-0000-0000-0000-000000000003', 'Stary wpis z cudzym plikiem',
        jsonb_build_array(jsonb_build_object('type', 'file', 'path', current_setting('test.victim_path')))),
       ('c7d00000-0000-0000-0000-0000000000a0', current_setting('test.ka')::uuid,
        'c7000000-0000-0000-0000-000000000003', 'Stary wpis z katalogiem nie-uuid',
        '[{"type":"file","path":"nie-uuid/plik.pdf"}]'::jsonb);

SELECT set_config('request.jwt.claims', '{"sub":"c7000000-0000-0000-0000-000000000003"}', true);
SELECT ok(NOT public.club_media_path_readable(current_setting('test.victim_path')),
  'ZGLOSZONY SCENARIUSZ: autor starego wpisu z obca sciezka NIE czyta pliku ofiary');
SELECT set_config('request.jwt.claims', '{"sub":"c7000000-0000-0000-0000-000000000004"}', true);
SELECT ok(NOT public.club_media_path_readable(current_setting('test.victim_path')),
  'czlonek klubu napastnika NIE czyta pliku ofiary przez stary wpis');
SELECT ok(public.club_media_path_readable(current_setting('test.attacker_path')),
  'kontrola dodatnia: czlonek klubu czyta plik AUTORA wpisu w tym klubie');
SELECT lives_ok(
  $$ SELECT public.club_media_path_readable('nie-uuid/plik.pdf') $$,
  'katalog nie-uuid nie rzuca bledu rzutowania w srodku polityki');
SELECT ok(NOT public.club_media_path_readable('nie-uuid/plik.pdf'),
  '... i nie otwiera pliku');

SELECT set_config('request.jwt.claims', '{"sub":"c7000000-0000-0000-0000-000000000005"}', true);
SELECT ok(public.club_media_path_readable(current_setting('test.victim_path')),
  'kontrola dodatnia: kolezanka z klubu ofiary czyta jej plik');
SELECT ok(NOT public.club_media_path_readable(current_setting('test.attacker_path')),
  'osoba spoza klubu napastnika nie czyta jego pliku');

SELECT set_config('request.jwt.claims', '{"sub":"c7000000-0000-0000-0000-000000000006"}', true);
SELECT ok(NOT public.club_media_path_readable(current_setting('test.attacker_path')),
  'byly czlonek (left) nie czyta plikow klubu');

-- Konto autora usunięte: `deleteUser` kasuje `auth.users`, FK zeruje
-- `author_id`, a wpis z treścią i zdjęciami zostaje w strumieniu klubu.
-- `c7...dd` nigdy nie było w `auth.users` - dokładnie ten stan.
INSERT INTO public.club_posts (tenant_id, club_id, author_id, body, attachments)
VALUES ('c7d00000-0000-0000-0000-0000000000a0', current_setting('test.ka')::uuid, NULL,
        'Wpis konta usunietego',
        '[{"type":"image","path":"c7000000-0000-0000-0000-0000000000dd/lq0x3-zdjecie.jpg"}]'::jsonb),
       ('c7d00000-0000-0000-0000-0000000000a0', current_setting('test.ka')::uuid, NULL,
        'Stary wpis z cudzym plikiem, autor potem usunal konto',
        jsonb_build_array(jsonb_build_object('type', 'file', 'path', current_setting('test.victim_path')))),
       ('c7d00000-0000-0000-0000-0000000000a0', current_setting('test.ka')::uuid,
        'c7000000-0000-0000-0000-000000000003', 'Stary wpis zyjacego z plikiem konta usunietego',
        '[{"type":"file","path":"c7000000-0000-0000-0000-0000000000dd/lq0x4-inny.pdf"}]'::jsonb);

SELECT set_config('request.jwt.claims', '{"sub":"c7000000-0000-0000-0000-000000000004"}', true);
SELECT ok(public.club_media_path_readable('c7000000-0000-0000-0000-0000000000dd/lq0x3-zdjecie.jpg'),
  'KONTO AUTORA USUNIETE: czlonek klubu dalej czyta zdjecie wpisu bez autora');
SELECT ok(NOT public.club_media_path_readable(current_setting('test.victim_path')),
  'wpis bez autora NIE otwiera sciezki zyjacego uzytkownika (wstrzykniecie, autor usunal konto)');
SELECT ok(NOT public.club_media_path_readable('c7000000-0000-0000-0000-0000000000dd/lq0x4-inny.pdf'),
  'plik konta usunietego we wpisie ZYJACEGO autora nie jest otwarty');
SELECT set_config('request.jwt.claims', '{"sub":"c7000000-0000-0000-0000-000000000005"}', true);
SELECT ok(NOT public.club_media_path_readable('c7000000-0000-0000-0000-0000000000dd/lq0x3-zdjecie.jpg'),
  'plik konta usunietego nie jest otwarty dla osoby spoza klubu wpisu');

-- Wpis usunięty nie jest nigdzie pokazywany, więc nie trzyma otwartego pliku.
SELECT set_config('request.jwt.claims', '{"sub":"c7000000-0000-0000-0000-000000000002"}', true);
SELECT ok(public.club_post_delete(current_setting('test.pv')::uuid), 'ofiara usuwa swoj wpis');
SELECT set_config('request.jwt.claims', '{"sub":"c7000000-0000-0000-0000-000000000005"}', true);
SELECT ok(NOT public.club_media_path_readable(current_setting('test.victim_path')),
  'plik usunietego wpisu nie jest juz otwarty dla czlonkow klubu');

SELECT * FROM finish();
ROLLBACK;
