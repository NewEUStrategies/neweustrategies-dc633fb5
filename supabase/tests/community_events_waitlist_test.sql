-- pgTAP: lista rezerwowa wydarzen + nagrania za bramka warstwy (flaga recordings).
--
--   1. Komplet miejsc nie odrzuca chetnego - rsvp_event zapisuje na liste
--      rezerwowa FIFO (status 'waitlist', stabilna pozycja przy ponowieniach).
--   2. Rezygnacja z 'going' awansuje czolo kolejki (status 'going',
--      powiadomienie 'content'); liczniki i pozycje ida przez RPC.
--   3. Zwiekszenie capacity przez staff awansuje kolejke (trigger).
--   4. get_event_access: 'waitlisted' dla osob z kolejki; nagranie wymaga
--      flagi recordings warstwy (nie samej rangi) - URL nie wycieka bez
--      uprawnienia, watch_reason mowi dlaczego.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(22);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO auth.users (id, email) VALUES
  ('e1000000-0000-0000-0000-0000000000aa', 'wl-a@wl.test'),
  ('e1000000-0000-0000-0000-0000000000bb', 'wl-b@wl.test'),
  ('e1000000-0000-0000-0000-0000000000cc', 'wl-c@wl.test'),
  ('e1000000-0000-0000-0000-0000000000dd', 'wl-d@wl.test'),
  ('e1000000-0000-0000-0000-0000000000ee', 'wl-member@wl.test'),
  ('e1000000-0000-0000-0000-0000000000ff', 'wl-admin@wl.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id)
SELECT u.id, u.email, split_part(u.email, '@', 1), (SELECT public.public_tenant_id())
  FROM auth.users u
 WHERE u.email LIKE '%@wl.test';

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('e1000000-0000-0000-0000-0000000000ff', 'admin', (SELECT public.public_tenant_id()));

-- Plan 'member' (rank 10, flaga recordings z seedu warstw) dla usera ee.
INSERT INTO public.access_plans (id, tenant_id, name_pl, name_en, price_cents, currency, interval, tier_key) VALUES
  ('e2222222-2222-2222-2222-222222222201', (SELECT public.public_tenant_id()),
   'Member (wl test)', 'Member (wl test)', 4900, 'eur', 'month', 'member');
INSERT INTO public.user_subscriptions (user_id, plan_id, tenant_id, status, current_period_end) VALUES
  ('e1000000-0000-0000-0000-0000000000ee', 'e2222222-2222-2222-2222-222222222201',
   (SELECT public.public_tenant_id()), 'active', now() + interval '30 days');

-- e1: publiczne wydarzenie z capacity 1 (kolejka od drugiego chetnego),
-- e2: zakonczone wydarzenie z nagraniem (bramka flagi recordings).
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, kind, starts_at, visibility, min_tier_rank, capacity, status, recording_url) VALUES
  ('e3333333-3333-3333-3333-333333333301', (SELECT public.public_tenant_id()),
   'wl-open', 'Kolejka', 'Waitlist', 'webinar', now() + interval '7 days',
   'public', 0, 1, 'published', NULL),
  ('e3333333-3333-3333-3333-333333333302', (SELECT public.public_tenant_id()),
   'wl-recorded', 'Nagranie', 'Recorded', 'webinar', now() - interval '7 days',
   'public', 0, NULL, 'published', 'https://rec.example/wl-recorded');

