-- ============================================================================
-- pgTAP: okładka klubu - zapis pliku, adresu i kadrowania z JEDNEGO predykatu
-- (migracja 20261003170000).
--
-- Do tej migracji polityka `club-covers/<clubId>/...` na `storage.objects`
-- wpuszczała członków o roli `IN ('owner','moderator')`. Słownik
-- `club_members` nie zna roli `owner`, więc prowadzący (`lead`) widział edytor
-- okładki (`club_view.can_moderate`), a każde wgranie kończyło się odmową RLS.
-- Ta sama funkcja nie czytała statusu członkostwa ani kadencji (były,
-- zbanowany i „przeterminowany" moderator dalej pisał), a gałąź
-- `has_role(admin)` pytała o rolę w najemcy WOŁAJĄCEGO, więc admin najemcy B
-- pisał w prefiksie klubu najemcy A. `club_set_cover` odrzucał z kolei adres
-- pod domeną marki, który klient wysyła od 20260915091000.
--
-- Plik przybija kontrakt na PEŁNYM schemacie (wszystkie migracje, realne
-- `has_role` z `user_roles.tenant_id`):
--   1. struktura: predykat istnieje, martwa `club_is_any_moderator` zniknęła,
--      cztery polityki magazynu (select domyka sprzątanie `remove`) pytają
--      `club_is_cover_moderator`, granty,
--   2. macierz uprawnień predykatu magazynu - rola, kadencja, status, inny
--      klub, administracja, obcy najemca, sondowanie cudzego konta, ścieżki,
--   3. parytet z UI: `club_view.can_moderate` == predykat dla każdego aktora,
--   4. `club_set_cover`: domena marki, postać kanoniczna, prefiks TEGO klubu,
--      odmowy i granica najemcy,
--   5. `club_set_cover_position`: ten sam predykat; nowe zdjęcie zeruje kadr.
--
-- DML na `storage.objects` (wykonanie polityk z roli `authenticated`) żyje
-- w `scripts/pg-harness/runtime_test.sql` (sekcja A36): tam schemat storage
-- jest atrapą harnessu. Na schemacie Supabase bezpośredni DELETE na
-- `storage.objects` blokuje trigger `protect_delete`, a przedmiotem tego pliku
-- jest predykat, nie mechanika magazynu.
--
-- Wywołania idą rolą właściciela z tożsamością w `request.jwt.claims` - jak
-- w `discussion_clubs_a1_test.sql`: wszystkie funkcje są SECURITY DEFINER
-- i rozstrzygają wołającego z JWT, nie z roli bazy.
-- ============================================================================
BEGIN;
SELECT plan(45);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, name, slug)
VALUES ('11111111-1111-1111-1111-111111111111', 'Tenant A', 'tenant-a-club-cover-test'),
       ('22222222-2222-2222-2222-222222222222', 'Tenant B', 'tenant-b-club-cover-test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('cccccccc-0000-0000-0000-000000000001', 'cover-admin-a@test.local'),
       ('cccccccc-0000-0000-0000-000000000002', 'cover-super-a@test.local'),
       ('cccccccc-0000-0000-0000-000000000003', 'cover-lead@test.local'),
       ('cccccccc-0000-0000-0000-000000000004', 'cover-moderator@test.local'),
       ('cccccccc-0000-0000-0000-000000000005', 'cover-member@test.local'),
       ('cccccccc-0000-0000-0000-000000000006', 'cover-observer@test.local'),
       ('cccccccc-0000-0000-0000-000000000007', 'cover-mod-expired@test.local'),
       ('cccccccc-0000-0000-0000-000000000008', 'cover-mod-left@test.local'),
       ('cccccccc-0000-0000-0000-000000000009', 'cover-mod-banned@test.local'),
       ('cccccccc-0000-0000-0000-000000000010', 'cover-other-lead@test.local'),
       ('cccccccc-0000-0000-0000-000000000011', 'cover-outsider@test.local'),
       ('dddddddd-0000-0000-0000-000000000001', 'cover-admin-b@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, discoverable)
VALUES ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Admin A', true),
       ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Super A', true),
       ('cccccccc-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Lead', true),
       ('cccccccc-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Moderator', true),
       ('cccccccc-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Member', true),
       ('cccccccc-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Observer', true),
       ('cccccccc-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Mod expired', true),
       ('cccccccc-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Mod left', true),
       ('cccccccc-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'Mod banned', true),
       ('cccccccc-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'Other lead', true),
       ('cccccccc-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 'Outsider', true),
       ('dddddddd-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Admin B', true);

-- super_admin CELOWO bez osobnej roli 'admin' (inwariant super_admin >= admin).
INSERT INTO public.user_roles (user_id, role, tenant_id)
VALUES ('cccccccc-0000-0000-0000-000000000001', 'admin', '11111111-1111-1111-1111-111111111111'),
       ('cccccccc-0000-0000-0000-000000000002', 'super_admin', '11111111-1111-1111-1111-111111111111'),
       ('dddddddd-0000-0000-0000-000000000001', 'admin', '22222222-2222-2222-2222-222222222222');

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000001"}', true);
SELECT public.admin_club_upsert(
  '{"slug":"klub-okladka-test","name_pl":"Okladka","name_en":"Cover","visibility":"members","status":"active"}'::jsonb);
SELECT public.admin_club_upsert(
  '{"slug":"klub-okladka-test-2","name_pl":"Okladka 2","name_en":"Cover 2","visibility":"members","status":"active"}'::jsonb);
SELECT set_config('test.cover_club',
  (SELECT id::text FROM public.clubs WHERE slug = 'klub-okladka-test'
      AND tenant_id = '11111111-1111-1111-1111-111111111111'), true);
SELECT set_config('test.cover_club2',
  (SELECT id::text FROM public.clubs WHERE slug = 'klub-okladka-test-2'
      AND tenant_id = '11111111-1111-1111-1111-111111111111'), true);
SELECT set_config('test.cover_path',
  'club-covers/' || current_setting('test.cover_club') || '/okladka.jpg', true);

SELECT public.admin_club_member_upsert(current_setting('test.cover_club')::uuid, m.uid, m.role, m.status, NULL)
  FROM (VALUES
    ('cccccccc-0000-0000-0000-000000000003'::uuid, 'lead', 'active'),
    ('cccccccc-0000-0000-0000-000000000004'::uuid, 'moderator', 'active'),
    ('cccccccc-0000-0000-0000-000000000005'::uuid, 'member', 'active'),
    ('cccccccc-0000-0000-0000-000000000006'::uuid, 'observer', 'active'),
    ('cccccccc-0000-0000-0000-000000000007'::uuid, 'moderator', 'active'),
    ('cccccccc-0000-0000-0000-000000000008'::uuid, 'moderator', 'left'),
    ('cccccccc-0000-0000-0000-000000000009'::uuid, 'moderator', 'banned')
  ) AS m(uid, role, status);
SELECT public.admin_club_member_upsert(current_setting('test.cover_club2')::uuid,
  'cccccccc-0000-0000-0000-000000000010', 'lead', 'active', NULL);
-- Kadencja w przeszłości wprost w tabeli: przedmiotem jest odczyt wygasłej
-- kadencji, nie walidacja daty przy jej nadawaniu.
UPDATE public.club_members SET role_expires_at = now() - interval '1 day'
 WHERE club_id = current_setting('test.cover_club')::uuid
   AND user_id = 'cccccccc-0000-0000-0000-000000000007';

-- ----------------------------------------------------------------------------
-- 1. Struktura
-- ----------------------------------------------------------------------------
SELECT has_function('public', 'club_can_edit_cover', ARRAY['uuid', 'uuid'],
  'predykat club_can_edit_cover istnieje');
SELECT hasnt_function('public', 'club_is_any_moderator', ARRAY['uuid'],
  'martwa club_is_any_moderator (literal owner) usunieta');
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname IN ('club covers moderator select', 'club covers moderator insert',
                         'club covers moderator update', 'club covers moderator delete')
      AND COALESCE(with_check, qual) ~ 'club_is_cover_moderator'),
  4, 'cztery polityki prefiksu club-covers (select domyka sprzatanie) pytaja club_is_cover_moderator');
SELECT ok(
  has_function_privilege('authenticated', 'public.club_is_cover_moderator(uuid,text)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.club_can_edit_cover(uuid,uuid)', 'EXECUTE'),
  'authenticated wykona funkcje polityki (RLS liczy sie prawami wolajacego)');
SELECT ok(
  NOT has_function_privilege('anon', 'public.club_can_edit_cover(uuid,uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.club_is_cover_moderator(uuid,text)', 'EXECUTE'),
  'anon nie wywola predykatu okladki');

-- ----------------------------------------------------------------------------
-- 2. Macierz uprawnień predykatu magazynu
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000003"}', true);
SELECT ok(public.club_is_cover_moderator('cccccccc-0000-0000-0000-000000000003', current_setting('test.cover_path')),
  'prowadzacy (lead) moze wgrac okladke - zgloszony scenariusz');
SELECT ok(NOT public.club_is_cover_moderator('cccccccc-0000-0000-0000-000000000003',
    'club-covers/' || current_setting('test.cover_club2') || '/okladka.jpg'),
  'prowadzacy NIE pisze w prefiksie klubu, ktorego nie prowadzi');
SELECT ok(
  NOT public.club_is_cover_moderator('cccccccc-0000-0000-0000-000000000003', 'club-covers/okladka.jpg')
    AND NOT public.club_is_cover_moderator('cccccccc-0000-0000-0000-000000000003', 'club-covers/to-nie-uuid/okladka.jpg')
    AND NOT public.club_is_cover_moderator('cccccccc-0000-0000-0000-000000000003',
          'club-covers/' || current_setting('test.cover_club') || '/podfolder/okladka.jpg')
    AND NOT public.club_is_cover_moderator('cccccccc-0000-0000-0000-000000000003',
          'avatars/' || current_setting('test.cover_club') || '/okladka.jpg'),
  'sciezka inna niz club-covers/<uuid>/<plik> to odmowa (fail-closed)');

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000004"}', true);
SELECT ok(public.club_is_cover_moderator('cccccccc-0000-0000-0000-000000000004', current_setting('test.cover_path')),
  'aktywny moderator moze wgrac okladke');

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000005"}', true);
SELECT ok(NOT public.club_is_cover_moderator('cccccccc-0000-0000-0000-000000000005', current_setting('test.cover_path')),
  'zwykly czlonek NIE');
SELECT ok(NOT public.club_is_cover_moderator('cccccccc-0000-0000-0000-000000000003', current_setting('test.cover_path')),
  'predykat nie odpowiada o CUDZE konto (czlonek pyta o prowadzacego)');

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000006"}', true);
SELECT ok(NOT public.club_is_cover_moderator('cccccccc-0000-0000-0000-000000000006', current_setting('test.cover_path')),
  'obserwator NIE');

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000007"}', true);
SELECT ok(NOT public.club_is_cover_moderator('cccccccc-0000-0000-0000-000000000007', current_setting('test.cover_path')),
  'moderator z wygasla kadencja NIE');

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000008"}', true);
SELECT ok(NOT public.club_is_cover_moderator('cccccccc-0000-0000-0000-000000000008', current_setting('test.cover_path')),
  'moderator po wyjsciu z klubu (left) NIE');

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000009"}', true);
SELECT ok(NOT public.club_is_cover_moderator('cccccccc-0000-0000-0000-000000000009', current_setting('test.cover_path')),
  'zbanowany moderator NIE');

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000010"}', true);
SELECT ok(NOT public.club_is_cover_moderator('cccccccc-0000-0000-0000-000000000010', current_setting('test.cover_path')),
  'prowadzacy INNEGO klubu NIE pisze w prefiksie tego klubu');
SELECT ok(public.club_is_cover_moderator('cccccccc-0000-0000-0000-000000000010',
    'club-covers/' || current_setting('test.cover_club2') || '/okladka.jpg'),
  'kontrola dodatnia: prowadzacy innego klubu pisze we WLASNYM prefiksie');

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000011"}', true);
SELECT ok(NOT public.club_is_cover_moderator('cccccccc-0000-0000-0000-000000000011', current_setting('test.cover_path')),
  'osoba spoza klubu NIE');

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000001"}', true);
SELECT ok(public.club_is_cover_moderator('cccccccc-0000-0000-0000-000000000001', current_setting('test.cover_path')),
  'admin najemcy klubu moze');

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000002"}', true);
SELECT ok(public.club_is_cover_moderator('cccccccc-0000-0000-0000-000000000002', current_setting('test.cover_path')),
  'super_admin bez roli admin tez moze (inwariant super_admin >= admin)');

SELECT set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000001"}', true);
SELECT ok(NOT public.club_is_cover_moderator('dddddddd-0000-0000-0000-000000000001', current_setting('test.cover_path')),
  'admin INNEGO najemcy NIE (has_role pyta o najemce wolajacego, nie klubu)');

SELECT set_config('request.jwt.claims', '', true);
SELECT ok(NOT public.club_is_cover_moderator(NULL, current_setting('test.cover_path')),
  'anonim NIE');

-- ----------------------------------------------------------------------------
-- 3. Parytet z UI: edytor widzi dokładnie ten, komu baza pozwoli
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE cover_parity (actor uuid, ui boolean, db boolean) ON COMMIT DROP;
DO $$
DECLARE
  v_actor uuid;
BEGIN
  FOREACH v_actor IN ARRAY ARRAY[
    'cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002',
    'cccccccc-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000004',
    'cccccccc-0000-0000-0000-000000000005', 'cccccccc-0000-0000-0000-000000000006',
    'cccccccc-0000-0000-0000-000000000007', 'cccccccc-0000-0000-0000-000000000008',
    'cccccccc-0000-0000-0000-000000000009', 'cccccccc-0000-0000-0000-000000000010',
    'cccccccc-0000-0000-0000-000000000011', 'dddddddd-0000-0000-0000-000000000001']::uuid[]
  LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_actor)::text, true);
    INSERT INTO cover_parity (actor, ui, db)
    SELECT v_actor,
           COALESCE((SELECT bool_or(v.can_moderate) FROM public.club_view('klub-okladka-test') v), false),
           public.club_is_cover_moderator(v_actor, current_setting('test.cover_path'));
  END LOOP;
END $$;
SELECT is(
  (SELECT count(*)::int FROM cover_parity), 12, 'parytet policzony dla 12 aktorow');
SELECT is(
  (SELECT string_agg(actor::text, ', ' ORDER BY actor) FROM cover_parity WHERE ui IS DISTINCT FROM db),
  NULL, 'club_view.can_moderate == predykat magazynu dla kazdego aktora');

-- ----------------------------------------------------------------------------
-- 4. club_set_cover
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000003"}', true);
SELECT is(
  public.club_set_cover(current_setting('test.cover_club')::uuid,
    'https://neweuropeanstrategies.com/media/club-covers/' || current_setting('test.cover_club') || '/1700000000000-abc.jpg'),
  'https://neweuropeanstrategies.com/media/club-covers/' || current_setting('test.cover_club') || '/1700000000000-abc.jpg',
  'adres pod domena marki (to wysyla brandedMediaUrl) jest przyjmowany');
SELECT is(
  (SELECT cover_image_url FROM public.clubs WHERE id = current_setting('test.cover_club')::uuid),
  'https://neweuropeanstrategies.com/media/club-covers/' || current_setting('test.cover_club') || '/1700000000000-abc.jpg',
  '... i zapisany na klubie');
SELECT is(
  public.club_set_cover(current_setting('test.cover_club')::uuid,
    'https://abcdefghijklmnop.supabase.co/storage/v1/object/public/media/club-covers/' || current_setting('test.cover_club') || '/b.webp'),
  'https://neweuropeanstrategies.com/media/club-covers/' || current_setting('test.cover_club') || '/b.webp',
  'host techniczny magazynu przyjety, zapisany w postaci kanonicznej marki');
SELECT is(
  public.club_set_cover(current_setting('test.cover_club')::uuid,
    'https://tracker.example/media/club-covers/' || current_setting('test.cover_club') || '/c.png'),
  'https://neweuropeanstrategies.com/media/club-covers/' || current_setting('test.cover_club') || '/c.png',
  'obcy host nie trafia do kolumny');
SELECT throws_ok(
  format($q$ SELECT public.club_set_cover('%s'::uuid,
    'https://neweuropeanstrategies.com/media/club-covers/%s/x.jpg') $q$,
    current_setting('test.cover_club'), current_setting('test.cover_club2')),
  '22023', NULL, 'adres z prefiksu INNEGO klubu odrzucony');
SELECT throws_ok(
  format($q$ SELECT public.club_set_cover('%s'::uuid,
    'https://neweuropeanstrategies.com/media/club-covers/%s/../x.jpg') $q$,
    current_setting('test.cover_club'), current_setting('test.cover_club')),
  '22023', NULL, 'segment .. w sciezce odrzucony');
SELECT throws_ok(
  format($q$ SELECT public.club_set_cover('%s'::uuid,
    'http://neweuropeanstrategies.com/media/club-covers/%s/x.jpg') $q$,
    current_setting('test.cover_club'), current_setting('test.cover_club')),
  '22023', NULL, 'http (mieszana tresc) odrzucone');
SELECT is(public.club_set_cover(current_setting('test.cover_club')::uuid, NULL), NULL,
  'NULL zdejmuje okladke');

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000004"}', true);
SELECT isnt(
  public.club_set_cover(current_setting('test.cover_club')::uuid,
    'https://neweuropeanstrategies.com/media/club-covers/' || current_setting('test.cover_club') || '/mod.jpg'),
  NULL, 'aktywny moderator ustawi okladke');

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000005"}', true);
SELECT throws_ok(
  format($q$ SELECT public.club_set_cover('%s'::uuid, NULL) $q$, current_setting('test.cover_club')),
  '42501', NULL, 'zwykly czlonek nie zdejmie okladki');

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000007"}', true);
SELECT throws_ok(
  format($q$ SELECT public.club_set_cover('%s'::uuid, NULL) $q$, current_setting('test.cover_club')),
  '42501', NULL, 'moderator z wygasla kadencja nie zdejmie okladki');

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000009"}', true);
SELECT throws_ok(
  format($q$ SELECT public.club_set_cover('%s'::uuid, NULL) $q$, current_setting('test.cover_club')),
  '42501', NULL, 'zbanowany moderator nie zdejmie okladki');

SELECT set_config('request.jwt.claims', '{"sub":"dddddddd-0000-0000-0000-000000000001"}', true);
SELECT throws_ok(
  format($q$ SELECT public.club_set_cover('%s'::uuid, NULL) $q$, current_setting('test.cover_club')),
  '42501', 'clubs: not found', 'admin innego najemcy nie zdejmie okladki (klub wyglada na nieistniejacy)');
SELECT is(
  (SELECT cover_image_url FROM public.clubs WHERE id = current_setting('test.cover_club')::uuid),
  'https://neweuropeanstrategies.com/media/club-covers/' || current_setting('test.cover_club') || '/mod.jpg',
  'po odmowach okladka zostaje ta, ktora ustawil moderator');

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000002"}', true);
SELECT isnt(
  public.club_set_cover(current_setting('test.cover_club')::uuid,
    'https://neweuropeanstrategies.com/media/club-covers/' || current_setting('test.cover_club') || '/super.jpg'),
  NULL, 'super_admin bez roli admin ustawi okladke');

-- ----------------------------------------------------------------------------
-- 5. club_set_cover_position: ten sam predykat
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000003"}', true);
SELECT is(public.club_set_cover_position(current_setting('test.cover_club')::uuid, 30::smallint), 30::smallint,
  'prowadzacy (lead) zapisze kadrowanie');

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000007"}', true);
SELECT throws_ok(
  format($q$ SELECT public.club_set_cover_position('%s'::uuid, 10::smallint) $q$, current_setting('test.cover_club')),
  '42501', NULL, 'moderator z wygasla kadencja nie przestawi kadrowania');

SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000008"}', true);
SELECT throws_ok(
  format($q$ SELECT public.club_set_cover_position('%s'::uuid, 10::smallint) $q$, current_setting('test.cover_club')),
  '42501', NULL, 'moderator po wyjsciu z klubu nie przestawi kadrowania');

SELECT is(
  (SELECT cover_position_y FROM public.clubs WHERE id = current_setting('test.cover_club')::uuid), 30::smallint,
  'odmowy nie zmienily kadrowania');

-- Nowe zdjęcie zaczyna od środka kadru; ten sam adres kadru nie rusza.
SELECT set_config('request.jwt.claims', '{"sub":"cccccccc-0000-0000-0000-000000000003"}', true);
SELECT public.club_set_cover(current_setting('test.cover_club')::uuid,
  'https://neweuropeanstrategies.com/media/club-covers/' || current_setting('test.cover_club') || '/nowe.jpg');
SELECT is(
  (SELECT cover_position_y FROM public.clubs WHERE id = current_setting('test.cover_club')::uuid), 50::smallint,
  'nowe zdjecie nie dziedziczy kadru poprzedniego');
SELECT public.club_set_cover_position(current_setting('test.cover_club')::uuid, 70::smallint);
SELECT public.club_set_cover(current_setting('test.cover_club')::uuid,
  'https://neweuropeanstrategies.com/media/club-covers/' || current_setting('test.cover_club') || '/nowe.jpg');
SELECT is(
  (SELECT cover_position_y FROM public.clubs WHERE id = current_setting('test.cover_club')::uuid), 70::smallint,
  'ponowny zapis tego samego adresu zostawia kadr');

SELECT * FROM finish();
ROLLBACK;
