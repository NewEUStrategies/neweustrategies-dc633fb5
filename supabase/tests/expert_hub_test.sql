-- pgTAP: hub eksperta (20260714130000) - programy, obszary, media, relacje.
--
-- Weryfikowane wlasnosci:
--   1. Taksonomie (regions/expertise_areas) sa zaseedowane w publicznym
--      tenancie i czytelne dla anon; programy obcego tenanta sa niewidoczne.
--   2. programs: zapis tylko dla admin/editor tenanta (zwykly autor odpada).
--   3. program_members: publicznie czytelne, zapis staff-only.
--   4. expert_expertise_areas: ekspert zarzadza WYLACZNIE wlasnymi
--      przypisaniami (WITH CHECK user_id = auth.uid()).
--   5. media_mentions: wpis wlasny OK, cudzy odpada; is_public=false znika
--      z odczytu anon, ale wlasciciel dalej go widzi; walidacja URL.
--   6. events: nowe kolumny program_id/region_id sa objete grantem
--      kolumnowym (anon moze je SELECT-owac).
--   7. post_authors/post_programs/post_regions: pivoty czytelne publicznie.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(18);

ALTER TABLE auth.users DISABLE TRIGGER USER;

-- Obcy tenant do testu izolacji.
INSERT INTO public.tenants (id, slug, name) VALUES
  ('e7111111-1111-1111-1111-111111111111', 'tenant-eh-x', 'Expert Hub X');

INSERT INTO auth.users (id, email) VALUES
  ('e7000000-0000-0000-0000-0000000000aa', 'admin-eh@eh.test'),
  ('e7000000-0000-0000-0000-0000000000bb', 'expert-eh@eh.test'),
  ('e7000000-0000-0000-0000-0000000000cc', 'peer-eh@eh.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id)
SELECT u.id, u.email, split_part(u.email, '@', 1), (SELECT public.public_tenant_id())
  FROM auth.users u
 WHERE u.email LIKE '%@eh.test';

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('e7000000-0000-0000-0000-0000000000aa', 'admin',
   (SELECT public.public_tenant_id())),
  ('e7000000-0000-0000-0000-0000000000bb', 'author',
   (SELECT public.public_tenant_id()));

-- Fixture: programy (publiczny + obcy tenant), wydarzenie z programem/regionem.
INSERT INTO public.programs (id, tenant_id, slug, name_pl, name_en, kind) VALUES
  ('e7222222-2222-2222-2222-222222222201', (SELECT public.public_tenant_id()),
   'cyfrowa-europa', 'Cyfrowa Europa', 'Digital Europe', 'program'),
  ('e7222222-2222-2222-2222-222222222202', 'e7111111-1111-1111-1111-111111111111',
   'obcy-program', 'Obcy program', 'Foreign program', 'program');

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status, program_id, region_id)
VALUES
  ('e7333333-3333-3333-3333-333333330001', (SELECT public.public_tenant_id()),
   'eh-briefing-cyfrowy', 'Briefing cyfrowy', 'Digital briefing',
   now() + interval '7 days', 'published',
   'e7222222-2222-2222-2222-222222222201',
   (SELECT id FROM public.regions
     WHERE tenant_id = (SELECT public.public_tenant_id())
       AND slug = 'unia-europejska'));

-- -- 1-3. Seed taksonomii + publiczny odczyt (anon) ----------------------------
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT cmp_ok(
  (SELECT count(*)::int FROM public.regions
    WHERE tenant_id = (SELECT public.public_tenant_id())),
  '>=', 12,
  'regiony zaseedowane i czytelne dla anon'
);

SELECT cmp_ok(
  (SELECT count(*)::int FROM public.expertise_areas
    WHERE tenant_id = (SELECT public.public_tenant_id())),
  '>=', 12,
  'obszary ekspertyzy zaseedowane i czytelne dla anon'
);

-- Filtr po znanych slugach: seed dev/E2E dodaje własne programy publicznego
-- tenanta, więc asercja nie może zakładać pełnej listy.
SELECT results_eq(
  $$ SELECT slug FROM public.programs
      WHERE slug IN ('cyfrowa-europa', 'obcy-program') ORDER BY slug $$,
  ARRAY['cyfrowa-europa'],
  'anon widzi tylko programy publicznego tenanta'
);

-- -- 4. Kolumny program_id/region_id na events objete grantem kolumnowym ------
SELECT lives_ok(
  $$ SELECT program_id, region_id FROM public.events
      WHERE slug = 'eh-briefing-cyfrowy' $$,
  'anon SELECT-uje program_id/region_id wydarzenia (grant kolumnowy)'
);

SELECT lives_ok(
  $$ SELECT post_id FROM public.post_authors
      UNION ALL SELECT post_id FROM public.post_programs
      UNION ALL SELECT post_id FROM public.post_regions $$,
  'pivoty post_authors/post_programs/post_regions czytelne publicznie'
);

