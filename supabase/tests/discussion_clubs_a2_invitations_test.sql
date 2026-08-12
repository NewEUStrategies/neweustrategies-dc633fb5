-- ============================================================================
-- pgTAP: Discussion Club, etap A2 - zaproszenia.
--
-- Najwazniejszy test w tym pliku to ten o roli platformy: sciezka e-mailowa
-- reuzywa user_invitations, gdzie kolumna `role` jest typu public.app_role.
-- Wpisanie tam roli KLUBOWEJ nadaloby komus uprawnienia redakcyjne calej
-- platformy (V2 §3.2). Kontrakt musi pilnowac, ze club_invite_by_email
-- ZAWSZE wpisuje 'user', niezaleznie od zadanej roli klubowej.
--
-- ROLA BAZY W FIKSTURACH (2026-08-12). Adminowe RPC (`admin_club_*`) wolamy
-- rola WLASCICIELA, nie `authenticated`. Sa SECURITY DEFINER i rozstrzygaja
-- tenanta oraz tozsamosc z JWT (`request.jwt.claims`), nie z roli bazy -
-- przedmiotem tych wywolan jest zachowanie FUNKCJI, a przelaczanie roli bylo
-- w nich infrastruktura fikstury, ktora w CI przewracala plik na pierwszym
-- wywolaniu RPC po `SET LOCAL ROLE authenticated`. Kontrakt grantu EXECUTE,
-- dotad sprawdzany NIEJAWNIE przez samo wywolanie w roli klienta, jest teraz
-- przybity osobnymi asercjami `has_function_privilege`.
-- Pod rola klienta zostaja wszystkie wywolania sciezek uzytkownika, w ktorych
-- rola/tozsamosc wolajacego jest istota testu: `club_invite`,
-- `club_invite_by_email`, `club_join`, `club_leave`.
-- ============================================================================
BEGIN;
SELECT plan(23);

-- `handle_new_user` zalozylby profil w tenancie DOMYSLNYM, a
-- `profiles_pin_tenant_id` nie pozwala go potem przeniesc (tenant konta jest
-- niezmienny poza sciezka service_role). Profil musi wiec powstac od razu
-- w docelowym tenancie - z wylaczonym triggerem signupu i wprost.
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, name, slug)
VALUES ('11111111-1111-1111-1111-111111111111', 'Tenant A', 'tenant-a-inv-test'),
       ('22222222-2222-2222-2222-222222222222', 'Tenant B', 'tenant-b-inv-test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'admin-a@inv.local'),
       ('aaaaaaaa-0000-0000-0000-000000000003', 'member-a@inv.local'),
       ('aaaaaaaa-0000-0000-0000-000000000005', 'lead-a@inv.local'),
       ('bbbbbbbb-0000-0000-0000-000000000001', 'user-b@inv.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, discoverable)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Admin A', true),
       ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Member A', true),
       ('aaaaaaaa-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Lead A', true),
       ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'User B', true);

-- Rola jest wazna W TENANCIE (has_role porownuje tenant_id z tenantem
-- wolajacego), wiec fixture musi podac tenanta wprost.
INSERT INTO public.user_roles (user_id, role, tenant_id)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'admin', '11111111-1111-1111-1111-111111111111');

-- ----------------------------------------------------------------------------
-- Struktura
-- ----------------------------------------------------------------------------
SELECT has_table('public', 'club_invitations', 'tabela club_invitations istnieje');
SELECT has_table('public', 'club_invite_links', 'tabela club_invite_links istnieje');
SELECT has_table('public', 'club_invite_link_uses', 'tabela club_invite_link_uses istnieje');

SELECT is_empty(
  $$ SELECT table_name FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name IN ('club_invitations','club_invite_links',
                           'club_invite_link_uses','club_segment_rules')
        AND grantee IN ('anon','authenticated') $$,
  'tabele zaproszen nie maja grantow dla klienta'
);

