-- ============================================================================
-- pgTAP: Discussion Club, etap A1 - struktura i autoryzacja.
--
-- Te testy pilnuja inwariantow, ktorych zlamanie jest incydentem, a nie
-- regresja funkcjonalna:
--   1. klient nie ma ZADNYCH grantow na tabele modulu (RPC-only),
--   2. izolacja tenanta - admin tenanta A nie widzi i nie zapisuje w tenancie B,
--   3. super_admin przechodzi wszedzie tam, gdzie admin (lekcja
--      profiles_guard_verification z audytu 2026-08-06),
--   4. rola KLUBOWA nigdy nie trafia w miejsce roli platformy (app_role),
--   5. klub 'secret' bez dostepu nie istnieje dla wolajacego (404, nie 403),
--   6. kadencja roli realnie odbiera uprawnienia,
--   7. dziedziczenie NULL -> wartosc klubu.
--
-- ROLA BAZY W FIKSTURACH (2026-08-12). Adminowe RPC (`admin_club_*`) wolamy
-- rola WLASCICIELA, nie `authenticated`. Wszystkie sa SECURITY DEFINER, a
-- tenanta i tozsamosc wolajacego rozstrzygaja z JWT (`request.jwt.claims`),
-- nie z roli bazy - przedmiotem tych asercji jest wiec zachowanie FUNKCJI, a
-- `SET LOCAL ROLE authenticated` bylo w nich infrastruktura, nie testem.
-- W CI ta infrastruktura przewracala pliki modulu na pierwszym wywolaniu RPC
-- po przelaczeniu roli, wiec fikstury sa od niej odsprzegniete.
-- Kontrakt grantu EXECUTE, ktory dotad wychodzil NIEJAWNIE z samego wywolania
-- w roli klienta (i tylko dla tych funkcji, ktore akurat wolano), jest teraz
-- przybity osobnymi asercjami `has_function_privilege` - sekcja 2b, jawnie
-- i dla WSZYSTKICH adminowych RPC tego pliku.
-- Pod rola klienta zostaja wylacznie wywolania, w ktorych rola/tozsamosc
-- wolajacego JEST istota testu: `club_capabilities` dla zwyklego czlonka,
-- dla obcego tenanta i dla klubu 'secret'.
-- ============================================================================
BEGIN;
SELECT plan(47);

-- ----------------------------------------------------------------------------
-- Fixture: dwa tenanty, po jednym adminie, jeden super_admin bez roli 'admin'
--
-- `handle_new_user` zalozylby profil w tenancie DOMYSLNYM, a
-- `profiles_pin_tenant_id` nie pozwala go potem przeniesc (tenant konta jest
-- niezmienny poza sciezka service_role). Profil musi wiec powstac od razu
-- w docelowym tenancie - z wylaczonym triggerem signupu i wprost.
-- ----------------------------------------------------------------------------
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, name, slug)
VALUES ('11111111-1111-1111-1111-111111111111', 'Tenant A', 'tenant-a-club-test'),
       ('22222222-2222-2222-2222-222222222222', 'Tenant B', 'tenant-b-club-test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'admin-a@test.local'),
       ('aaaaaaaa-0000-0000-0000-000000000002', 'super-a@test.local'),
       ('aaaaaaaa-0000-0000-0000-000000000003', 'member-a@test.local'),
       ('aaaaaaaa-0000-0000-0000-000000000004', 'outsider-a@test.local'),
       ('bbbbbbbb-0000-0000-0000-000000000001', 'admin-b@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, discoverable)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Admin A', true),
       ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Super A', true),
       ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Member A', true),
       ('aaaaaaaa-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Outsider A', true),
       ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Admin B', true);

-- Super admin CELOWO bez osobnej roli 'admin' - to jest dokladnie ten uklad,
-- w ktorym profiles_guard_verification przestal dzialac.
-- Rola jest wazna W TENANCIE (has_role porownuje tenant_id z tenantem
-- wolajacego), wiec fixture musi podac tenanta wprost.
INSERT INTO public.user_roles (user_id, role, tenant_id)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'admin', '11111111-1111-1111-1111-111111111111'),
       ('aaaaaaaa-0000-0000-0000-000000000002', 'super_admin', '11111111-1111-1111-1111-111111111111'),
       ('bbbbbbbb-0000-0000-0000-000000000001', 'admin', '22222222-2222-2222-2222-222222222222');

