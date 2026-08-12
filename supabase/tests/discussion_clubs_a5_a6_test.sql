-- ============================================================================
-- pgTAP: Discussion Club, etapy A5 i A6 - moderacja i odkrywalnosc.
--
-- Najwazniejsza asercja: UJAWNIENIE AUTORA BEZ POWODU MUSI SIE NIE UDAC.
-- Regula Chatham House jest warta tyle, ile warta jest kontrola nad wyjatkiem
-- od niej. Ujawnienie bez uzasadnienia to ujawnienie, ktorego nikt pozniej nie
-- umie obronic - stad powod obowiazkowy i slad w dwoch miejscach.
--
-- ROLA BAZY W FIKSTURACH (2026-08-12). Adminowe RPC (`admin_club_*`) wolamy
-- rola WLASCICIELA, nie `authenticated`. Sa SECURITY DEFINER i rozstrzygaja
-- tenanta oraz tozsamosc z JWT (`request.jwt.claims`), nie z roli bazy -
-- przedmiotem tych wywolan jest zachowanie FUNKCJI, a przelaczanie roli bylo
-- w nich infrastruktura fikstury, ktora w CI przewracala plik na pierwszym
-- wywolaniu RPC po `SET LOCAL ROLE authenticated`. Kontrakt grantu EXECUTE,
-- dotad sprawdzany NIEJAWNIE przez samo wywolanie w roli klienta, jest teraz
-- przybity osobnymi asercjami `has_function_privilege` - w obie strony: dla
-- adminowych RPC grant MUSI byc, dla `club_scheduler_tick` i zapisu wektora
-- MUSI go nie byc.
-- Pod rola klienta zostaja sciezki, w ktorych rola/tozsamosc wolajacego jest
-- istota testu: `club_create_thread`, `club_reply`, `club_moderate`,
-- `club_moderator_reveal_author` (takze odmowa dla prowadzacego), `club_search`.
-- ============================================================================
BEGIN;
SELECT plan(24);

-- `handle_new_user` zalozylby profil w tenancie DOMYSLNYM, a
-- `profiles_pin_tenant_id` nie pozwala go potem przeniesc (tenant konta jest
-- niezmienny poza sciezka service_role). Profil musi wiec powstac od razu
-- w docelowym tenancie - z wylaczonym triggerem signupu i wprost.
ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, name, slug)
VALUES ('11111111-1111-1111-1111-111111111111', 'Tenant A', 'tenant-a-mod-test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@mod.local'),
       ('aaaaaaaa-0000-0000-0000-000000000003', 'member@mod.local'),
       ('aaaaaaaa-0000-0000-0000-000000000005', 'lead@mod.local')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, discoverable)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Admin', true),
       ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Czlonek', true),
       ('aaaaaaaa-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Prowadzacy', true);

-- Rola jest wazna W TENANCIE (has_role porownuje tenant_id z tenantem
-- wolajacego), wiec fixture musi podac tenanta wprost.
INSERT INTO public.user_roles (user_id, role, tenant_id)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'admin', '11111111-1111-1111-1111-111111111111');

-- ----------------------------------------------------------------------------
-- Struktura
-- ----------------------------------------------------------------------------
SELECT has_table('public','club_moderation_log','log moderacji istnieje');
SELECT has_table('public','club_thread_embeddings','tabela wektorow istnieje');

SELECT is_empty(
  $$ SELECT table_name FROM information_schema.role_table_grants
      WHERE table_schema='public'
        AND table_name IN ('club_moderation_log','club_thread_embeddings')
        AND grantee IN ('anon','authenticated') $$,
  'tabele A5/A6 nie maja grantow dla klienta'
);

SELECT has_function('public','club_scheduler_tick', ARRAY[]::text[],
  'club_scheduler_tick istnieje');
SELECT has_function('public','club_search', ARRAY['text','uuid','integer'],
  'club_search istnieje');