-- ----------------------------------------------------------------------------
-- Grant EXECUTE dla klienta na adminowych RPC - asercja WPROST
--
-- Dotad ten kontrakt wychodzil ubocznie z tego, ze fikstura wolala te funkcje
-- pod rola `authenticated`. Pokrycie bylo przypadkowe i bezimienne; teraz
-- kazda adminowa funkcja tego pliku ma wlasna asercje grantu.
-- ----------------------------------------------------------------------------
SELECT ok(
  has_function_privilege('authenticated', 'public.admin_club_upsert(jsonb)', 'EXECUTE'),
  'authenticated ma EXECUTE na admin_club_upsert(jsonb)'
);
SELECT ok(
  has_function_privilege('authenticated',
    'public.admin_club_invite_link_create(uuid, text, text, integer, timestamptz, boolean, uuid)',
    'EXECUTE'),
  'authenticated ma EXECUTE na admin_club_invite_link_create(uuid, text, text, integer, timestamptz, boolean, uuid)'
);

-- ----------------------------------------------------------------------------
-- Fixture klubow
--
-- Podzial rol: adminowe RPC i odczyty tabel modulu ida rola WLASCICIELA (grant
-- dla klienta ma wlasne asercje wyzej, a do tabel klient nie ma zadnego
-- grantu), a sciezki uzytkownika - rola klienta. Identyfikatory klubow ida do
-- RPC przez GUC: podzapytanie po id siegneloby do tabeli w blokach, ktore
-- chodza rola klienta.
-- ----------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001"}';

SELECT public.admin_club_upsert(
  '{"slug":"klub-zapro","name_pl":"Klub zaproszeniowy","name_en":"Invite club",
    "visibility":"members","join_policy":"invite","status":"active"}'::jsonb);
SELECT public.admin_club_upsert(
  '{"slug":"klub-otwarty","name_pl":"Klub otwarty","name_en":"Open club",
    "visibility":"members","join_policy":"open","status":"active"}'::jsonb);

SELECT set_config('test.club_invite',
  (SELECT id::text FROM public.clubs WHERE slug='klub-zapro'), true);
SELECT set_config('test.club_open',
  (SELECT id::text FROM public.clubs WHERE slug='klub-otwarty'), true);

-- ----------------------------------------------------------------------------
-- Sciezka A: zaproszenie bezposrednie
-- ----------------------------------------------------------------------------
SET LOCAL ROLE authenticated;

SELECT lives_ok(
  format($$ SELECT public.club_invite('%s','%s','member',NULL,NULL) $$,
    current_setting('test.club_invite'),
    'aaaaaaaa-0000-0000-0000-000000000003'),
  'admin zaprasza czlonka z tego samego tenanta'
);

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.club_invitations i
     JOIN public.clubs c ON c.id = i.club_id
    WHERE c.slug='klub-zapro' AND i.status='pending'),
  1, 'zaproszenie zapisane jako pending'
);
SET LOCAL ROLE authenticated;

-- Osoba z obcego tenanta.
SELECT throws_ok(
  format($$ SELECT public.club_invite('%s','%s','member',NULL,NULL) $$,
    current_setting('test.club_invite'),
    'bbbbbbbb-0000-0000-0000-000000000001'),
  '42501', NULL, 'nie da sie zaprosic osoby z obcego tenanta'
);

-- ----------------------------------------------------------------------------
-- Sciezka B: rola PLATFORMY zawsze 'user'
-- ----------------------------------------------------------------------------
SELECT lives_ok(
  format($$ SELECT public.club_invite_by_email('%s','ktos@zewnatrz.eu','moderator',NULL) $$,
    current_setting('test.club_invite')),
  'admin wysyla zaproszenie e-mailowe z rola klubowa moderator'
);

RESET ROLE;

-- TO JEST NAJWAZNIEJSZA ASERCJA CALEGO MODULU.
SELECT is(
  (SELECT role::text FROM public.user_invitations
    WHERE email='ktos@zewnatrz.eu' AND source='club'),
  'user',
  'rola PLATFORMY w user_invitations to zawsze user, nigdy rola klubowa'
);

