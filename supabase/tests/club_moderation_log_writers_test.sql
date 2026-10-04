-- ============================================================================
-- pgTAP: zapisujący do `club_moderation_log` przechodzą przez REALNE
-- ograniczenia tabeli (migracja 20261004090000).
--
-- Trzy funkcje pisały do dziennika wartości, których żadna wersja białych
-- list CHECK nie dopuszczała, więc kończyły się 23514 i wycofaniem całej
-- transakcji:
--   * `club_update_settings` - ('club_updated', 'club'): zapis ustawień klubu
--     przez prowadzącego i administratora padał zawsze,
--   * `club_propose` - `club_members.invite_source = 'proposal'`, potem
--     ('club_proposed', 'club'): żadna propozycja klubu nie powstawała,
--   * `admin_club_invite_segment` - target_type 'club': kampania padała
--     dokładnie wtedy, gdy kogoś zapraszała.
-- Testy okładki dochodziły tylko do wcześniejszego 22023, a testy Vitest
-- mockują RPC - nic nie wołało INSERT-u do dziennika. Ten plik woła każdą
-- funkcję ścieżką szczęśliwą i przybija wiersz dziennika, a także bramki,
-- które poszerzenie słowników odsłoniło (prowadzący klubu
-- zarchiwizowanego, kampania na klub cudzego najemcy, kampania mianująca
-- prowadzących). Strażnik całej klasy - literał zapisywany przez dowolną
-- funkcję vs. biała lista CHECK dowolnej tabeli - żyje w
-- `check_whitelist_writers_test.sql`.
--
-- Wywołania idą rolą właściciela z tożsamością w `request.jwt.claims` - jak
-- w `club_cover_write_capabilities_test.sql`: funkcje są SECURITY DEFINER
-- i rozstrzygają wołającego z JWT.
-- ============================================================================
BEGIN;
SELECT plan(51);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, name, slug)
VALUES ('11111111-1111-1111-1111-111111111111', 'Tenant A', 'tenant-a-club-modlog-test'),
       ('22222222-2222-2222-2222-222222222222', 'Tenant B', 'tenant-b-club-modlog-test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('eeeeeeee-0000-0000-0000-000000000001', 'modlog-admin-a@test.local'),
       ('eeeeeeee-0000-0000-0000-000000000002', 'modlog-lead@test.local'),
       ('eeeeeeee-0000-0000-0000-000000000003', 'modlog-moderator@test.local'),
       ('eeeeeeee-0000-0000-0000-000000000004', 'modlog-member@test.local'),
       ('eeeeeeee-0000-0000-0000-000000000005', 'modlog-proposer@test.local'),
       ('eeeeeeee-0000-0000-0000-000000000006', 'modlog-super@test.local'),
       ('eeeeeeee-0000-0000-0000-000000000007', 'modlog-candidate@test.local'),
       ('eeeeeeee-0000-0000-0000-000000000008', 'modlog-hidden@test.local'),
       ('eeeeeeee-0000-0000-0000-000000000009', 'modlog-archived-lead@test.local'),
       ('eeeeeeee-0000-0000-0000-000000000010', 'modlog-banned-admin@test.local'),
       ('ffffffff-0000-0000-0000-000000000001', 'modlog-admin-b@test.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, discoverable, specialization)
VALUES ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Admin A', true, NULL),
       ('eeeeeeee-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Lead', true, NULL),
       ('eeeeeeee-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Moderator', true, NULL),
       ('eeeeeeee-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Member', true, 'Energetyka Dziennik'),
       ('eeeeeeee-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Proposer', true, NULL),
       ('eeeeeeee-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Super A', true, NULL),
       ('eeeeeeee-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', 'Candidate', true, 'Energetyka Dziennik'),
       ('eeeeeeee-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Hidden', false, 'Energetyka Dziennik'),
       ('eeeeeeee-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'Archived lead', true, NULL),
       ('eeeeeeee-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 'Banned admin', true, NULL),
       ('ffffffff-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Admin B', true, 'Energetyka Dziennik');

-- super_admin CELOWO bez osobnej roli 'admin' (inwariant super_admin >= admin).
INSERT INTO public.user_roles (user_id, role, tenant_id)
VALUES ('eeeeeeee-0000-0000-0000-000000000001', 'admin', '11111111-1111-1111-1111-111111111111'),
       ('eeeeeeee-0000-0000-0000-000000000006', 'super_admin', '11111111-1111-1111-1111-111111111111'),
       ('eeeeeeee-0000-0000-0000-000000000010', 'admin', '11111111-1111-1111-1111-111111111111'),
       ('ffffffff-0000-0000-0000-000000000001', 'admin', '22222222-2222-2222-2222-222222222222');

SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000001"}', true);
SELECT public.admin_club_upsert(
  '{"slug":"klub-dziennik-test","name_pl":"Dziennik","name_en":"Log","visibility":"members","status":"active"}'::jsonb);
SELECT public.admin_club_upsert(
  '{"slug":"klub-dziennik-archiwum","name_pl":"Archiwum","name_en":"Archive","visibility":"members","status":"active"}'::jsonb);
SELECT set_config('test.club',
  (SELECT id::text FROM public.clubs WHERE slug = 'klub-dziennik-test'
      AND tenant_id = '11111111-1111-1111-1111-111111111111'), true);
SELECT set_config('test.archived',
  (SELECT id::text FROM public.clubs WHERE slug = 'klub-dziennik-archiwum'
      AND tenant_id = '11111111-1111-1111-1111-111111111111'), true);

SELECT public.admin_club_member_upsert(current_setting('test.club')::uuid, m.uid, m.role, 'active', NULL)
  FROM (VALUES
    ('eeeeeeee-0000-0000-0000-000000000002'::uuid, 'lead'),
    ('eeeeeeee-0000-0000-0000-000000000003'::uuid, 'moderator'),
    ('eeeeeeee-0000-0000-0000-000000000004'::uuid, 'member')
  ) AS m(uid, role);
-- Administrator najemcy zbanowany w TYM klubie: `club_capabilities` odmawia mu
-- wszystkiego, więc przycisk ustawień się nie pokazuje - RPC też ma odmówić.
SELECT public.admin_club_member_upsert(current_setting('test.club')::uuid,
  'eeeeeeee-0000-0000-0000-000000000010', 'member', 'banned', NULL);
SELECT public.admin_club_member_upsert(current_setting('test.archived')::uuid,
  'eeeeeeee-0000-0000-0000-000000000009', 'lead', 'active', NULL);
SELECT public.admin_club_upsert(jsonb_build_object('id', current_setting('test.archived'), 'status', 'archived'));
SELECT set_config('test.foreign_group',
  (SELECT id::text FROM public.club_groups WHERE club_id = current_setting('test.archived')::uuid LIMIT 1), true);

-- Wpisy fikstury (member_add) nie są przedmiotem testu - liczymy od zera.
DELETE FROM public.club_moderation_log
 WHERE club_id IN (current_setting('test.club')::uuid, current_setting('test.archived')::uuid);

-- ----------------------------------------------------------------------------
-- 1. Słowniki i uprawnienia
-- ----------------------------------------------------------------------------
SELECT ok((SELECT pg_get_constraintdef(oid) FROM pg_constraint
            WHERE conrelid = 'public.club_moderation_log'::regclass
              AND conname = 'club_moderation_log_action_check')
          ~ '''club_updated''.*''club_proposed''',
  'action CHECK zna club_updated i club_proposed');
SELECT ok((SELECT pg_get_constraintdef(oid) FROM pg_constraint
            WHERE conrelid = 'public.club_moderation_log'::regclass
              AND conname = 'club_moderation_log_action_check')
          ~ '''invite_segment''',
  'action CHECK nadal zna invite_segment - poszerzenie nie cofnęło wcześniejszych wartości');
SELECT ok((SELECT pg_get_constraintdef(oid) FROM pg_constraint
            WHERE conrelid = 'public.club_moderation_log'::regclass
              AND conname = 'club_moderation_log_target_type_check')
          ~ '''club''',
  'target_type CHECK zna club');
SELECT ok((SELECT pg_get_constraintdef(oid) FROM pg_constraint
            WHERE conrelid = 'public.club_members'::regclass
              AND conname = 'club_members_invite_source_check')
          ~ '''proposal''',
  'invite_source CHECK zna proposal');
SELECT throws_ok(
  format($q$ INSERT INTO public.club_moderation_log (tenant_id, club_id, action, target_type, target_id)
             VALUES ('11111111-1111-1111-1111-111111111111', '%s', 'bogus', 'club', '%s') $q$,
         current_setting('test.club'), current_setting('test.club')),
  '23514', NULL, 'action pozostaje białą listą - wartość spoza słownika odpada');
SELECT throws_ok(
  format($q$ INSERT INTO public.club_moderation_log (tenant_id, club_id, action, target_type, target_id)
             VALUES ('11111111-1111-1111-1111-111111111111', '%s', 'edit', 'bogus', '%s') $q$,
         current_setting('test.club'), current_setting('test.club')),
  '23514', NULL, 'target_type pozostaje białą listą');
SELECT ok(NOT has_function_privilege('anon', 'public.club_update_settings(uuid, jsonb)', 'EXECUTE'),
  'anon nie wykonuje club_update_settings - ACL zgubiony przez DROP w 20260919220300 wrócił');
SELECT ok(has_function_privilege('authenticated', 'public.club_update_settings(uuid, jsonb)', 'EXECUTE'),
  'authenticated wykonuje club_update_settings');
SELECT ok(NOT has_function_privilege('anon', 'public.club_set_cover_position(uuid, smallint)', 'EXECUTE'),
  'anon nie wykonuje club_set_cover_position');
SELECT ok(NOT has_function_privilege('anon',
            'public.admin_club_invite_segment(uuid, jsonb, text, text, uuid, boolean, integer)', 'EXECUTE'),
  'anon nie wykonuje admin_club_invite_segment');

-- ----------------------------------------------------------------------------
-- 2. club_update_settings - zgłoszony defekt
-- ----------------------------------------------------------------------------
-- Ładunek dokładnie taki, jaki buduje ClubSettingsDialog.
SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000002"}', true);
SELECT is(public.club_update_settings(current_setting('test.club')::uuid,
  '{"name_pl":"Dziennik nowy","tagline_pl":"Podtytuł","tagline_en":null,"description_pl":"Opis",
    "description_en":null,"rules_pl":null,"rules_en":null,"policy_area":null,
    "who_can_post":"staff_only","join_policy":"invite"}'::jsonb),
  true, 'prowadzący zapisuje ustawienia klubu');
SELECT results_eq(
  format($q$ SELECT name_pl, tagline_pl, description_pl, who_can_post, join_policy
               FROM public.clubs WHERE id = '%s' $q$, current_setting('test.club')),
  $$ VALUES ('Dziennik nowy'::text, 'Podtytuł'::text, 'Opis'::text, 'staff_only'::text, 'invite'::text) $$,
  'zmiany prowadzącego są w wierszu klubu');
SELECT results_eq(
  format($q$ SELECT tenant_id, moderator_id, action, target_type, target_id, reason
               FROM public.club_moderation_log WHERE club_id = '%s' $q$, current_setting('test.club')),
  format($q$ VALUES ('11111111-1111-1111-1111-111111111111'::uuid, 'eeeeeeee-0000-0000-0000-000000000002'::uuid,
                     'club_updated'::text, 'club'::text, '%s'::uuid,
                     'description_pl,join_policy,name_pl,tagline_pl,who_can_post'::text) $q$,
         current_setting('test.club')),
  'jeden wpis club_updated/club z listą ZMIENIONYCH kolumn, nie kluczy ładunku');
SELECT is(public.club_update_settings(current_setting('test.club')::uuid,
  '{"name_pl":"Dziennik nowy","tagline_pl":"Podtytuł","who_can_post":"staff_only"}'::jsonb),
  false, 'ponowny zapis bez różnic zwraca false - komunikat nie było czego zapisać');
SELECT is((SELECT count(*)::int FROM public.club_moderation_log
            WHERE club_id = current_setting('test.club')::uuid), 1,
  'zapis bez różnic nie dopisuje wpisu do dziennika');

SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000001"}', true);
SELECT is(public.club_update_settings(current_setting('test.club')::uuid, '{"layout":"cards"}'::jsonb),
  true, 'administrator najemcy zapisuje ustawienia');
SELECT results_eq(
  format($q$ SELECT moderator_id, reason FROM public.club_moderation_log
              WHERE club_id = '%s' AND moderator_id = 'eeeeeeee-0000-0000-0000-000000000001' $q$,
         current_setting('test.club')),
  $$ VALUES ('eeeeeeee-0000-0000-0000-000000000001'::uuid, 'layout'::text) $$,
  'wpis administratora wskazuje jego i zmienioną kolumnę');
SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000006"}', true);
SELECT is(public.club_update_settings(current_setting('test.club')::uuid, '{"rules_pl":"Zasady"}'::jsonb),
  true, 'super_admin bez roli admin zapisuje ustawienia');

SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000003"}', true);
SELECT throws_ok(
  format($q$ SELECT public.club_update_settings('%s'::uuid, '{"tagline_pl":"x"}'::jsonb) $q$, current_setting('test.club')),
  '42501', 'clubs: forbidden', 'moderator nie zmienia ustawień klubu');
SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000004"}', true);
SELECT throws_ok(
  format($q$ SELECT public.club_update_settings('%s'::uuid, '{"tagline_pl":"x"}'::jsonb) $q$, current_setting('test.club')),
  '42501', 'clubs: forbidden', 'członek nie zmienia ustawień klubu');
SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000009"}', true);
SELECT throws_ok(
  format($q$ SELECT public.club_update_settings('%s'::uuid, '{"tagline_pl":"x"}'::jsonb) $q$, current_setting('test.archived')),
  '42501', 'clubs: forbidden', 'prowadzący klubu zarchiwizowanego nie zmienia ustawień - jak okładka');
SELECT set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-000000000001"}', true);
SELECT throws_ok(
  format($q$ SELECT public.club_update_settings('%s'::uuid, '{"tagline_pl":"x"}'::jsonb) $q$, current_setting('test.club')),
  '42501', 'clubs: not found', 'administrator innego najemcy nie widzi klubu');
SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000010"}', true);
SELECT throws_ok(
  format($q$ SELECT public.club_update_settings('%s'::uuid, '{"tagline_pl":"x"}'::jsonb) $q$, current_setting('test.club')),
  '42501', 'clubs: forbidden', 'administrator zbanowany w klubie nie omija bramki - ten sam predykat co przycisk');
SELECT set_config('request.jwt.claims', '', true);
SELECT throws_ok(
  format($q$ SELECT public.club_update_settings('%s'::uuid, '{"tagline_pl":"x"}'::jsonb) $q$, current_setting('test.club')),
  '42501', 'clubs: sign in required', 'anonim odrzucony');

SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000001"}', true);
SELECT is(public.club_update_settings(current_setting('test.archived')::uuid, '{"tagline_pl":"Archiwalny"}'::jsonb),
  true, 'administracja zmienia dane klubu zarchiwizowanego');
SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000002"}', true);
SELECT throws_ok(
  format($q$ SELECT public.club_update_settings('%s'::uuid, '{"visibility":"public"}'::jsonb) $q$, current_setting('test.club')),
  '22023', 'clubs: invalid settings', 'klucz spoza ustawień odrzucony, zamiast udawać zmianę w dzienniku');
-- Kolor akcentu ląduje w atrybucie `style` renderowanym SSR na stronach
-- publicznych - dowolny tekst od prowadzącego to wstrzyknięcie CSS.
SELECT throws_ok(
  format($q$ SELECT public.club_update_settings('%s'::uuid,
             '{"accent_color":"red;position:fixed;inset:0;background:url(https://evil.example/x.png)"}'::jsonb) $q$,
         current_setting('test.club')),
  '22023', 'clubs: invalid settings', 'kolor akcentu nie jest ustawieniem prowadzącego - zmienia go administracja');
SELECT throws_ok(
  format($q$ SELECT public.club_update_settings('%s'::uuid, '{"icon":"scale"}'::jsonb) $q$, current_setting('test.club')),
  '22023', 'clubs: invalid settings', 'ikona nie jest ustawieniem prowadzącego');
SELECT throws_ok(
  format($q$ SELECT public.club_update_settings('%s'::uuid, '{"tagline_pl":{"a":1}}'::jsonb) $q$, current_setting('test.club')),
  '22023', 'clubs: invalid settings', 'wartość niebędąca tekstem odrzucona');
SELECT throws_ok(
  format($q$ SELECT public.club_update_settings('%s'::uuid, '{"cover_image_url":"https://x.example/a.png"}'::jsonb) $q$,
         current_setting('test.club')),
  '22023', 'clubs: cover is written by club_set_cover', 'okładka nadal tylko przez club_set_cover');
SELECT throws_ok(
  format($q$ SELECT public.club_update_settings('%s'::uuid, '{"layout":"editorial"}'::jsonb) $q$, current_setting('test.club')),
  '22023', 'clubs: invalid layout', 'układ katalogu editorial nie jest układem strony klubu');
SELECT is((SELECT count(*)::int FROM public.club_moderation_log
            WHERE club_id = current_setting('test.club')::uuid AND action = 'club_updated'), 3,
  'odmowy nie zostawiają wpisów - trzy udane zapisy, trzy wpisy');

-- ----------------------------------------------------------------------------
-- 3. club_propose
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000005"}', true);
SELECT lives_ok($$
  SELECT set_config('test.proposal',
    public.club_propose('{"name_pl":"Klub Łódzki Dziennik","motivation":"Brakuje go"}'::jsonb)::text, true)
$$, 'członek najemcy zgłasza klub');
SELECT is(current_setting('test.proposal')::jsonb->>'status', 'draft', 'propozycja powstaje jako szkic');
SELECT results_eq(
  format($q$ SELECT user_id, role, status, invite_source FROM public.club_members WHERE club_id = '%s' $q$,
         current_setting('test.proposal')::jsonb->>'id'),
  $$ VALUES ('eeeeeeee-0000-0000-0000-000000000005'::uuid, 'lead'::text, 'active'::text, 'proposal'::text) $$,
  'zgłaszający jest prowadzącym szkicu z invite_source proposal');
SELECT results_eq(
  format($q$ SELECT moderator_id, action, target_type, target_id::text, reason
               FROM public.club_moderation_log WHERE club_id = '%s' $q$,
         current_setting('test.proposal')::jsonb->>'id'),
  format($q$ VALUES ('eeeeeeee-0000-0000-0000-000000000005'::uuid, 'club_proposed'::text, 'club'::text,
                     '%s'::text, 'Brakuje go'::text) $q$,
         current_setting('test.proposal')::jsonb->>'id'),
  'jeden wpis club_proposed/club z motywacją');
SELECT throws_ok(
  format($q$ SELECT public.club_update_settings('%s'::uuid, '{"tagline_pl":"x"}'::jsonb) $q$,
         current_setting('test.proposal')::jsonb->>'id'),
  '42501', 'clubs: forbidden', 'szkic zmienia tylko administracja - zgłaszający nie ma can_moderate');
-- Slug: `left(…, 80)` urywał nazwę na separatorze i zostawiał myślnik na
-- końcu, co łamie `clubs_slug_format`.
SELECT is(public.club_propose(jsonb_build_object('name_pl', repeat('a', 79) || ' bcd'))->>'slug',
  repeat('a', 79), 'slug przycięty do 80 znaków nie kończy się myślnikiem');
SELECT is(public.club_propose(jsonb_build_object('name_pl', repeat('b', 73) || ' cdef'))->>'slug',
  repeat('b', 73) || '-cdef', 'pierwszy slug bez kolizji');
SELECT is(public.club_propose(jsonb_build_object('name_pl', repeat('b', 73) || ' cdef'))->>'slug',
  repeat('b', 73) || '-2', 'slug z sufiksem kolizji nie ma podwójnego myślnika');

-- ----------------------------------------------------------------------------
-- 4. admin_club_invite_segment
-- ----------------------------------------------------------------------------
SELECT set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-0000-0000-000000000001"}', true);
SELECT is((SELECT will_send FROM public.admin_club_segment_preview(current_setting('test.club')::uuid,
            '{"kind":"specialization","value":"energetyka dziennik"}'::jsonb)), 1,
  'podgląd: jedna osoba - ukryty profil i obecny członek odpadają');
SELECT lives_ok($$
  SELECT set_config('test.campaign', (SELECT row_to_json(r)::text FROM public.admin_club_invite_segment(
    current_setting('test.club')::uuid,
    '{"kind":"specialization","value":"energetyka dziennik","name":"Energetycy"}'::jsonb) r), true)
$$, 'kampania z co najmniej jednym odbiorcą przechodzi przez CHECK dziennika');
SELECT is((current_setting('test.campaign')::json->>'invited')::int, 1, 'kampania zaprasza jedną osobę');
SELECT results_eq(
  format($q$ SELECT moderator_id, action, target_type, target_id, reason FROM public.club_moderation_log
              WHERE club_id = '%s' AND action = 'invite_segment' $q$, current_setting('test.club')),
  format($q$ VALUES ('eeeeeeee-0000-0000-0000-000000000001'::uuid, 'invite_segment'::text, 'club'::text,
                     '%s'::uuid, 'segment: specialization, invited: 1'::text) $q$, current_setting('test.club')),
  'jeden wpis invite_segment/club');
SELECT results_eq(
  format($q$ SELECT invitee_id, club_role, status FROM public.club_invitations WHERE club_id = '%s' $q$,
         current_setting('test.club')),
  $$ VALUES ('eeeeeeee-0000-0000-0000-000000000007'::uuid, 'member'::text, 'pending'::text) $$,
  'zaproszenie trafia wyłącznie do widocznego nie-członka');
SELECT results_eq(
  $$ SELECT invited, rule_id FROM public.admin_club_invite_segment(current_setting('test.club')::uuid,
       '{"kind":"specialization","value":"energetyka dziennik"}'::jsonb) $$,
  $$ VALUES (0, NULL::uuid) $$,
  'powtórka nie zaprasza ponownie i nie zapisuje reguły');
SELECT throws_ok(
  format($q$ SELECT * FROM public.admin_club_invite_segment('%s'::uuid,
             '{"kind":"specialization","value":"energetyka dziennik"}'::jsonb, 'lead') $q$, current_setting('test.club')),
  '22023', NULL, 'kampania masowa nie mianuje prowadzących');
SELECT throws_ok(
  format($q$ SELECT * FROM public.admin_club_invite_segment('%s'::uuid,
             '{"kind":"specialization","value":"energetyka dziennik"}'::jsonb, 'member', NULL, '%s'::uuid) $q$,
         current_setting('test.club'), current_setting('test.foreign_group')),
  '22023', 'clubs: group not in club', 'dział musi należeć do tego klubu');

SELECT set_config('request.jwt.claims', '{"sub":"ffffffff-0000-0000-0000-000000000001"}', true);
SELECT throws_ok(
  format($q$ SELECT * FROM public.admin_club_invite_segment('%s'::uuid,
             '{"kind":"specialization","value":"energetyka dziennik"}'::jsonb) $q$, current_setting('test.club')),
  '42501', 'clubs: not found', 'administrator najemcy B nie prowadzi kampanii w klubie najemcy A');
SELECT throws_ok(
  format($q$ SELECT * FROM public.admin_club_segment_preview('%s'::uuid,
             '{"kind":"specialization","value":"energetyka dziennik"}'::jsonb) $q$, current_setting('test.club')),
  '42501', 'clubs: not found', 'administrator najemcy B nie widzi liczności cudzego klubu');
SELECT is((SELECT count(*)::int FROM public.club_invitations
            WHERE invitee_id = 'ffffffff-0000-0000-0000-000000000001'), 0,
  'żadne zaproszenie nie przekroczyło granicy najemcy');

SELECT * FROM finish();
ROLLBACK;