-- Harmonogram jest WYLACZNIE serwerowy - klient nie moze go odpalic.
SELECT is_empty(
  $$ SELECT 1 WHERE has_function_privilege('authenticated',
       'public.club_scheduler_tick()', 'EXECUTE') $$,
  'club_scheduler_tick nie jest wykonywalny dla klienta'
);

SELECT is_empty(
  $$ SELECT 1 WHERE has_function_privilege('authenticated',
       'public.club_upsert_thread_embedding(uuid, double precision[], text)', 'EXECUTE') $$,
  'zapis wektora jest wylacznie serwerowy'
);

-- ----------------------------------------------------------------------------
-- Druga strona tego samego kontraktu: adminowe RPC klient wykonywac MUSI
--
-- Dotad wychodzilo to ubocznie z tego, ze fikstura wolala te funkcje pod rola
-- `authenticated`. Pokrycie bylo przypadkowe i bezimienne; teraz kazda
-- adminowa funkcja tego pliku ma wlasna asercje grantu, symetryczna do dwoch
-- asercji zaprzeczajacych wyzej.
-- ----------------------------------------------------------------------------
SELECT ok(
  has_function_privilege('authenticated', 'public.admin_club_upsert(jsonb)', 'EXECUTE'),
  'authenticated ma EXECUTE na admin_club_upsert(jsonb)'
);
SELECT ok(
  has_function_privilege('authenticated',
    'public.admin_club_member_upsert(uuid, uuid, text, text, timestamptz, boolean)', 'EXECUTE'),
  'authenticated ma EXECUTE na admin_club_member_upsert(uuid, uuid, text, text, timestamptz, boolean)'
);

-- ----------------------------------------------------------------------------
-- Fixture
-- ----------------------------------------------------------------------------
-- Podzial rol: adminowe RPC i odczyty tabel modulu ida rola WLASCICIELA (grant
-- dla klienta ma wlasne asercje wyzej, a do tabel klient nie ma zadnego
-- grantu); sciezki uzytkownika i moderatora ida rola klienta. Baza po
-- migracjach nie jest pusta - 20260808220000 seeduje klub referencyjny
-- z watkami i odpowiedziami - wiec kazde pytanie o "watek" albo "odpowiedz"
-- wskazuje wiersz TEGO testu przez GUC, nie pierwszy wiersz tabeli.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001"}';

SELECT public.admin_club_upsert(
  '{"slug":"klub-moderacja","name_pl":"Klub moderacji","name_en":"Moderation club",
    "visibility":"members","who_can_post":"members","moderation_mode":"post",
    "attribution_mode":"chatham","status":"active"}'::jsonb);

SELECT set_config('test.club',
  (SELECT id::text FROM public.clubs WHERE slug='klub-moderacja'), true);
SELECT set_config('test.group',
  (SELECT g.id::text FROM public.club_groups g JOIN public.clubs c ON c.id=g.club_id
    WHERE c.slug='klub-moderacja' LIMIT 1), true);

SELECT public.admin_club_member_upsert(
  current_setting('test.club')::uuid,
  'aaaaaaaa-0000-0000-0000-000000000005', 'lead', 'active', NULL);

SET LOCAL ROLE authenticated;

SELECT public.club_create_thread(
  current_setting('test.group')::uuid,
  'Temat do moderacji', 'Tresc tematu, dluzsza niz dziesiec znakow.',
  'discussion', false, NULL, NULL);

RESET ROLE;
SELECT set_config('test.thread',
  (SELECT t.id::text FROM public.club_threads t JOIN public.clubs c ON c.id=t.club_id
    WHERE c.slug='klub-moderacja'), true);
SET LOCAL ROLE authenticated;

-- ----------------------------------------------------------------------------
-- Moderacja tresci
-- ----------------------------------------------------------------------------
SELECT ok(
  public.club_moderate('thread', current_setting('test.thread')::uuid, 'pin', 'wazne'),
  'admin przypina temat'
);

RESET ROLE;
SELECT ok(
  (SELECT pinned_at IS NOT NULL FROM public.club_threads
    WHERE id = current_setting('test.thread')::uuid),
  'przypiecie zapisane'
);