SELECT is(
  (SELECT metadata->>'club_role' FROM public.user_invitations
    WHERE email='ktos@zewnatrz.eu' AND source='club'),
  'moderator',
  'rola KLUBOWA jedzie wylacznie w metadata.club_role'
);

SELECT is(
  (SELECT (metadata->>'club_id')::uuid FROM public.user_invitations
    WHERE email='ktos@zewnatrz.eu' AND source='club'),
  current_setting('test.club_invite')::uuid,
  'metadata niesie club_id, wiec trigger wie, gdzie zapisac czlonkostwo'
);

SET LOCAL ROLE authenticated;

SELECT throws_ok(
  format($$ SELECT public.club_invite_by_email('%s','zly-adres','member',NULL) $$,
    current_setting('test.club_invite')),
  '22023', NULL, 'niepoprawny adres e-mail jest odrzucany w bazie'
);

-- Rola klubowa 'lead' nie przechodzi sciezka e-mailowa (nie ma jej w CHECK-u
-- parametru) - prowadzacego nadaje sie imiennie.
SELECT throws_ok(
  format($$ SELECT public.club_invite_by_email('%s','ktos2@zewnatrz.eu','lead',NULL) $$,
    current_setting('test.club_invite')),
  '22023', NULL, 'rola lead nie przechodzi sciezka e-mailowa'
);

-- ----------------------------------------------------------------------------
-- Sciezka C: linki
--
-- Tworzenie linku to pozytywna sciezka administracyjna - rola wlasciciela.
-- ----------------------------------------------------------------------------
RESET ROLE;

SELECT lives_ok(
  format($$ SELECT public.admin_club_invite_link_create('%s','Konferencja','member',2,NULL,false,NULL) $$,
    current_setting('test.club_open')),
  'admin tworzy link zapraszajacy'
);

SELECT ok(
  (SELECT length(token) >= 40 FROM public.club_invite_links LIMIT 1),
  'token linku jest dlugi (32 B w base64url), a nie sekwencyjny'
);

SELECT isnt(
  (SELECT token FROM public.club_invite_links LIMIT 1),
  NULL, 'token zostal wygenerowany'
);

-- ----------------------------------------------------------------------------
-- Samoobsluga: polityka wstepu
--
-- Tu rola klienta zostaje - przedmiotem asercji jest to, co moze sam
-- uzytkownik, a nie zachowanie funkcji adminowej.
-- ----------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000005"}';
SET LOCAL ROLE authenticated;

-- Klub 'invite' nie przyjmuje zgloszen samodzielnych.
SELECT throws_ok(
  format($$ SELECT public.club_join('%s') $$,
    current_setting('test.club_invite')),
  '42501', NULL, 'klub na zaproszenie odrzuca samodzielne dolaczenie'
);

-- Klub 'open' wpuszcza od razu jako active.
SELECT is(
  public.club_join(current_setting('test.club_open')::uuid),
  'active', 'klub otwarty wpuszcza od razu jako active'
);

RESET ROLE;
SELECT is(
  (SELECT member_count FROM public.clubs WHERE slug='klub-otwarty'),
  1, 'trigger policzyl nowego czlonka'
);
SET LOCAL ROLE authenticated;

-- Wyjscie ustawia 'left', nie kasuje wiersza - historia zostaje.
SELECT ok(
  public.club_leave(current_setting('test.club_open')::uuid),
  'czlonek wychodzi z klubu'
);

RESET ROLE;

SELECT is(
  (SELECT m.status FROM public.club_members m
     JOIN public.clubs c ON c.id = m.club_id
    WHERE c.slug='klub-otwarty' AND m.user_id='aaaaaaaa-0000-0000-0000-000000000005'),
  'left', 'wyjscie ustawia status left, nie kasuje czlonkostwa'
);

SELECT * FROM finish();
ROLLBACK;
