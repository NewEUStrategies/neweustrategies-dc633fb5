-- ============================================================================
-- pgTAP: `public.is_nes_staff` - domena NES wyłącznie z POTWIERDZONEGO adresu
-- logowania (migracja 20261017140000, bliźniak drizzle 0299).
--
-- Co przybija:
--   * LUKA z 20260811224504: sztab NES rozpoznawany także po
--     `profiles.email`, a tę kolumnę zalogowany pisze sam (GRANT UPDATE
--     z 20260915092000, polityka „Users update own profile"). Sztab dostaje
--     can_read w każdym klubie tenantu (club_capabilities), więc jedno UPDATE
--     własnego profilu otwierało bramkę sekretu list (20261017130000), licznik
--     kafla specjalizacji i kartę sekretu/szkicu (club_view, 20261017120000).
--   * Reguła D1 (REG-01): domena liczy się tylko z `auth.users.email`
--     z `email_confirmed_at` - potwierdzony adres logowania NES to sztab także
--     przy innym adresie w profilu, niepotwierdzony nie.
--   * Niezmienniki: ścieżka ról (redaktor), NULL -> false, sygnatura
--     i zwrotka (src/integrations/supabase/types.ts), STABLE SECURITY DEFINER.
--   * Granty: authenticated i service_role tak, PUBLIC i anon nie.
--
-- Atak idzie realną drogą klienta: rola `authenticated`, tożsamość
-- w `request.jwt.claims`, UPDATE własnego wiersza `profiles` przez RLS.
-- Asercja `lives_ok` na tym UPDATE dokumentuje, że kolumna DALEJ jest
-- kliencka - obrona siedzi w funkcji, nie w grancie (patrz nagłówek migracji).
--
-- Bliźniak wykonywany bez pgTAP: scripts/pg-harness/runtime_test.sql, sekcja
-- NESR (`bun run check:pg-harness`).
-- ============================================================================
BEGIN;
SELECT plan(18);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, name, slug, domain)
VALUES ('5e5a0000-0000-0000-0000-00000000000a', 'NES Staff A', 'nes-staff-a', 'nes-staff-a.example');

-- 1 admin (zakłada kluby), 2 obcy (atak przez profiles.email), 3 potwierdzony
-- adres logowania NES z innym adresem w profilu, 4 adres NES niepotwierdzony
-- (w logowaniu i w profilu), 5 redaktor (ścieżka ról).
INSERT INTO auth.users (id, email, email_confirmed_at)
VALUES ('5e500000-0000-0000-0000-000000000001', 'nst-admin@test.local', now()),
       ('5e500000-0000-0000-0000-000000000002', 'nst-outsider@test.local', now()),
       ('5e500000-0000-0000-0000-000000000003', 'Anna.Sztab@NewEuropeanStrategies.com', now()),
       ('5e500000-0000-0000-0000-000000000004', 'nst-oczekuje@neweuropeanstrategies.com', NULL),
       ('5e500000-0000-0000-0000-000000000005', 'nst-editor@test.local', now());

INSERT INTO public.profiles (id, tenant_id, display_name, discoverable, email)
VALUES ('5e500000-0000-0000-0000-000000000001', '5e5a0000-0000-0000-0000-00000000000a', 'NST Admin', true, 'nst-admin@test.local'),
       ('5e500000-0000-0000-0000-000000000002', '5e5a0000-0000-0000-0000-00000000000a', 'NST Outsider', true, 'nst-outsider@test.local'),
       ('5e500000-0000-0000-0000-000000000003', '5e5a0000-0000-0000-0000-00000000000a', 'NST Sztab', true, 'anna.prywatnie@test.local'),
       ('5e500000-0000-0000-0000-000000000004', '5e5a0000-0000-0000-0000-00000000000a', 'NST Oczekuje', true, 'nst-oczekuje@neweuropeanstrategies.com'),
       ('5e500000-0000-0000-0000-000000000005', '5e5a0000-0000-0000-0000-00000000000a', 'NST Editor', true, 'nst-editor@test.local');

INSERT INTO public.user_roles (user_id, role, tenant_id)
VALUES ('5e500000-0000-0000-0000-000000000001', 'admin', '5e5a0000-0000-0000-0000-00000000000a'),
       ('5e500000-0000-0000-0000-000000000005', 'editor', '5e5a0000-0000-0000-0000-00000000000a');

INSERT INTO public.club_specializations (tenant_id, slug, key, label_pl, label_en, sort_order)
VALUES ('5e5a0000-0000-0000-0000-00000000000a', 'nst-spec', 'nstspec', 'Sztab spec', 'Staff spec', 900);

SELECT set_config('request.jwt.claims', '{"sub":"5e500000-0000-0000-0000-000000000001"}', true);
SELECT public.admin_club_upsert(c.payload::jsonb)
  FROM (VALUES
    ('{"slug":"nst-public","name_pl":"NST public","name_en":"NST public","visibility":"public","status":"active","specialization_slug":"nst-spec"}'),
    ('{"slug":"nst-members","name_pl":"NST members","name_en":"NST members","visibility":"members","status":"active","specialization_slug":"nst-spec"}'),
    ('{"slug":"nst-secret","name_pl":"NST secret","name_en":"NST secret","visibility":"secret","status":"active","specialization_slug":"nst-spec"}'),
    ('{"slug":"nst-draft","name_pl":"NST draft","name_en":"NST draft","visibility":"public","status":"draft","specialization_slug":"nst-spec"}')
  ) AS c(payload);
SELECT set_config('request.jwt.claims', '', true);

