-- pgTAP: wydarzenia (events + event_rsvps) - bramki i limit miejsc.
--
--   1. Publiczny odczyt: tylko opublikowane wydarzenia publicznego tenanta;
--      join_url/recording_url odciete grantem kolumnowym (jedyna sciezka:
--      RPC get_event_access).
--   2. rsvp_event: wyscig o ostatnie miejsce pod FOR UPDATE ('events: full'),
--      idempotentne ponowienie, zwolnienie miejsca przez 'cancelled',
--      'interested' nie konsumuje miejsca.
--   3. Bramki warstw: visibility='members' wymaga rangi >=1 (reader odpada),
--      kind='briefing' wymaga FLAGI pro_briefings (member odpada, pro wchodzi)
--      - benefity cennika sa egzekwowane, nie deklaratywne.
--   4. Zapis bezposredni do event_rsvps jest niemozliwy (polityki-zalazki
--      z 20260713050024 usuniete, grant INSERT cofniety) - RPC-only.
--   5. get_event_access: auth_required / tier_required / rsvp_required / ok.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(21);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('d1111111-1111-1111-1111-111111111111', 'tenant-events-x', 'Events X');

INSERT INTO auth.users (id, email) VALUES
  ('d1000000-0000-0000-0000-0000000000aa', 'reader-ev@ev.test'),
  ('d1000000-0000-0000-0000-0000000000bb', 'reader2-ev@ev.test'),
  ('d1000000-0000-0000-0000-0000000000cc', 'reader3-ev@ev.test'),
  ('d1000000-0000-0000-0000-0000000000dd', 'member-ev@ev.test'),
  ('d1000000-0000-0000-0000-0000000000ee', 'pro-ev@ev.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id)
SELECT u.id, u.email, split_part(u.email, '@', 1), (SELECT public.public_tenant_id())
  FROM auth.users u
 WHERE u.id IN ('d1000000-0000-0000-0000-0000000000aa',
                'd1000000-0000-0000-0000-0000000000bb',
                'd1000000-0000-0000-0000-0000000000cc',
                'd1000000-0000-0000-0000-0000000000dd',
                'd1000000-0000-0000-0000-0000000000ee');

-- Plany member/pro w publicznym tenancie + aktywne subskrypcje.
INSERT INTO public.access_plans (id, tenant_id, name_pl, name_en, price_cents, currency, interval, tier_key) VALUES
  ('d2222222-2222-2222-2222-222222222201', (SELECT public.public_tenant_id()),
   'Member (test)', 'Member (test)', 4900, 'eur', 'month', 'member'),
  ('d2222222-2222-2222-2222-222222222202', (SELECT public.public_tenant_id()),
   'Pro (test)', 'Pro (test)', 9900, 'eur', 'month', 'pro');

INSERT INTO public.user_subscriptions (user_id, plan_id, tenant_id, status, current_period_end) VALUES
  ('d1000000-0000-0000-0000-0000000000dd', 'd2222222-2222-2222-2222-222222222201',
   (SELECT public.public_tenant_id()), 'active', now() + interval '30 days'),
  ('d1000000-0000-0000-0000-0000000000ee', 'd2222222-2222-2222-2222-222222222202',
   (SELECT public.public_tenant_id()), 'active', now() + interval '30 days');

-- Wydarzenia: e1 publiczne (capacity 2, z join_url), e2 members (webinar),
-- e3 members briefing (flaga pro_briefings), e4 draft, e5 obcy tenant.
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, kind, starts_at, visibility, min_tier_rank, capacity, status, join_url) VALUES
  ('d3333333-3333-3333-3333-333333333301', (SELECT public.public_tenant_id()),
   'ev-open', 'Otwarte', 'Open', 'webinar', now() + interval '7 days',
   'public', 0, 2, 'published', 'https://live.example/ev-open'),
  ('d3333333-3333-3333-3333-333333333302', (SELECT public.public_tenant_id()),
   'ev-members', 'Dla czlonkow', 'Members', 'webinar', now() + interval '7 days',
   'members', 10, NULL, 'published', NULL),
  ('d3333333-3333-3333-3333-333333333303', (SELECT public.public_tenant_id()),
   'ev-briefing', 'Briefing Pro', 'Pro briefing', 'briefing', now() + interval '7 days',
   'members', 10, NULL, 'published', NULL),
  ('d3333333-3333-3333-3333-333333333304', (SELECT public.public_tenant_id()),
   'ev-draft', 'Szkic', 'Draft', 'webinar', now() + interval '7 days',
   'public', 0, NULL, 'draft', NULL),
  ('d3333333-3333-3333-3333-333333333305', 'd1111111-1111-1111-1111-111111111111',
   'ev-foreign', 'Obcy', 'Foreign', 'webinar', now() + interval '7 days',
   'public', 0, NULL, 'published', NULL);

-- -- 1. Publiczny odczyt + granty kolumnowe --------------------------------------
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);

SELECT is(
  (SELECT count(*)::int FROM public.events
    WHERE slug IN ('ev-open', 'ev-members', 'ev-briefing', 'ev-draft', 'ev-foreign')),
  3,
  'anon widzi tylko opublikowane wydarzenia publicznego tenanta (bez draftu i obcych)'
);

