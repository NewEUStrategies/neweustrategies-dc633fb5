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
--   5. push_subscriptions.tenant_id: najemca subskrypcji jest funkcją PROFILU
--      właściciela, nie przeglądanej witryny - trigger przypina go przy INSERT
--      i UPDATE, więc para (tenant_id, user_id) subskrypcji zgadza się z parą
--      zadania w kolejce, po której dyspozytor dobiera urządzenia.
--   6. przeniesienie konta między najemcami przepina subskrypcje właściciela,
--      więc pin nie zostaje migawką sprzed przeniesienia.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(16);

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

-- -- 5. Wiazanie najemcy subskrypcji z profilem wlasciciela --------------------
-- Kontrakt push ma dwie polowy: trigger tg_notifications_enqueue_push szuka
-- subskrypcji po SAMYM user_id i wstawia zadanie z najemca PROFILU odbiorcy, a
-- dyspozytor (processPushJobs) dobiera urzadzenia po PARZE (tenant_id,
-- user_id). Dopoki tenant_id subskrypcji pochodzil z DEFAULT
-- public_tenant_id(), czyli z HOSTA zadania, obie polowy rozjezdzaly sie dla
-- kazdego, kto wlaczyl push na domenie innego najemcy niz wlasny - dyspozytor
-- nie znajdowal ani jednego urzadzenia, a zadanie szlo w 'dead' bez ani jednej
-- proby wysylki.
RESET ROLE;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('a9222222-2222-2222-2222-222222222222', 'tenant-push-other', 'Tenant Push Other');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"a9000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);

-- Wlasciciel nalezy do 'tenant-push', a zapisuje subskrypcje z najemca OBCYM -
-- dokladnie to robil DEFAULT wywiedziony z hosta. RLS tego nie zatrzymuje:
-- polityka "push subs owner all" sprawdza wylacznie user_id.
INSERT INTO public.push_subscriptions (user_id, tenant_id, endpoint, p256dh, auth)
VALUES ('a9000000-0000-0000-0000-0000000000aa',
        'a9222222-2222-2222-2222-222222222222',
        'https://push.example/ep-3', 'p256dh-0123456789abcdef', 'auth-0123456789');

SELECT is(
  (SELECT tenant_id FROM public.push_subscriptions
    WHERE endpoint = 'https://push.example/ep-3'),
  'a9111111-1111-1111-1111-111111111111'::uuid,
  'INSERT z obcym najemca jest przypinany do najemcy profilu wlasciciela'
);

-- Upsert klienta (onConflict "endpoint") idzie sciezka UPDATE i nie podaje
-- tenant_id. Bez galezi UPDATE w triggerze bledny najemca zostalby na zawsze -
-- ponowne wlaczenie pusha nie naprawialoby wiersza.
UPDATE public.push_subscriptions
   SET tenant_id = 'a9222222-2222-2222-2222-222222222222'
 WHERE endpoint = 'https://push.example/ep-3';

SELECT is(
  (SELECT tenant_id FROM public.push_subscriptions
    WHERE endpoint = 'https://push.example/ep-3'),
  'a9111111-1111-1111-1111-111111111111'::uuid,
  'UPDATE nie wyprowadza subskrypcji do obcego najemcy (stary wiersz sie naprawia)'
);

RESET ROLE;

-- Kontrakt end-to-end: para (tenant_id, user_id) KAZDEJ zywej subskrypcji
-- odbiorcy musi zgadzac sie z para zadania - to jest dokladnie klucz adresata
-- (recipientKey) uzywany przez dyspozytor.
INSERT INTO public.notifications (user_id, tenant_id, kind, title_pl, href)
VALUES ('a9000000-0000-0000-0000-0000000000aa',
        'a9111111-1111-1111-1111-111111111111',
        'system', 'Test wiazania', '/z');

SELECT is(
  (SELECT count(*)::int
     FROM public.notification_push_queue q
     JOIN public.push_subscriptions ps
       ON ps.user_id = q.user_id AND ps.tenant_id = q.tenant_id
    WHERE q.user_id = 'a9000000-0000-0000-0000-0000000000aa'
      AND q.payload->>'title_pl' = 'Test wiazania'
      AND ps.failed_at IS NULL),
  2,
  'dyspozytor znajduje obie subskrypcje po parze (tenant_id, user_id) zadania'
);

-- -- 6. Przeniesienie konta miedzy najemcami -----------------------------------
-- Pin z sekcji 5 jest MIGAWKA z chwili zapisu. Przeniesienie konta (legalne dla
-- roli serwerowej - `profiles_pin_tenant_id` zwalnia is_service_role_caller(),
-- ta furtka chodzi przyjecie zaproszenia) osierociloby subskrypcje dokladnie
-- tak, jak robil to DEFAULT z hosta. Trigger profiles_repin_push_subscriptions
-- przepina je w tej samej transakcji, bez udzialu uzytkownika.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

UPDATE public.profiles
   SET tenant_id = 'a9222222-2222-2222-2222-222222222222'
 WHERE id = 'a9000000-0000-0000-0000-0000000000aa';

SELECT is(
  (SELECT tenant_id FROM public.push_subscriptions
    WHERE endpoint = 'https://push.example/ep-3'),
  'a9222222-2222-2222-2222-222222222222'::uuid,
  'przeniesienie konta przepina subskrypcje push na nowego najemce'
);

SELECT * FROM finish();
ROLLBACK;