-- ----------------------------------------------------------------------------
-- 1. Tabele istnieja, maja RLS i ZERO grantow dla klienta
-- ----------------------------------------------------------------------------
SELECT has_table('public', 'clubs', 'tabela clubs istnieje');
SELECT has_table('public', 'club_groups', 'tabela club_groups istnieje');
SELECT has_table('public', 'club_members', 'tabela club_members istnieje');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.clubs'::regclass),
  'clubs ma wlaczone RLS'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.club_groups'::regclass),
  'club_groups ma wlaczone RLS'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.club_members'::regclass),
  'club_members ma wlaczone RLS'
);

-- RPC-only: brak grantow oznacza, ze nawet blad w polityce RLS nie wystarczy
-- do odczytu. To jest druga warstwa, nie ozdoba.
SELECT is_empty(
  $$ SELECT table_name, privilege_type
       FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name IN ('clubs', 'club_groups', 'club_members')
        AND grantee IN ('anon', 'authenticated') $$,
  'zadna tabela modulu nie ma grantow dla anon ani authenticated'
);

-- ----------------------------------------------------------------------------
-- 2. Bramka administracyjna i inwariant super_admin >= admin
--
-- `has_role` porownuje user_roles.tenant_id z tenantem WOLAJACEGO
-- (current_tenant_id()), wiec o bramke trzeba pytac z wnetrza tenanta A -
-- bez tozsamosci wolajacego kazda odpowiedz brzmi "nie".
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001"}', true);

SELECT has_function('public', 'is_club_admin', ARRAY['uuid'], 'is_club_admin istnieje');
SELECT has_function('public', 'club_capabilities', ARRAY['uuid', 'uuid', 'uuid'],
  'club_capabilities istnieje');

SELECT ok(public.is_club_admin('aaaaaaaa-0000-0000-0000-000000000001'),
  'admin przechodzi bramke is_club_admin');
-- INWARIANT: super_admin BEZ osobnej roli admin musi przejsc te sama bramke.
SELECT ok(public.is_club_admin('aaaaaaaa-0000-0000-0000-000000000002'),
  'super_admin bez roli admin przechodzi bramke is_club_admin');
SELECT ok(NOT public.is_club_admin('aaaaaaaa-0000-0000-0000-000000000003'),
  'zwykly czlonek nie przechodzi bramki is_club_admin');
SELECT ok(NOT public.is_club_admin(NULL), 'anonim nie przechodzi bramki is_club_admin');

-- ----------------------------------------------------------------------------
-- 2b. Grant EXECUTE dla klienta na adminowych RPC - asercja WPROST
--
-- Dotad ten kontrakt byl sprawdzany ubocznie: przez samo wywolanie RPC pod
-- rola `authenticated`. Pokrycie bylo przypadkowe (obejmowalo tylko funkcje
-- akurat wolane w scenariuszu) i nie bylo widac go w nazwie zadnej asercji.
-- Tutaj kazda adminowa funkcja tego pliku ma wlasna asercje grantu, wiec
-- odebranie grantu w migracji zapala sie natychmiast i pod wlasna nazwa.
-- ----------------------------------------------------------------------------
SELECT ok(
  has_function_privilege('authenticated', 'public.admin_club_upsert(jsonb)', 'EXECUTE'),
  'authenticated ma EXECUTE na admin_club_upsert(jsonb)'
);
SELECT ok(
  has_function_privilege('authenticated',
    'public.admin_club_list(text, text, text, integer, integer)', 'EXECUTE'),
  'authenticated ma EXECUTE na admin_club_list(text, text, text, integer, integer)'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.admin_club_get(uuid)', 'EXECUTE'),
  'authenticated ma EXECUTE na admin_club_get(uuid)'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.admin_club_group_upsert(jsonb)', 'EXECUTE'),
  'authenticated ma EXECUTE na admin_club_group_upsert(jsonb)'
);
SELECT ok(
  has_function_privilege('authenticated',
    'public.admin_club_member_upsert(uuid, uuid, text, text, timestamptz, boolean)', 'EXECUTE'),
  'authenticated ma EXECUTE na admin_club_member_upsert(uuid, uuid, text, text, timestamptz, boolean)'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.admin_club_groups(uuid)', 'EXECUTE'),
  'authenticated ma EXECUTE na admin_club_groups(uuid)'
);