-- -- 5-6. programs: autor bez rangi staff nie zapisuje, admin tak -------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e7000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT throws_like(
  $$ INSERT INTO public.programs (slug, name_pl, name_en)
     VALUES ('probny', 'Próbny', 'Trial') $$,
  '%row-level security%',
  'autor bez roli admin/editor nie utworzy programu'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"e7000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT lives_ok(
  $$ INSERT INTO public.programs (slug, name_pl, name_en, kind)
     VALUES ('nowy-projekt', 'Nowy projekt', 'New project', 'project') $$,
  'admin tenanta tworzy program/projekt'
);

-- -- 7-8. program_members: staff przypisuje eksperta z funkcja ----------------
SELECT lives_ok(
  $$ INSERT INTO public.program_members (program_id, user_id, role_pl, role_en)
     VALUES ('e7222222-2222-2222-2222-222222222201',
             'e7000000-0000-0000-0000-0000000000bb',
             'Dyrektorka programu', 'Programme Director') $$,
  'admin przypisuje eksperta do programu z funkcja PL/EN'
);

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is(
  (SELECT role_pl FROM public.program_members
    WHERE program_id = 'e7222222-2222-2222-2222-222222222201'
      AND user_id = 'e7000000-0000-0000-0000-0000000000bb'),
  'Dyrektorka programu',
  'funkcja eksperta w programie jest publicznie czytelna'
);

-- -- 9-11. expert_expertise_areas: tylko wlasne przypisania -------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e7000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT lives_ok(
  $$ INSERT INTO public.expert_expertise_areas (user_id, area_id)
     SELECT 'e7000000-0000-0000-0000-0000000000bb', id
       FROM public.expertise_areas
      WHERE slug = 'cyberbezpieczenstwo'
        AND tenant_id = (SELECT public.public_tenant_id()) $$,
  'ekspert dodaje wlasny obszar ekspertyzy'
);

SELECT throws_like(
  $$ INSERT INTO public.expert_expertise_areas (user_id, area_id)
     SELECT 'e7000000-0000-0000-0000-0000000000cc', id
       FROM public.expertise_areas
      WHERE slug = 'migracje'
        AND tenant_id = (SELECT public.public_tenant_id()) $$,
  '%row-level security%',
  'ekspert NIE przypisze obszaru innemu uzytkownikowi'
);

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.expert_expertise_areas
    WHERE user_id = 'e7000000-0000-0000-0000-0000000000bb'),
  1,
  'przypisanie obszaru jest publicznie czytelne'
);

-- -- 12-16. media_mentions: wlasnosc, widocznosc, walidacja -------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e7000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);

SELECT lives_ok(
  $$ INSERT INTO public.media_mentions
       (user_id, outlet, title, url, kind, published_on)
     VALUES ('e7000000-0000-0000-0000-0000000000bb', 'Politico Europe',
             'Ekspertka o AI Act', 'https://politico.eu/ai-act', 'quote',
             '2026-07-01') $$,
  'ekspert dodaje wlasna wzmianke medialna'
);

SELECT lives_ok(
  $$ INSERT INTO public.media_mentions
       (user_id, outlet, title, kind, published_on, is_public)
     VALUES ('e7000000-0000-0000-0000-0000000000bb', 'TVN24',
             'Wywiad roboczy (szkic)', 'interview', '2026-07-05', false) $$,
  'ekspert dodaje ukryta (is_public=false) wzmianke'
);

SELECT throws_like(
  $$ INSERT INTO public.media_mentions
       (user_id, outlet, title, kind, published_on)
     VALUES ('e7000000-0000-0000-0000-0000000000cc', 'Onet',
             'Cudza wzmianka', 'quote', '2026-07-02') $$,
  '%row-level security%',
  'ekspert NIE doda wzmianki innemu uzytkownikowi'
);

SELECT is(
  (SELECT count(*)::int FROM public.media_mentions
    WHERE user_id = 'e7000000-0000-0000-0000-0000000000bb'),
  2,
  'wlasciciel widzi takze ukryte wzmianki'
);

SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT results_eq(
  $$ SELECT outlet FROM public.media_mentions
      WHERE user_id = 'e7000000-0000-0000-0000-0000000000bb'
      ORDER BY published_on $$,
  ARRAY['Politico Europe'],
  'anon widzi wylacznie publiczne wzmianki'
);

-- -- 17-18. Walidacje twarde w schemacie --------------------------------------
RESET ROLE;

SELECT throws_like(
  $$ INSERT INTO public.media_mentions
       (user_id, outlet, title, url, kind, published_on)
     VALUES ('e7000000-0000-0000-0000-0000000000bb', 'X', 'Zly URL',
             'javascript:alert(1)', 'quote', '2026-07-01') $$,
  '%check constraint%',
  'URL wzmianki musi byc http(s)'
);

SELECT throws_like(
  $$ INSERT INTO public.programs (slug, name_pl, name_en, kind)
     VALUES ('zly-kind', 'Zly', 'Bad', 'division') $$,
  '%check constraint%',
  'kind programu ograniczony do program/project/department'
);

SELECT * FROM finish();
ROLLBACK;
