-- pgTAP: tracker legislacyjny UE (eu_policy_items / _updates / _follows).
--
--   1. Publiczny odczyt dossier: tylko status published w publicznym
--      tenancie (szkice i obce tenanty niewidoczne).
--   2. Aktualizacje sa publiczne wylacznie przy opublikowanym dossier
--      nadrzednym.
--   3. Obserwowanie: owner-only (cudzych obserwacji nie widac), WITH CHECK
--      dopuszcza wylacznie opublikowane dossier; licznik obserwujacych
--      przez RPC (anon-callable).
--   4. Aktualizacja ze zmiana etapu przestawia etap dossier (trigger)
--      i alarmuje obserwujacych powiadomieniem.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(11);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('a5111111-1111-1111-1111-111111111111', 'tenant-tracker-x', 'Tracker X');

INSERT INTO auth.users (id, email) VALUES
  ('a5000000-0000-0000-0000-0000000000aa', 'follower@tracker.test'),
  ('a5000000-0000-0000-0000-0000000000bb', 'bystander@tracker.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('a5000000-0000-0000-0000-0000000000aa', 'follower@tracker.test', 'Follower',
   (SELECT public.public_tenant_id())),
  ('a5000000-0000-0000-0000-0000000000bb', 'bystander@tracker.test', 'Bystander',
   (SELECT public.public_tenant_id()));

INSERT INTO public.eu_policy_items (id, tenant_id, slug, title_pl, title_en, policy_area, stage, importance, status) VALUES
  ('a5222222-2222-2222-2222-222222222201', (SELECT public.public_tenant_id()),
   'dossier-pub', 'Dossier opublikowane', 'Published file', 'digital', 'proposal', 3, 'published'),
  ('a5222222-2222-2222-2222-222222222202', (SELECT public.public_tenant_id()),
   'dossier-draft', 'Dossier szkic', 'Draft file', 'digital', 'proposal', 1, 'draft'),
  ('a5222222-2222-2222-2222-222222222203', 'a5111111-1111-1111-1111-111111111111',
   'dossier-foreign', 'Dossier obce', 'Foreign file', 'digital', 'proposal', 1, 'published');

-- Aktualizacje informacyjne (bez zmiany etapu - stage_to NULL nie rusza dossier).
INSERT INTO public.eu_policy_updates (item_id, note_pl, note_en, happened_on) VALUES
  ('a5222222-2222-2222-2222-222222222201', 'Notatka publiczna', 'Public note', current_date),
  ('a5222222-2222-2222-2222-222222222202', 'Notatka przy szkicu', 'Draft note', current_date);

-- -- 1. Publiczny odczyt ------------------------------------------------------------
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.eu_policy_items
    WHERE slug IN ('dossier-pub', 'dossier-draft', 'dossier-foreign')),
  1,
  'anon widzi tylko opublikowane dossier publicznego tenanta'
);

SELECT is(
  (SELECT count(*)::int FROM public.eu_policy_updates),
  1,
  'publiczna jest tylko aktualizacja opublikowanego dossier (szkic odpada)'
);

-- -- 2. Obserwowanie -----------------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a5000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT lives_ok(
  $$ INSERT INTO public.eu_policy_follows (item_id, user_id, tenant_id)
     VALUES ('a5222222-2222-2222-2222-222222222201',
             'a5000000-0000-0000-0000-0000000000aa',
             (SELECT public.public_tenant_id())) $$,
  'obserwowanie opublikowanego dossier przechodzi'
);

SELECT throws_ok(
  $$ INSERT INTO public.eu_policy_follows (item_id, user_id, tenant_id)
     VALUES ('a5222222-2222-2222-2222-222222222202',
             'a5000000-0000-0000-0000-0000000000aa',
             (SELECT public.public_tenant_id())) $$,
  '42501',
  NULL,
  'nie mozna obserwowac szkicu (WITH CHECK: tylko published)'
);

SELECT throws_ok(
  $$ INSERT INTO public.eu_policy_follows (item_id, user_id, tenant_id)
     VALUES ('a5222222-2222-2222-2222-222222222201',
             'a5000000-0000-0000-0000-0000000000bb',
             (SELECT public.public_tenant_id())) $$,
  '42501',
  NULL,
  'nie mozna obserwowac w cudzym imieniu'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"a5000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.eu_policy_follows),
  0,
  'cudze obserwacje sa niewidoczne (owner-only RLS)'
);

SELECT is(
  (SELECT c.followers::int FROM public.get_policy_follower_counts(
     ARRAY['a5222222-2222-2222-2222-222222222201']::uuid[]) c),
  1,
  'licznik obserwujacych liczy przez RPC mimo owner-only RLS'
);

-- -- 3. Zmiana etapu: trigger + alert obserwujacych -----------------------------------
RESET ROLE;

INSERT INTO public.eu_policy_updates (item_id, note_pl, note_en, stage_to, happened_on)
VALUES ('a5222222-2222-2222-2222-222222222201',
        'Komisja przyjela stanowisko', 'Committee adopted position',
        'parliament', current_date);

SELECT is(
  (SELECT stage FROM public.eu_policy_items
    WHERE id = 'a5222222-2222-2222-2222-222222222201'),
  'parliament',
  'aktualizacja ze stage_to przestawia etap dossier (trigger)'
);

SELECT is(
  (SELECT stage_from FROM public.eu_policy_updates
    WHERE item_id = 'a5222222-2222-2222-2222-222222222201' AND stage_to = 'parliament'),
  'proposal',
  'trigger zapisuje stage_from dla wpisu osi czasu'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE user_id = 'a5000000-0000-0000-0000-0000000000aa'
      AND href = '/tracker/dossier-pub'),
  1,
  'obserwujacy dostaje alert o zmianie w dossier'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications
    WHERE user_id = 'a5000000-0000-0000-0000-0000000000bb'
      AND href = '/tracker/dossier-pub'),
  0,
  'nieobserwujacy nie dostaje alertu'
);

SELECT * FROM finish();
ROLLBACK;