SELECT ok(
  NOT has_column_privilege('authenticated', 'public.events', 'join_url', 'SELECT'),
  'join_url jest odciety od klienta grantem kolumnowym'
);

SELECT ok(
  NOT has_column_privilege('authenticated', 'public.events', 'recording_url', 'SELECT'),
  'recording_url jest odciety od klienta grantem kolumnowym'
);

SELECT is(
  (SELECT reason FROM public.get_event_access('d3333333-3333-3333-3333-333333333301')),
  'auth_required',
  'get_event_access dla anonima konczy sie auth_required'
);

-- -- 2. RSVP: limit miejsc pod FOR UPDATE ----------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT is(
  ((public.rsvp_event('d3333333-3333-3333-3333-333333333301', 'going')) ->> 'going')::int,
  1,
  'pierwsze RSVP going zajmuje miejsce (1/2)'
);

SELECT is(
  ((public.rsvp_event('d3333333-3333-3333-3333-333333333301', 'going')) ->> 'going')::int,
  1,
  'ponowienie wlasnego going jest idempotentne (nadal 1/2, bez events: full)'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
SELECT is(
  ((public.rsvp_event('d3333333-3333-3333-3333-333333333301', 'going')) ->> 'going')::int,
  2,
  'drugie RSVP wypelnia limit (2/2)'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-0000-0000-0000000000cc","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.rsvp_event('d3333333-3333-3333-3333-333333333301', 'going') $$,
  'P0001',
  'events: full',
  'trzecie going odbija sie o limit miejsc'
);

SELECT lives_ok(
  $$ SELECT public.rsvp_event('d3333333-3333-3333-3333-333333333301', 'interested') $$,
  'interested nie konsumuje miejsca (przechodzi mimo kompletu)'
);

-- Zwolnienie miejsca: bb rezygnuje, cc wskakuje.
SELECT set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
SELECT lives_ok(
  $$ SELECT public.rsvp_event('d3333333-3333-3333-3333-333333333301', 'cancelled') $$,
  'rezygnacja zwalnia miejsce'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-0000-0000-0000000000cc","role":"authenticated"}', true);
SELECT is(
  ((public.rsvp_event('d3333333-3333-3333-3333-333333333301', 'going')) ->> 'going')::int,
  2,
  'zwolnione miejsce mozna zajac (znow 2/2)'
);

-- Zapis bezposredni (sciezka zalazkowa) jest zamknieta.
SELECT throws_ok(
  $$ INSERT INTO public.event_rsvps (tenant_id, event_id, user_id, status)
     VALUES ((SELECT public.public_tenant_id()),
             'd3333333-3333-3333-3333-333333333302',
             'd1000000-0000-0000-0000-0000000000cc', 'going') $$,
  '42501',
  NULL,
  'bezposredni INSERT do event_rsvps jest zabroniony (RPC-only)'
);

-- -- 3. Bramki warstw --------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
SELECT throws_ok(
  $$ SELECT public.rsvp_event('d3333333-3333-3333-3333-333333333302', 'going') $$,
  'P0001',
  'events: membership required',
  'reader (rank 0) nie zapisze sie na wydarzenie members'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-0000-0000-0000000000dd","role":"authenticated"}', true);
SELECT lives_ok(
  $$ SELECT public.rsvp_event('d3333333-3333-3333-3333-333333333302', 'going') $$,
  'member (rank 10) wchodzi na wydarzenie members'
);

SELECT throws_ok(
  $$ SELECT public.rsvp_event('d3333333-3333-3333-3333-333333333303', 'going') $$,
  'P0001',
  'events: membership required',
  'member BEZ flagi pro_briefings nie wchodzi na members-briefing'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-0000-0000-0000000000ee","role":"authenticated"}', true);
SELECT lives_ok(
  $$ SELECT public.rsvp_event('d3333333-3333-3333-3333-333333333303', 'going') $$,
  'pro (flaga pro_briefings) wchodzi na members-briefing'
);

-- -- 4. get_event_access ------------------------------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT is(
  (SELECT reason FROM public.get_event_access('d3333333-3333-3333-3333-333333333302')),
  'tier_required',
  'get_event_access: reader dostaje tier_required na wydarzeniu members'
);

SELECT is(
  (SELECT a.reason FROM public.get_event_access('d3333333-3333-3333-3333-333333333301') a),
  'ok',
  'get_event_access: uczestnik going dostaje ok'
);

SELECT is(
  (SELECT a.join_url FROM public.get_event_access('d3333333-3333-3333-3333-333333333301') a),
  'https://live.example/ev-open',
  'get_event_access: join_url widoczny wylacznie przez RPC dla going'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
SELECT is(
  (SELECT a.reason FROM public.get_event_access('d3333333-3333-3333-3333-333333333301') a),
  'rsvp_required',
  'get_event_access: bez going dostaje rsvp_required (bb zrezygnowal)'
);

-- -- 5. Liczniki RSVP -----------------------------------------------------------------
SELECT is(
  (SELECT c.going::int FROM public.get_event_rsvp_counts(
     ARRAY['d3333333-3333-3333-3333-333333333301']::uuid[]) c),
  2,
  'get_event_rsvp_counts liczy going przez RLS owner-only'
);

SELECT * FROM finish();
ROLLBACK;
