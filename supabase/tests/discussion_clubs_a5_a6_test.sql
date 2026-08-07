-- ============================================================================
-- pgTAP: Discussion Club, etapy A5 i A6 - moderacja i odkrywalnosc.
--
-- Najwazniejsza asercja: UJAWNIENIE AUTORA BEZ POWODU MUSI SIE NIE UDAC.
-- Regula Chatham House jest warta tyle, ile warta jest kontrola nad wyjatkiem
-- od niej. Ujawnienie bez uzasadnienia to ujawnienie, ktorego nikt pozniej nie
-- umie obronic - stad powod obowiazkowy i slad w dwoch miejscach.
-- ============================================================================
BEGIN;
SELECT plan(19);

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
       ('aaaaaaaa-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Prowadzacy', true)
ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id;

INSERT INTO public.user_roles (user_id, role)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'admin')
ON CONFLICT DO NOTHING;

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
-- Fixture
-- ----------------------------------------------------------------------------
SET LOCAL role = authenticated;
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001"}';

SELECT public.admin_club_upsert(
  '{"slug":"klub-moderacja","name_pl":"Klub moderacji","name_en":"Moderation club",
    "visibility":"members","who_can_post":"members","moderation_mode":"post",
    "attribution_mode":"chatham","status":"active"}'::jsonb);

SELECT public.admin_club_member_upsert(
  (SELECT id FROM public.clubs WHERE slug='klub-moderacja'),
  'aaaaaaaa-0000-0000-0000-000000000005', 'lead', 'active', NULL);

SELECT public.club_create_thread(
  (SELECT g.id FROM public.club_groups g JOIN public.clubs c ON c.id=g.club_id
    WHERE c.slug='klub-moderacja' LIMIT 1),
  'Temat do moderacji', 'Tresc tematu, dluzsza niz dziesiec znakow.',
  'discussion', false, NULL, NULL);

-- ----------------------------------------------------------------------------
-- Moderacja tresci
-- ----------------------------------------------------------------------------
SELECT ok(
  public.club_moderate('thread', (SELECT id FROM public.club_threads LIMIT 1), 'pin', 'wazne'),
  'admin przypina temat'
);

SELECT ok(
  (SELECT pinned_at IS NOT NULL FROM public.club_threads LIMIT 1),
  'przypiecie zapisane'
);

SELECT is(
  (SELECT count(*)::int FROM public.club_moderation_log WHERE action='pin'),
  1, 'akcja moderacyjna zostawila slad w logu'
);

-- Przypiecie nie dotyczy odpowiedzi.
SELECT public.club_reply((SELECT id FROM public.club_threads LIMIT 1), 'Odpowiedz', NULL, false);

SELECT throws_ok(
  format($$ SELECT public.club_moderate('reply','%s','pin',NULL) $$,
    (SELECT id FROM public.club_replies LIMIT 1)),
  '22023', NULL, 'przypiecie nie dotyczy odpowiedzi'
);

SELECT ok(
  public.club_moderate('thread', (SELECT id FROM public.club_threads LIMIT 1), 'lock', NULL),
  'admin zamyka temat'
);

-- Zamkniety temat nie przyjmuje odpowiedzi NAWET od uprawnionego.
SELECT throws_ok(
  format($$ SELECT public.club_reply('%s','Jeszcze jedna',NULL,false) $$,
    (SELECT id FROM public.club_threads LIMIT 1)),
  '42501', NULL, 'zamkniety temat nie przyjmuje odpowiedzi'
);

-- ----------------------------------------------------------------------------
-- UJAWNIENIE AUTORA - najwazniejsze asercje pliku
-- ----------------------------------------------------------------------------
SELECT throws_ok(
  format($$ SELECT * FROM public.club_moderator_reveal_author('thread','%s',NULL) $$,
    (SELECT id FROM public.club_threads LIMIT 1)),
  '22023', NULL, 'ujawnienie BEZ POWODU jest odrzucane'
);

SELECT throws_ok(
  format($$ SELECT * FROM public.club_moderator_reveal_author('thread','%s','   ') $$,
    (SELECT id FROM public.club_threads LIMIT 1)),
  '22023', NULL, 'sam bialy znak nie jest powodem'
);

SELECT lives_ok(
  format($$ SELECT * FROM public.club_moderator_reveal_author('thread','%s','zgloszenie naduzycia') $$,
    (SELECT id FROM public.club_threads LIMIT 1)),
  'admin ujawnia autora podajac powod'
);

SELECT is(
  (SELECT count(*)::int FROM public.club_moderation_log WHERE action='reveal_author'),
  1, 'ujawnienie zostawilo slad w logu klubu'
);

SELECT is(
  (SELECT count(*)::int FROM public.audit_log WHERE action='club.reveal_author'),
  1, 'ujawnienie zostawilo slad TAKZE w audycie platformy'
);

-- Prowadzacy NIE ujawnia autora: jest strona dyskusji.
SET LOCAL request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000005"}';

SELECT is(
  (SELECT can_reveal_author FROM public.club_capabilities(
     (SELECT id FROM public.clubs WHERE slug='klub-moderacja'), NULL,
     'aaaaaaaa-0000-0000-0000-000000000005')),
  false, 'prowadzacy nie ma zdolnosci ujawniania autora'
);

SELECT throws_ok(
  format($$ SELECT * FROM public.club_moderator_reveal_author('thread','%s','ciekawosc') $$,
    (SELECT id FROM public.club_threads LIMIT 1)),
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
