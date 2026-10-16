-- ============================================================================
-- pgTAP: konto założone z zaproszenia rodzi się w najemcy DOMYŚLNYM, a zapis
-- kluczem serwisowym przenosi je do najemcy zaproszenia.
--
-- PO CO TO STOI. `performSend` (`src/lib/admin/invitations.functions.ts`)
-- woła `createUser`, a `handle_new_user` (20260805083149) zakłada profil
-- nowego konta w tej samej transakcji - w najemcy domyślnym, bez względu na
-- metadane. Pierwsza wersja granicy najemcy w `performSend` porównywała ten
-- profil z najemcą zaproszenia i odmawiała (`account_in_other_tenant`) KAŻDEMU
-- zaproszeniu nowej osoby do organizacji innej niż domyślna. Testy Vitest
-- tego nie widziały, bo atrapa udawała, że nowe konto nie ma profilu.
--
-- Decyzja w TypeScripcie (`resolveInviteTarget`, wiersz „profil w najemcy
-- domyślnym + `app_metadata.tenant_id` = najemca zaproszenia -> dowiązanie")
-- stoi na dwóch faktach o bazie, które ten plik przypina:
--   1. profil i rola `user` nowego konta powstają w najemcy domyślnym, także
--      gdy `raw_app_meta_data` i `raw_user_meta_data` niosą najemcę
--      zaproszenia - więc „profil u obcego" nie może znaczyć „odmowa" dla
--      konta, które `performSend` właśnie założyło;
--   2. hydracja w kształcie zapytań PostgREST-u (upsert `profiles` po `id`,
--      `author_profiles` po `user_id`, `user_roles` po
--      `(tenant_id, user_id, role)`) wykonana rolą serwisową przenosi profil
--      do najemcy zaproszenia i zakłada w nim rolę - bez błędu.
-- Jeśli `handle_new_user` zacznie zakładać profil od razu w najemcy
-- zaproszenia albo baza zablokuje przeniesienie (zlecenie, A4), ten plik
-- zrobi się czerwony i trzeba będzie świadomie przepiąć obie strony.
--
-- Wyzwalacze `auth.users` CELOWO WŁĄCZONE - wbrew konwencji części suity -
-- bo przedmiotem testu jest właśnie to, co robi `on_auth_user_created`.
-- ============================================================================
BEGIN;
SELECT plan(14);

INSERT INTO public.tenants (id, name, slug)
VALUES ('c7000000-0000-4000-8000-00000000000a', 'Organizacja A', 'org-a-invite-birth')
ON CONFLICT (id) DO NOTHING;

SELECT set_config('test.default_tenant',
  (SELECT COALESCE(
     (SELECT id FROM public.tenants WHERE is_default LIMIT 1),
     (SELECT id FROM public.tenants WHERE slug = 'nes' LIMIT 1))::text), true);

SELECT isnt(current_setting('test.default_tenant', true), NULL,
  'fikstura: najemca domyślny istnieje - bez niego handle_new_user nie zakłada kont');
SELECT isnt(current_setting('test.default_tenant')::uuid, 'c7000000-0000-4000-8000-00000000000a'::uuid,
  'fikstura: organizacja zaproszenia NIE jest najemcą domyślnym - to jest przypadek defektu');

-- Konto w kształcie, w jakim zakłada je `createUser` z `performSend`:
-- `app_metadata` z najemcą narodzin (pisze je tylko klucz serwisowy) i
-- `user_metadata` z nazwą i najemcą (dla UI, niczego nie poświadcza).
INSERT INTO auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
VALUES ('c7000000-0000-4000-8000-0000000000f1', 'nowa-osoba-zaproszenie@example.org',
        '{"provider":"email","providers":["email"],"tenant_id":"c7000000-0000-4000-8000-00000000000a"}',
        '{"display_name":"Nowa Osoba","tenant_id":"c7000000-0000-4000-8000-00000000000a"}');

-- 1. Narodziny -----------------------------------------------------------------
SELECT is((SELECT tenant_id FROM public.profiles WHERE id = 'c7000000-0000-4000-8000-0000000000f1'),
  current_setting('test.default_tenant')::uuid,
  'handle_new_user zakłada profil nowego konta w najemcy DOMYŚLNYM mimo najemcy zaproszenia w metadanych');
SELECT results_eq(
  $$ SELECT role::text, tenant_id FROM public.user_roles
      WHERE user_id = 'c7000000-0000-4000-8000-0000000000f1' $$,
  $$ VALUES ('user'::text, current_setting('test.default_tenant')::uuid) $$,
  'rola startowa `user` też stoi w najemcy domyślnym');
SELECT ok((SELECT slug IS NOT NULL FROM public.profiles WHERE id = 'c7000000-0000-4000-8000-0000000000f1'),
  'profil narodzin ma już slug - performSend zachowuje go zamiast liczyć z nazwy');
SELECT set_config('test.birth_slug',
  (SELECT slug FROM public.profiles WHERE id = 'c7000000-0000-4000-8000-0000000000f1'), true);

-- 2. Hydracja rolą serwisową, w kształcie zapytań PostgREST-u -----------------
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT lives_ok($$
  INSERT INTO public.profiles (id, tenant_id, email, display_name, slug, job_title)
  VALUES ('c7000000-0000-4000-8000-0000000000f1', 'c7000000-0000-4000-8000-00000000000a',
          'nowa-osoba-zaproszenie@example.org', 'Nowa Osoba', current_setting('test.birth_slug'),
          'Analityczka')
  ON CONFLICT (id) DO UPDATE SET
    tenant_id = EXCLUDED.tenant_id, email = EXCLUDED.email,
    display_name = EXCLUDED.display_name, slug = EXCLUDED.slug, job_title = EXCLUDED.job_title
$$, 'upsert profilu kluczem serwisowym przenosi konto z najemcy domyślnego do najemcy zaproszenia');

SELECT lives_ok($$
  INSERT INTO public.author_profiles (user_id, tenant_id, contact_email, is_public)
  VALUES ('c7000000-0000-4000-8000-0000000000f1', 'c7000000-0000-4000-8000-00000000000a',
          'nowa-osoba-zaproszenie@example.org', true)
  ON CONFLICT (user_id) DO UPDATE SET
    tenant_id = EXCLUDED.tenant_id, contact_email = EXCLUDED.contact_email, is_public = EXCLUDED.is_public
$$, 'upsert profilu autora w najemcy zaproszenia');

SELECT lives_ok($$
  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES ('c7000000-0000-4000-8000-0000000000f1', 'author', 'c7000000-0000-4000-8000-00000000000a')
  ON CONFLICT (tenant_id, user_id, role) DO NOTHING
$$, 'rola z zaproszenia po celu USER_ROLES_CONFLICT_TARGET (tenant_id, user_id, role)');

SELECT lives_ok($$
  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES ('c7000000-0000-4000-8000-0000000000f1', 'author', 'c7000000-0000-4000-8000-00000000000a')
  ON CONFLICT (tenant_id, user_id, role) DO NOTHING
$$, 'ponowna wysyłka nie potyka się o istniejącą rolę');

SELECT throws_ok($$
  INSERT INTO public.user_roles (user_id, role, tenant_id)
  VALUES ('c7000000-0000-4000-8000-0000000000f1', 'author', 'c7000000-0000-4000-8000-00000000000a')
  ON CONFLICT (user_id, role) DO NOTHING
$$, '42P10', NULL, 'dawny cel `user_id,role` nie ma indeksu - dlatego cel musi nieść najemcę');

RESET ROLE;

-- 3. Stan po hydracji ------------------------------------------------------------
SELECT results_eq(
  $$ SELECT tenant_id, slug FROM public.profiles WHERE id = 'c7000000-0000-4000-8000-0000000000f1' $$,
  $$ VALUES ('c7000000-0000-4000-8000-00000000000a'::uuid, current_setting('test.birth_slug')) $$,
  'profil stoi w najemcy zaproszenia z niezmienionym slugiem narodzin');
SELECT is((SELECT tenant_id FROM public.author_profiles WHERE user_id = 'c7000000-0000-4000-8000-0000000000f1'),
  'c7000000-0000-4000-8000-00000000000a'::uuid,
  'profil autora w najemcy zaproszenia');
SELECT is((SELECT count(*)::int FROM public.user_roles
            WHERE user_id = 'c7000000-0000-4000-8000-0000000000f1'
              AND tenant_id = 'c7000000-0000-4000-8000-00000000000a' AND role = 'author'), 1,
  'dokładnie jedna rola z zaproszenia w najemcy zaproszenia');
SELECT is((SELECT raw_app_meta_data->>'tenant_id' FROM auth.users
            WHERE id = 'c7000000-0000-4000-8000-0000000000f1'),
  'c7000000-0000-4000-8000-00000000000a',
  'poświadczenie najemcy narodzin zostaje na koncie - po nim ponowienie dowiązuje konto przerwanej wysyłki');

SELECT * FROM finish();
ROLLBACK;
