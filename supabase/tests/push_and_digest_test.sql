-- pgTAP: web push + digest (20260713180000).
--
--   1. push_subscriptions: wlasciciel widzi/zapisuje tylko swoje wiersze;
--      cudze subskrypcje niewidoczne (own-row RLS).
--   2. push_outbox: niedostepny dla authenticated (service-role only),
--      trigger na notifications kolejkuje payload TYLKO dla odbiorcow
--      z aktywna subskrypcja.
--   3. claim_due_digest_users: stempluje last_at i zwraca wylacznie
--      uzytkownikow z nieprzeczytanymi powiadomieniami; drugi claim
--      w tym samym oknie nic nie zwraca.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(9);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('a9111111-1111-1111-1111-111111111111', 'tenant-push', 'Tenant Push');

INSERT INTO auth.users (id, email) VALUES
  ('a9000000-0000-0000-0000-0000000000aa', 'sub-push@push.test'),
  ('a9000000-0000-0000-0000-0000000000bb', 'nosub-push@push.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('a9000000-0000-0000-0000-0000000000aa', 'sub-push@push.test', 'Sub Push',
   'a9111111-1111-1111-1111-111111111111'),
  ('a9000000-0000-0000-0000-0000000000bb', 'nosub-push@push.test', 'NoSub Push',
   'a9111111-1111-1111-1111-111111111111');

-- -- 1. Own-row RLS subskrypcji ------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a9000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT lives_ok(
  $$ INSERT INTO public.push_subscriptions (user_id, tenant_id, endpoint, p256dh, auth)
     VALUES ('a9000000-0000-0000-0000-0000000000aa',
             'a9111111-1111-1111-1111-111111111111',
             'https://push.example/ep-1', 'p256dh-key', 'auth-key') $$,
  'wlasciciel zapisuje swoja subskrypcje push'
);

SELECT throws_ok(
  $$ INSERT INTO public.push_subscriptions (user_id, tenant_id, endpoint, p256dh, auth)
     VALUES ('a9000000-0000-0000-0000-0000000000bb',
             'a9111111-1111-1111-1111-111111111111',
             'https://push.example/ep-forged', 'x', 'y') $$,
  '42501',
  NULL,
  'nie mozna zapisac subskrypcji za innego uzytkownika'
);

SELECT set_config('request.jwt.claims',
  '{"sub":"a9000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
SELECT is(
  (SELECT count(*)::int FROM public.push_subscriptions),
  0,
  'cudze subskrypcje sa niewidoczne (own-row RLS)'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.push_outbox', 'SELECT'),
  'push_outbox jest service-role-only'
);

-- -- 2. Trigger kolejkowania ----------------------------------------------------
RESET ROLE;

INSERT INTO public.notifications (user_id, tenant_id, kind, title_pl, href) VALUES
  ('a9000000-0000-0000-0000-0000000000aa', 'a9111111-1111-1111-1111-111111111111',
   'system', 'Test push', '/x'),
  ('a9000000-0000-0000-0000-0000000000bb', 'a9111111-1111-1111-1111-111111111111',
   'system', 'Test bez push', '/y');

SELECT is(
  (SELECT count(*)::int FROM public.push_outbox
    WHERE user_id = 'a9000000-0000-0000-0000-0000000000aa'),
  1,
  'powiadomienie odbiorcy z subskrypcja trafia do push_outbox'
);

SELECT is(
  (SELECT count(*)::int FROM public.push_outbox
    WHERE user_id = 'a9000000-0000-0000-0000-0000000000bb'),
  0,
  'odbiorca bez subskrypcji nie generuje wpisu w outboxie'
);

SELECT is(
  (SELECT po.payload->>'title' FROM public.push_outbox po
    WHERE po.user_id = 'a9000000-0000-0000-0000-0000000000aa' LIMIT 1),
  'Test push',
  'payload push niesie tytul powiadomienia'
);

-- -- 3. Digest claim --------------------------------------------------------------
INSERT INTO public.notification_preferences (user_id, tenant_id, email_digest_frequency)
VALUES ('a9000000-0000-0000-0000-0000000000aa',
        'a9111111-1111-1111-1111-111111111111', 'daily')
ON CONFLICT (user_id) DO UPDATE SET email_digest_frequency = 'daily';

SELECT is(
  (SELECT count(*)::int FROM public.claim_due_digest_users(50)
    WHERE user_id = 'a9000000-0000-0000-0000-0000000000aa'),
  1,
  'claim_due_digest_users zwraca uzytkownika z nieprzeczytanymi powiadomieniami'
);

SELECT is(
  (SELECT count(*)::int FROM public.claim_due_digest_users(50)
    WHERE user_id = 'a9000000-0000-0000-0000-0000000000aa'),
  0,
  'drugi claim w tym samym oknie nie zwraca uzytkownika (last_at ostemplowany)'
);

SELECT * FROM finish();
ROLLBACK;