-- ----------------------------------------------------------------------------
-- 1. Struktura: sygnatura bez zmian, granty, atrybuty
-- ----------------------------------------------------------------------------
SELECT is(
  pg_get_function_arguments('public.is_nes_staff(uuid)'::regprocedure) || ' -> '
    || pg_get_function_result('public.is_nes_staff(uuid)'::regprocedure),
  '_user_id uuid DEFAULT auth.uid() -> boolean',
  'sygnatura i zwrotka is_nes_staff bez zmian (types.ts)');
SELECT ok(
  (SELECT p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=public, pg_temp']
     FROM pg_proc p WHERE p.oid = 'public.is_nes_staff(uuid)'::regprocedure),
  'is_nes_staff: STABLE SECURITY DEFINER (auth.users nieczytelna dla klienta), search_path public, pg_temp');
SELECT ok(
  has_function_privilege('authenticated', 'public.is_nes_staff(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.is_nes_staff(uuid)', 'EXECUTE'),
  'is_nes_staff: EXECUTE dla authenticated i service_role');
SELECT ok(
  NOT has_function_privilege('anon', 'public.is_nes_staff(uuid)', 'EXECUTE')
  AND (SELECT p.proacl IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
         FROM pg_proc p WHERE p.oid = 'public.is_nes_staff(uuid)'::regprocedure),
  'is_nes_staff: bez EXECUTE dla PUBLIC i anon (status dowolnego uuid nie jest publiczny)');

-- ----------------------------------------------------------------------------
-- 2. Kto jest sztabem: rola albo POTWIERDZONY adres logowania NES
-- ----------------------------------------------------------------------------
SELECT is(public.is_nes_staff(NULL), false, 'NULL -> false (nie NULL)');
-- has_role liczy rolę w tenancie SESJI (current_tenant_id), więc redaktor
-- pyta we własnej sesji.
SELECT set_config('request.jwt.claims', '{"sub":"5e500000-0000-0000-0000-000000000005"}', true);
SELECT is(public.is_nes_staff(), true,
  'redaktor (rola w swoim tenancie) jest sztabem - ścieżka ról bez zmian');
SELECT set_config('request.jwt.claims', '', true);
SELECT is(public.is_nes_staff('5e500000-0000-0000-0000-000000000003'), true,
  'potwierdzony adres logowania NES (wielkie litery) to sztab, także przy innym adresie w profilu');
SELECT is(public.is_nes_staff('5e500000-0000-0000-0000-000000000004'), false,
  'niepotwierdzony adres logowania NES nie robi sztabu - adres NES w profilu też nie');

-- ----------------------------------------------------------------------------
-- 3. Atak: zalogowany wpisuje sobie domenę NES w profiles.email
-- ----------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"5e500000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT is(public.is_nes_staff(), false, 'obcy przed zmianą profilu nie jest sztabem');
SELECT lives_ok(
  $$UPDATE public.profiles SET email = 'Mallory@NewEuropeanStrategies.com' WHERE id = auth.uid()$$,
  'zalogowany zmienia własny profiles.email przez RLS - kolumna dalej kliencka, obrona jest w is_nes_staff');
RESET ROLE;
SELECT is(
  (SELECT email FROM public.profiles WHERE id = '5e500000-0000-0000-0000-000000000002'),
  'Mallory@NewEuropeanStrategies.com',
  'zapis adresu NES w profilu obcego doszedł do bazy');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"5e500000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT is(public.is_nes_staff(), false,
  'adres NES w profilu NIE robi sztabu (KRYTYCZNE)');
SELECT is(
  (SELECT COALESCE(string_agg(slug, ',' ORDER BY slug), '-')
     FROM public.club_list_by_specialization('nst-spec', 200, 0) WHERE slug LIKE 'nst-%'),
  'nst-members,nst-public',
  'obcy z adresem NES w profilu nie listuje sekretu specjalizacji');
SELECT is(
  (SELECT club_count FROM public.club_specializations_public() WHERE slug = 'nst-spec'),
  2,
  'licznik specjalizacji obcego z adresem NES w profilu nie liczy sekretu');
SELECT is(
  (SELECT COALESCE(string_agg(slug, ',' ORDER BY slug), '-')
     FROM public.club_list(200, 0) WHERE slug LIKE 'nst-%'),
  'nst-members,nst-public',
  'club_list obcego z adresem NES w profilu: bez sekretu i szkicu');
SELECT is(
  (SELECT COALESCE(string_agg(s, ',' ORDER BY s), '-')
     FROM unnest(ARRAY['nst-draft', 'nst-secret']) s
    WHERE EXISTS (SELECT 1 FROM public.club_view(s))),
  '-',
  'club_view: obcy z adresem NES w profilu nie dostaje karty sekretu ani szkicu');
RESET ROLE;
SELECT is(
  (SELECT k.can_read FROM public.clubs c
     CROSS JOIN LATERAL public.club_capabilities(c.id, NULL, '5e500000-0000-0000-0000-000000000002') k
    WHERE c.slug = 'nst-secret' AND c.tenant_id = '5e5a0000-0000-0000-0000-00000000000a'),
  false,
  'club_capabilities: obcy z adresem NES w profilu bez can_read w sekrecie');

-- ----------------------------------------------------------------------------
-- 4. Sztab z potwierdzonego adresu logowania dalej widzi sekret
-- ----------------------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"5e500000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT is(
  (SELECT COALESCE(string_agg(slug, ',' ORDER BY slug), '-')
     FROM public.club_list_by_specialization('nst-spec', 200, 0) WHERE slug LIKE 'nst-%'),
  'nst-members,nst-public,nst-secret',
  'sztab z potwierdzonego adresu logowania NES listuje sekret (semantyka cap.can_read z 0028)');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT * FROM finish();
ROLLBACK;