SELECT is(
  (SELECT count(*)::int FROM public.club_moderation_log
    WHERE action='pin' AND club_id = current_setting('test.club')::uuid),
  1, 'akcja moderacyjna zostawila slad w logu'
);
SET LOCAL ROLE authenticated;

-- Przypiecie nie dotyczy odpowiedzi.
SELECT public.club_reply(current_setting('test.thread')::uuid, 'Odpowiedz', NULL, false);

RESET ROLE;
SELECT set_config('test.reply',
  (SELECT id::text FROM public.club_replies
    WHERE thread_id = current_setting('test.thread')::uuid LIMIT 1), true);
SET LOCAL ROLE authenticated;

SELECT throws_ok(
  format($$ SELECT public.club_moderate('reply','%s','pin',NULL) $$,
    current_setting('test.reply')),
  '22023', NULL, 'przypiecie nie dotyczy odpowiedzi'
);

SELECT ok(
  public.club_moderate('thread', current_setting('test.thread')::uuid, 'lock', NULL),
  'admin zamyka temat'
);

-- Zamkniety temat nie przyjmuje odpowiedzi NAWET od uprawnionego.
SELECT throws_ok(
  format($$ SELECT public.club_reply('%s','Jeszcze jedna',NULL,false) $$,
    current_setting('test.thread')),
  '42501', NULL, 'zamkniety temat nie przyjmuje odpowiedzi'
);

-- ----------------------------------------------------------------------------
-- UJAWNIENIE AUTORA - najwazniejsze asercje pliku
-- ----------------------------------------------------------------------------
SELECT throws_ok(
  format($$ SELECT * FROM public.club_moderator_reveal_author('thread','%s',NULL) $$,
    current_setting('test.thread')),
  '22023', NULL, 'ujawnienie BEZ POWODU jest odrzucane'
);

SELECT throws_ok(
  format($$ SELECT * FROM public.club_moderator_reveal_author('thread','%s','   ') $$,
    current_setting('test.thread')),
  '22023', NULL, 'sam bialy znak nie jest powodem'
);

SELECT lives_ok(
  format($$ SELECT * FROM public.club_moderator_reveal_author('thread','%s','zgloszenie naduzycia') $$,
    current_setting('test.thread')),
  'admin ujawnia autora podajac powod'
);

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.club_moderation_log
    WHERE action='reveal_author' AND club_id = current_setting('test.club')::uuid),
  1, 'ujawnienie zostawilo slad w logu klubu'
);

SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE action='club.reveal_author'),
  1, 'ujawnienie zostawilo slad TAKZE w audycie platformy'
);
SET LOCAL ROLE authenticated;

-- Prowadzacy NIE ujawnia autora: jest strona dyskusji.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000005"}';

SELECT is(
  (SELECT can_reveal_author FROM public.club_capabilities(
     current_setting('test.club')::uuid, NULL,
     'aaaaaaaa-0000-0000-0000-000000000005')),
  false, 'prowadzacy nie ma zdolnosci ujawniania autora'
);

SELECT throws_ok(
  format($$ SELECT * FROM public.club_moderator_reveal_author('thread','%s','ciekawosc') $$,
    current_setting('test.thread')),
  '42501', NULL, 'prowadzacy nie ujawni autora nawet podajac powod'
);

-- ----------------------------------------------------------------------------
-- Wyszukiwanie: puste zapytanie nie zwraca wszystkiego
-- ----------------------------------------------------------------------------
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001"}';

SELECT is_empty(
  $$ SELECT thread_id FROM public.club_search('', NULL, 20) $$,
  'puste zapytanie zwraca zero wynikow, nie caly zbior'
);

SELECT is_empty(
  $$ SELECT thread_id FROM public.club_search('   ', NULL, 20) $$,
  'zapytanie z samych bialych znakow zwraca zero wynikow'
);

SELECT * FROM finish();
ROLLBACK;