-- ----------------------------------------------------------------------------
-- 3. Tworzenie klubu przez admina tenanta A
--
-- Podzial rol w dalszej czesci pliku: adminowe RPC ORAZ odczyty tabel modulu
-- ida rola WLASCICIELA - grant EXECUTE dla klienta ma juz wlasne asercje
-- (sekcja 2b), a do tabel klient nie ma ZADNEGO grantu. Tozsamosc wolajacego
-- niesie JWT, nie rola bazy. Identyfikatory klubow przekazujemy do wywolan RPC
-- przez GUC - inaczej podzapytanie po id siegnelo by do tabeli w tych blokach,
-- ktore nadal chodza rola klienta (sekcje 6 i 7).
-- ----------------------------------------------------------------------------
SELECT lives_ok(
  $$ SELECT public.admin_club_upsert(
       '{"slug":"klub-testowy","name_pl":"Klub testowy","name_en":"Test club",
         "visibility":"members","status":"active"}'::jsonb) $$,
  'admin tworzy klub'
);

SELECT is(
  (SELECT count(*)::int FROM public.clubs
    WHERE slug = 'klub-testowy' AND tenant_id = '11111111-1111-1111-1111-111111111111'),
  1, 'klub powstal w tenancie wolajacego'
);

-- Domyslna grupa: kod tematow nigdy nie widzi klubu bez grupy.
SELECT is(
  (SELECT count(*)::int FROM public.club_groups g
     JOIN public.clubs c ON c.id = g.club_id
    WHERE c.slug = 'klub-testowy' AND g.slug = 'ogolna'),
  1, 'nowy klub dostaje domyslna grupe "ogolna"'
);

SELECT is(
  (SELECT g.tenant_id FROM public.club_groups g
     JOIN public.clubs c ON c.id = g.club_id WHERE c.slug = 'klub-testowy' LIMIT 1),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'grupa dziedziczy tenanta z klubu, nie z parametru'
);

SELECT set_config('test.club_a',
  (SELECT id::text FROM public.clubs
    WHERE slug = 'klub-testowy'
      AND tenant_id = '11111111-1111-1111-1111-111111111111'), true);

-- Slug jest unikalny w obrebie tenanta. Przedmiotem asercji jest ograniczenie
-- bazy, nie rola wolajacego, wiec i to wywolanie idzie rola wlasciciela.
SELECT throws_ok(
  $$ SELECT public.admin_club_upsert(
       '{"slug":"klub-testowy","name_pl":"Duplikat"}'::jsonb) $$,
  '23505', NULL, 'powtorzony slug w tym samym tenancie jest odrzucany'
);

-- ----------------------------------------------------------------------------
-- 4. Izolacja tenanta
--
-- Tenanta rozstrzyga JWT wewnatrz funkcji definera, nie rola bazy - dlatego
-- podmiana tozsamosci to wylacznie podmiana `request.jwt.claims`.
-- ----------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000001"}';

SELECT is_empty(
  $$ SELECT id FROM public.admin_club_list(NULL, NULL, NULL, 50, 0) $$,
  'admin tenanta B nie widzi klubow tenanta A'
);

