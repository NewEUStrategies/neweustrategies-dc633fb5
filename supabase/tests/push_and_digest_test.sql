-- pgTAP: web push + digest - potok KANONICZNY (20260713092000 po pojednaniu
-- z 20260713210000; równoległy świat push_outbox/claim_due_digest_users
-- został usunięty).
--
--   1. push_subscriptions: własciciel widzi/zapisuje tylko swoje wiersze;
--      cudze subskrypcje niewidoczne (own-row RLS).
--   2. notification_push_queue: niedostępna dla authenticated (service-role
--      only); trigger na notifications kolejkuje payload TYLKO dla odbiorców
--      z opt-in push_enabled ORAZ żywą subskrypcją (failed_at IS NULL).
--   3. claim_push_jobs: atomowy claim z backoffem - drugi claim tej samej
--      partii nic nie zwraca.
--   4. claim_due_digests: stempluje digest_last_sent_at i zwraca wyłącznie
--      użytkowników z nieprzeczytanymi powiadomieniami; drugi claim w tym
--      samym oknie nic nie zwraca; przeczytane powiadomienia nie generują
--      digestu.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(12);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('a9111111-1111-1111-1111-111111111111', 'tenant-push', 'Tenant Push');

INSERT INTO auth.users (id, email) VALUES
  ('a9000000-0000-0000-0000-0000000000aa', 'sub-push@push.test'),
  ('a9000000-0000-0000-0000-0000000000bb', 'optout-push@push.test');

INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('a9000000-0000-0000-0000-0000000000aa', 'sub-push@push.test', 'Sub Push',
   'a9111111-1111-1111-1111-111111111111'),
  ('a9000000-0000-0000-0000-0000000000bb', 'optout-push@push.test', 'OptOut Push',
   'a9111111-1111-1111-1111-111111111111');

-- -- 1. Own-row RLS subskrypcji ------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a9000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

SELECT lives_ok(
  $$ INSERT INTO public.push_subscriptions (user_id, tenant_id, endpoint, p256dh, auth)
     VALUES ('a9000000-0000-0000-0000-0000000000aa',
             'a9111111-1111-1111-1111-111111111111',
             'https://push.example/ep-1', 'p256dh-0123456789abcdef', 'auth-0123456789') $$,
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
  NOT has_table_privilege('authenticated', 'public.notification_push_queue', 'SELECT'),
  'notification_push_queue jest service-role-only'
);

-- -- 2. Trigger kolejkowania: opt-in push_enabled + zywa subskrypcja ------------
RESET ROLE;

-- aa: opt-in + subskrypcja (z sekcji 1). bb: subskrypcja, ale BEZ opt-in.
INSERT INTO public.notification_preferences (user_id, tenant_id, push_enabled)
VALUES ('a9000000-0000-0000-0000-0000000000aa',
        'a9111111-1111-1111-1111-111111111111', true)
ON CONFLICT (user_id) DO UPDATE SET push_enabled = true;

INSERT INTO public.push_subscriptions (user_id, tenant_id, endpoint, p256dh, auth)
VALUES ('a9000000-0000-0000-0000-0000000000bb',
        'a9111111-1111-1111-1111-111111111111',
        'https://push.example/ep-2', 'p256dh-0123456789abcdef', 'auth-0123456789');

INSERT INTO public.notifications (user_id, tenant_id, kind, title_pl, href) VALUES
  ('a9000000-0000-0000-0000-0000000000aa', 'a9111111-1111-1111-1111-111111111111',
   'system', 'Test push', '/x'),
  ('a9000000-0000-0000-0000-0000000000bb', 'a9111111-1111-1111-1111-111111111111',
   'system', 'Test bez opt-in', '/y');

SELECT is(
  (SELECT count(*)::int FROM public.notification_push_queue
    WHERE user_id = 'a9000000-0000-0000-0000-0000000000aa'),
  1,
  'powiadomienie odbiorcy z opt-in i subskrypcja trafia do kolejki push'
);

SELECT is(
  (SELECT count(*)::int FROM public.notification_push_queue
    WHERE user_id = 'a9000000-0000-0000-0000-0000000000bb'),
  0,
  'odbiorca bez opt-in (push_enabled=false) nie generuje zadania push'
);

SELECT is(
  (SELECT q.payload->>'title_pl' FROM public.notification_push_queue q
    WHERE q.user_id = 'a9000000-0000-0000-0000-0000000000aa' LIMIT 1),
  'Test push',
  'payload push niesie tytul powiadomienia'
);

-- -- 3. Atomowy claim zadan push -------------------------------------------------
SELECT is(
  (SELECT count(*)::int FROM public.claim_push_jobs(50)),
  1,
  'claim_push_jobs zdejmuje oczekujace zadanie'
);

SELECT is(
  (SELECT count(*)::int FROM public.claim_push_jobs(50)),
  0,
  'drugi claim nic nie zwraca (backoff next_attempt_at ustawiony przy claimie)'
);

-- -- 4. Digest claim ---------------------------------------------------------------
INSERT INTO public.notification_preferences (user_id, tenant_id, email_digest)
VALUES ('a9000000-0000-0000-0000-0000000000aa',
        'a9111111-1111-1111-1111-111111111111', 'daily')
ON CONFLICT (user_id) DO UPDATE SET email_digest = 'daily';

SELECT is(
  (SELECT count(*)::int FROM public.claim_due_digests('daily', 50)
    WHERE user_id = 'a9000000-0000-0000-0000-0000000000aa'),
  1,
  'claim_due_digests zwraca uzytkownika z nieprzeczytanymi powiadomieniami'
);

SELECT is(
  (SELECT count(*)::int FROM public.claim_due_digests('daily', 50)
    WHERE user_id = 'a9000000-0000-0000-0000-0000000000aa'),
  0,
  'drugi claim w tym samym oknie nie zwraca uzytkownika (last_sent ostemplowany)'
);

-- bb: digest wlaczony, ale jedyne powiadomienie przeczytane -> brak wysylki.
UPDATE public.notifications SET read_at = now()
 WHERE user_id = 'a9000000-0000-0000-0000-0000000000bb';
INSERT INTO public.notification_preferences (user_id, tenant_id, email_digest)
VALUES ('a9000000-0000-0000-0000-0000000000bb',
        'a9111111-1111-1111-1111-111111111111', 'daily')
ON CONFLICT (user_id) DO UPDATE SET email_digest = 'daily';

SELECT is(
  (SELECT count(*)::int FROM public.claim_due_digests('daily', 50)
    WHERE user_id = 'a9000000-0000-0000-0000-0000000000bb'),
  0,
  'przeczytane powiadomienia nie generuja digestu (puste wysylki odpadaja)'
);

SELECT * FROM finish();
ROLLBACK;
