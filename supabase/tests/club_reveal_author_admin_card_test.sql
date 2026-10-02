-- ============================================================================
-- pgTAP: ujawnienie autora -> karta uzytkownika w panelu (/admin/users/$id).
--
-- Odnosnik po ujawnieniu prowadzi do karty panelu PO ID, nie do profilu
-- publicznego. Ten plik przybija kontrakt MIEDZY dwoma RPC, od ktorego to
-- zalezy: kto moze ujawnic (`club_moderator_reveal_author`, can_reveal_author =
-- is_club_admin), ten otworzy karte (`admin_get_user`) - takze dla czlonka
-- bez `discoverable`, bez polaczenia z adminem i BEZ sluga. Kto ujawnic nie
-- moze (redaktor), ten karty tez nie dostaje.
-- ============================================================================
BEGIN;
SELECT plan(6);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, name, slug)
VALUES ('22222222-2222-2222-2222-222222222222', 'Tenant R', 'tenant-r-reveal-card')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'admin@reveal.local'),
       ('bbbbbbbb-0000-0000-0000-000000000002', 'editor@reveal.local'),
       ('bbbbbbbb-0000-0000-0000-000000000003', 'member@reveal.local')
ON CONFLICT (id) DO NOTHING;

-- Czlonek: NIE discoverable, bez polaczen, BEZ sluga - najgorszy przypadek
-- dla kazdego odnosnika opartego o profil publiczny.
INSERT INTO public.profiles (id, tenant_id, display_name, slug, discoverable)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Admin R', 'admin-r-reveal', true),
       ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Redaktor R', 'redaktor-r-reveal', true),
       ('bbbbbbbb-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Anonim R', NULL, false);

INSERT INTO public.user_roles (user_id, role, tenant_id)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'admin',  '22222222-2222-2222-2222-222222222222'),
       ('bbbbbbbb-0000-0000-0000-000000000002', 'editor', '22222222-2222-2222-2222-222222222222');

SELECT ok(
  has_function_privilege('authenticated', 'public.admin_get_user(uuid)', 'EXECUTE'),
  'authenticated ma EXECUTE na admin_get_user(uuid) - karta panelu czyta po stronie klienta'
);

SET LOCAL request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000001"}';
SELECT public.admin_club_upsert(
  '{"slug":"klub-reveal-card","name_pl":"Klub karty","name_en":"Card club",
    "visibility":"members","who_can_post":"members","moderation_mode":"pre",
    "attribution_mode":"chatham","status":"active"}'::jsonb);
SELECT set_config('test.club',
  (SELECT id::text FROM public.clubs WHERE slug='klub-reveal-card'), true);
SELECT set_config('test.group',
  (SELECT g.id::text FROM public.club_groups g
    WHERE g.club_id = current_setting('test.club')::uuid LIMIT 1), true);
SELECT public.admin_club_member_upsert(
  current_setting('test.club')::uuid,
  'bbbbbbbb-0000-0000-0000-000000000003', 'member', 'active', NULL);

-- Czlonek pisze w klubie chatham z premoderacja -> wpis czeka w kolejce.
SET LOCAL request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000003"}';
SET LOCAL ROLE authenticated;
SELECT public.club_create_thread(
  current_setting('test.group')::uuid,
  'Watek do ujawnienia', 'Tresc watku, dluzsza niz dziesiec znakow.',
  'discussion', true, NULL, NULL);
RESET ROLE;
SELECT set_config('test.thread',
  (SELECT id::text FROM public.club_threads
    WHERE club_id = current_setting('test.club')::uuid), true);

-- Redaktor: personel /admin, ale NIE ujawnia i NIE otwiera karty.
SET LOCAL request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002"}';
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  format($$ SELECT * FROM public.club_moderator_reveal_author('thread','%s','powod redaktora') $$,
    current_setting('test.thread')),
  '42501', NULL, 'redaktor nie ujawnia autora'
);
RESET ROLE;
SELECT is_empty(
  $$ SELECT id FROM public.admin_get_user('bbbbbbbb-0000-0000-0000-000000000003') $$,
  'redaktor nie dostaje karty uzytkownika - te same drzwi co ujawnienie'
);

-- Admin: ujawnia i otwiera karte.
SET LOCAL request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000001"}';
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE revealed ON COMMIT DROP AS
  SELECT * FROM public.club_moderator_reveal_author(
    'thread', current_setting('test.thread')::uuid, 'zgloszenie podszycia');
RESET ROLE;

SELECT is(
  (SELECT author_id FROM revealed),
  'bbbbbbbb-0000-0000-0000-000000000003'::uuid,
  'ujawnienie oddaje id autora - klucz odnosnika /admin/users/$id'
);
SELECT is(
  (SELECT profile_slug FROM revealed),
  NULL,
  'konto bez sluga: slug NIE moze byc kluczem odnosnika po ujawnieniu'
);
SELECT is(
  (SELECT id FROM public.admin_get_user((SELECT author_id FROM revealed))),
  'bbbbbbbb-0000-0000-0000-000000000003'::uuid,
  'ujawniajacy admin otwiera karte autora: bez discoverable, bez polaczenia, bez sluga'
);
SELECT * FROM finish();
ROLLBACK;