-- -- 1. Komplet -> lista rezerwowa FIFO ------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
SELECT is(
  ((public.rsvp_event('e3333333-3333-3333-3333-333333333301', 'going')) ->> 'status'),
  'going',
  'pierwszy chetny zajmuje jedyne miejsce'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
SELECT is(
  ((public.rsvp_event('e3333333-3333-3333-3333-333333333301', 'going')) ->> 'status'),
  'waitlist',
  'drugi chetny przy komplecie laduje na liscie rezerwowej (bez events: full)'
);
SELECT is(
  ((public.rsvp_event('e3333333-3333-3333-3333-333333333301', 'going')) ->> 'waitlist_position')::int,
  1,
  'ponowienie zapisu nie resetuje pozycji FIFO (nadal 1)'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-0000-0000-0000000000cc","role":"authenticated"}', true);
SELECT is(
  ((public.rsvp_event('e3333333-3333-3333-3333-333333333301', 'going')) ->> 'waitlist_position')::int,
  2,
  'trzeci chetny dostaje pozycje 2 w kolejce'
);

SELECT is(
  (SELECT c.waitlist::int FROM public.get_event_rsvp_counts(
     ARRAY['e3333333-3333-3333-3333-333333333301']::uuid[]) c),
  2,
  'get_event_rsvp_counts raportuje licznik listy rezerwowej'
);

SELECT is(
  public.get_event_waitlist_position('e3333333-3333-3333-3333-333333333301'),
  2,
  'get_event_waitlist_position zwraca wlasna pozycje (cc = 2)'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-0000-0000-0000000000dd","role":"authenticated"}', true);
SELECT is(
  public.get_event_waitlist_position('e3333333-3333-3333-3333-333333333301'),
  NULL,
  'get_event_waitlist_position: NULL dla osoby spoza kolejki'
);

-- get_event_access: kolejka to jeszcze nie wejsciowka.
SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
SELECT is(
  (SELECT a.reason FROM public.get_event_access('e3333333-3333-3333-3333-333333333301') a),
  'waitlisted',
  'get_event_access: osoba z kolejki dostaje reason=waitlisted'
);

-- -- 2. Rezygnacja awansuje czolo kolejki ----------------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
SELECT lives_ok(
  $$ SELECT public.rsvp_event('e3333333-3333-3333-3333-333333333301', 'cancelled') $$,
  'rezygnacja going przechodzi'
);

-- Wiersze RSVP i powiadomienia sa owner-only - asercje o cudzych wierszach
-- wykonujemy jako superuser (RESET ROLE), nie spod RLS.
RESET ROLE;
SELECT is(
  (SELECT er.status FROM public.event_rsvps er
    WHERE er.event_id = 'e3333333-3333-3333-3333-333333333301'
      AND er.user_id = 'e1000000-0000-0000-0000-0000000000bb'),
  'going',
  'najstarsza osoba z kolejki (bb) awansuje na going'
);

SELECT is(
  (SELECT count(*)::int FROM public.notifications n
    WHERE n.user_id = 'e1000000-0000-0000-0000-0000000000bb'
      AND n.title_pl LIKE 'Masz miejsce:%'),
  1,
  'awans z kolejki wysyla powiadomienie'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-0000-0000-0000000000cc","role":"authenticated"}', true);
SELECT is(
  public.get_event_waitlist_position('e3333333-3333-3333-3333-333333333301'),
  1,
  'kolejka przesuwa sie: cc z pozycji 2 na 1'
);

-- Osoba z kolejki moze zrezygnowac bez skutkow ubocznych.
SELECT is(
  ((public.rsvp_event('e3333333-3333-3333-3333-333333333301', 'cancelled')) ->> 'waitlist')::int,
  0,
  'rezygnacja z kolejki oprozniona liste (waitlist=0)'
);

RESET ROLE;
SELECT is(
  (SELECT er.status FROM public.event_rsvps er
    WHERE er.event_id = 'e3333333-3333-3333-3333-333333333301'
      AND er.user_id = 'e1000000-0000-0000-0000-0000000000bb'),
  'going',
  'rezygnacja z kolejki nie wyrzuca zapisanych (bb dalej going)'
);

-- -- 3. Zwiekszenie capacity awansuje kolejke -------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-0000-0000-0000000000cc","role":"authenticated"}', true);
SELECT is(
  ((public.rsvp_event('e3333333-3333-3333-3333-333333333301', 'going')) ->> 'status'),
  'waitlist',
  'cc wraca do kolejki przy komplecie'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-0000-0000-0000000000ff","role":"authenticated"}', true);
UPDATE public.events SET capacity = 3
 WHERE id = 'e3333333-3333-3333-3333-333333333301';

SELECT is(
  (SELECT er.status FROM public.event_rsvps er
    WHERE er.event_id = 'e3333333-3333-3333-3333-333333333301'
      AND er.user_id = 'e1000000-0000-0000-0000-0000000000cc'),
  'going',
  'zwiekszenie capacity awansuje kolejke (trigger events_capacity_promote)'
);

-- Bezposredni zapis na liste rezerwowa jest niemozliwy (RPC-only).
SELECT throws_ok(
  $$ SELECT public.rsvp_event('e3333333-3333-3333-3333-333333333301', 'waitlist') $$,
  'P0001',
  'events: invalid status',
  'klient nie moze zadac statusu waitlist wprost - degradacje rozstrzyga serwer'
);

-- -- 4. Nagrania za bramka warstwy (flaga recordings) ------------------------------
SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
SELECT is(
  (SELECT a.can_watch FROM public.get_event_access('e3333333-3333-3333-3333-333333333302') a),
  false,
  'reader bez flagi recordings nie dostaje can_watch'
);
SELECT is(
  (SELECT a.recording_url FROM public.get_event_access('e3333333-3333-3333-3333-333333333302') a),
  NULL,
  'recording_url nie opuszcza bazy bez uprawnienia'
);
SELECT is(
  (SELECT a.watch_reason FROM public.get_event_access('e3333333-3333-3333-3333-333333333302') a),
  'tier_required',
  'watch_reason=tier_required prowadzi upsell w UI'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-0000-0000-0000000000ee","role":"authenticated"}', true);
SELECT is(
  (SELECT a.recording_url FROM public.get_event_access('e3333333-3333-3333-3333-333333333302') a),
  'https://rec.example/wl-recorded',
  'member z flaga recordings widzi URL nagrania'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"e1000000-0000-0000-0000-0000000000ff","role":"authenticated"}', true);
SELECT is(
  (SELECT a.watch_reason FROM public.get_event_access('e3333333-3333-3333-3333-333333333302') a),
  'ok',
  'staff oglada nagranie niezaleznie od warstwy'
);

SELECT * FROM finish();
ROLLBACK;