SELECT is_empty(
  $$ SELECT id FROM public.admin_club_get(current_setting('test.club_a')::uuid) $$,
  'admin tenanta B nie odczyta klubu tenanta A po id'
);

-- Ten sam slug w innym tenancie jest POPRAWNY - unikalnosc jest per tenant.
SELECT lives_ok(
  $$ SELECT public.admin_club_upsert(
       '{"slug":"klub-testowy","name_pl":"Klub B","name_en":"Club B"}'::jsonb) $$,
  'ten sam slug w innym tenancie jest dozwolony'
);

SELECT is(
  (SELECT count(*)::int FROM public.clubs WHERE slug = 'klub-testowy'),
  2, 'oba tenanty maja wlasny klub o tym samym slugu'
);

-- Proba dopisania grupy do cudzego klubu. Odmowe wystawia funkcja po
-- porownaniu tenanta z JWT, wiec asercja nie potrzebuje roli klienta.
SELECT throws_ok(
  format(
    $$ SELECT public.admin_club_group_upsert(
         '{"club_id":"%s","slug":"obca","name_pl":"Obca"}'::jsonb) $$,
    current_setting('test.club_a')
  ),
  '42501', NULL, 'admin tenanta B nie dopisze grupy do klubu tenanta A'
);

-- ----------------------------------------------------------------------------
-- 5. Rola klubowa NIGDY nie jest rola platformy
-- ----------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001"}';

SELECT throws_ok(
  format(
    $$ SELECT public.admin_club_member_upsert('%s','%s','admin','active',NULL) $$,
    current_setting('test.club_a'),
    'aaaaaaaa-0000-0000-0000-000000000003'
  ),
  '22023', NULL,
  'rola platformy "admin" jest odrzucana jako rola klubowa'
);

SELECT throws_ok(
  format(
    $$ SELECT public.admin_club_member_upsert('%s','%s','super_admin','active',NULL) $$,
    current_setting('test.club_a'),
    'aaaaaaaa-0000-0000-0000-000000000003'
  ),
  '22023', NULL,
  'rola platformy "super_admin" jest odrzucana jako rola klubowa'
);

-- Osoba z innego tenanta nie moze zostac czlonkiem.
SELECT throws_ok(
  format(
    $$ SELECT public.admin_club_member_upsert('%s','%s','member','active',NULL) $$,
    current_setting('test.club_a'),
    'bbbbbbbb-0000-0000-0000-000000000001'
  ),
  '42501', NULL,
  'osoba z obcego tenanta nie zostanie dodana do klubu'
);

SELECT lives_ok(
  format(
    $$ SELECT public.admin_club_member_upsert('%s','%s','member','active',NULL) $$,
    current_setting('test.club_a'),
    'aaaaaaaa-0000-0000-0000-000000000003'
  ),
  'czlonek z tego samego tenanta zostaje dodany'
);

-- Licznik czlonkow utrzymuje trigger, nie klient.
SELECT is(
  (SELECT member_count FROM public.clubs
    WHERE slug = 'klub-testowy' AND tenant_id = '11111111-1111-1111-1111-111111111111'),
  1, 'trigger zaktualizowal member_count'
);

-- ----------------------------------------------------------------------------
-- 6. Macierz zdolnosci
--
-- TU rola klienta zostaje: pytamy, co widzi wolajacy w roli klienta - zwykly
-- czlonek i obcy tenant. To jedyne miejsce tego pliku, w ktorym rola bazy jest
-- istota testu, a nie infrastruktura fikstury.
-- ----------------------------------------------------------------------------
SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT can_manage FROM public.club_capabilities(
     current_setting('test.club_a')::uuid,
     NULL, 'aaaaaaaa-0000-0000-0000-000000000001')),
  true, 'admin zarzadza struktura klubu'
);

-- INWARIANT: super_admin bez roli 'admin' ma te sama zdolnosc.
SELECT is(
  (SELECT can_manage FROM public.club_capabilities(
     current_setting('test.club_a')::uuid,
     NULL, 'aaaaaaaa-0000-0000-0000-000000000002')),
  true, 'super_admin bez roli admin zarzadza struktura klubu'
);

SELECT is(
  (SELECT can_manage FROM public.club_capabilities(
     current_setting('test.club_a')::uuid,
     NULL, 'aaaaaaaa-0000-0000-0000-000000000003')),
  false, 'zwykly czlonek nie zarzadza struktura'
);

-- Czlonek nie ujawnia autora anonimowej wypowiedzi.
SELECT is(
  (SELECT can_reveal_author FROM public.club_capabilities(
     current_setting('test.club_a')::uuid,
     NULL, 'aaaaaaaa-0000-0000-0000-000000000003')),
  false, 'czlonek nie ujawnia autora anonimowej wypowiedzi'
);

-- Obcy tenant: klub "nie istnieje", a nie "brak dostepu".
SELECT is(
  (SELECT reason FROM public.club_capabilities(
     current_setting('test.club_a')::uuid,
     NULL, 'bbbbbbbb-0000-0000-0000-000000000001')),
  'not_found', 'obcy tenant dostaje not_found, nie forbidden'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 7. Klub 'secret' nie istnieje dla obcego
--
-- Klub zaklada adminowe RPC rola wlasciciela (fikstura), a pytanie o dostep
-- zadaje juz rola klienta - bo tam wlasnie rola wolajacego jest przedmiotem.
-- ----------------------------------------------------------------------------
SELECT public.admin_club_upsert(
  '{"slug":"klub-tajny","name_pl":"Tajny","name_en":"Secret",
    "visibility":"secret","status":"active"}'::jsonb);

SELECT set_config('test.club_secret',
  (SELECT id::text FROM public.clubs WHERE slug = 'klub-tajny'), true);

SET LOCAL ROLE authenticated;

SELECT is(
  (SELECT can_read FROM public.club_capabilities(
     current_setting('test.club_secret')::uuid,
     NULL, 'aaaaaaaa-0000-0000-0000-000000000004')),
  false, 'nie-czlonek nie czyta klubu secret'
);

SELECT is(
  (SELECT reason FROM public.club_capabilities(
     current_setting('test.club_secret')::uuid,
     NULL, 'aaaaaaaa-0000-0000-0000-000000000004')),
  'not_found', 'klub secret zwraca not_found - nie zdradza swojego istnienia'
);

-- ----------------------------------------------------------------------------
-- 8. Kadencja roli realnie odbiera uprawnienia
-- ----------------------------------------------------------------------------
SELECT is(
  public.club_effective_member_role('moderator', now() - interval '1 day'),
  'member', 'wygasla kadencja moderatora sprowadza role do member'
);
SELECT is(
  public.club_effective_member_role('moderator', now() + interval '1 day'),
  'moderator', 'wazna kadencja zachowuje role'
);
SELECT is(
  public.club_effective_member_role('moderator', NULL),
  'moderator', 'brak kadencji znaczy bezterminowo'
);
-- Kadencja nie wyrzuca z klubu - sprowadza do member.
SELECT is(
  public.club_effective_member_role('member', now() - interval '1 day'),
  'member', 'kadencja nie dotyczy roli member'
);

RESET ROLE;

-- ----------------------------------------------------------------------------
-- 9. Dziedziczenie ustawien grupy: NULL = wartosc klubu
--
-- Adminowy odczyt, wiec rola wlasciciela; grant dla klienta pilnuje sekcja 2b.
-- ----------------------------------------------------------------------------
SELECT is(
  (SELECT visibility FROM public.admin_club_groups(
     current_setting('test.club_secret')::uuid) LIMIT 1),
  'secret', 'grupa bez nadpisania dziedziczy widocznosc klubu'
);

SELECT is(
  (SELECT visibility_inherited FROM public.admin_club_groups(
     current_setting('test.club_secret')::uuid) LIMIT 1),
  true, 'flaga dziedziczenia jest ustawiona, gdy kolumna grupy jest NULL'
);

SELECT * FROM finish();
ROLLBACK;
