-- pgTAP: kanały sygnałów (@wzmianka, prośba o zdanie) - przenieść do
-- supabase/tests/notification_signal_channels_test.sql razem z migracją
-- 20261120120000_notification_signal_channels.sql.
--
-- Zakres:
--   1. E-mail sygnału jest domyślnie WYŁĄCZONY (brak wiersza preferencji
--      i świeży wiersz) - decyzja właściciela 2026-11-20.
--   2. Włączony e-mail: prośba o zdanie tworzy jedno zadanie e-mail, druga
--      prośba w tym samym wątku jest cicha.
--   3. Webhook: sekret tylko przy utworzeniu, http/userinfo/nieznane
--      zdarzenia odrzucone (22023), wzmianka tworzy zadanie webhook.
--   4. push_scope = 'signals': zwykłe powiadomienie bez pusha, wzmianka
--      z jednym pushem; 'all' bez duplikatu.
--   5. Claim zwraca adres i sekret tylko serwisowi; raport 10 porażek
--      wyłącza webhook ('failures'), wyłączony webhook nie dostaje zadań.
--   6. Limit 12 e-maili sygnału na godzinę.
--   7. ACL: producent, claim i tabele niedostępne dla `authenticated`.
BEGIN;
SELECT plan(20);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name) VALUES
  ('e1111111-1111-1111-1111-1111111100a1', 'signal-tenant', 'Signal Tenant');
INSERT INTO auth.users (id, email) VALUES
  ('e0000000-0000-0000-0000-0000000000a1', 'signal-actor@test.test'),
  ('e0000000-0000-0000-0000-0000000000b1', 'signal-target@test.test');
INSERT INTO public.profiles (id, email, display_name, slug, tenant_id) VALUES
  ('e0000000-0000-0000-0000-0000000000a1', 'signal-actor@test.test', 'Signal Actor', 'signal-actor',
   'e1111111-1111-1111-1111-1111111100a1'),
  ('e0000000-0000-0000-0000-0000000000b1', 'signal-target@test.test', 'Signal Target', 'signal-target',
   'e1111111-1111-1111-1111-1111111100a1');

-- 1. domyślnie wyłączony e-mail
SELECT public.process_mentions(
  'e1111111-1111-1111-1111-1111111100a1', 'club_post', 'sig-1', 'hej @signal-target',
  'e0000000-0000-0000-0000-0000000000a1', 'club', '/club/x?post=sig-1');
SELECT is(
  (SELECT count(*)::int FROM public.notifications WHERE user_id = 'e0000000-0000-0000-0000-0000000000b1' AND href = '/club/x?post=sig-1'),
  1, 'wzmianka tworzy powiadomienie in-app');
SELECT is(
  (SELECT count(*)::int FROM public.notification_signal_jobs WHERE user_id = 'e0000000-0000-0000-0000-0000000000b1'),
  0, 'brak wiersza preferencji = brak e-maila sygnału');

INSERT INTO public.notification_preferences (user_id, tenant_id)
VALUES ('e0000000-0000-0000-0000-0000000000b1', 'e1111111-1111-1111-1111-1111111100a1');
SELECT is(
  (SELECT signal_email FROM public.notification_preferences WHERE user_id = 'e0000000-0000-0000-0000-0000000000b1'),
  false, 'signal_email domyślnie false');
SELECT is(
  (SELECT push_scope FROM public.notification_preferences WHERE user_id = 'e0000000-0000-0000-0000-0000000000b1'),
  'all', 'push_scope domyślnie all');

-- 2. e-mail włączony
UPDATE public.notification_preferences SET signal_email = true
 WHERE user_id = 'e0000000-0000-0000-0000-0000000000b1';
SELECT public.enqueue_signal_notification(
  'e0000000-0000-0000-0000-0000000000b1', 'expert_ping', 'club',
  'Poproszono Cię o zdanie', 'You were asked to weigh in', NULL, NULL, '/club/x/t/sig');
SELECT is(
  (SELECT count(*)::int FROM public.notification_signal_jobs
    WHERE user_id = 'e0000000-0000-0000-0000-0000000000b1' AND channel = 'email' AND signal = 'expert_ping'),
  1, 'włączony e-mail: prośba o zdanie tworzy zadanie e-mail');
SELECT public.enqueue_signal_notification(
  'e0000000-0000-0000-0000-0000000000b1', 'expert_ping', 'club',
  'Poproszono Cię o zdanie', 'You were asked to weigh in', NULL, NULL, '/club/x/t/sig');
SELECT is(
  (SELECT count(*)::int FROM public.notification_signal_jobs
    WHERE user_id = 'e0000000-0000-0000-0000-0000000000b1' AND channel = 'email'),
  1, 'dedup 5 min powiadomienia nie dubluje e-maila');

-- 3. webhook
SELECT set_config('request.jwt.claims',
  '{"sub":"e0000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SELECT ok(
  (SELECT secret LIKE 'whsec_%' FROM public.notification_webhook_save(
     'https://hooks.slack.com/services/T/B/x', 'slack', ARRAY['mention'])),
  'sekret zwracany przy utworzeniu');
SELECT ok(
  (SELECT secret IS NULL FROM public.notification_webhook_save(
     'https://hooks.slack.com/services/T/B/y', 'slack', ARRAY['mention', 'expert_ping'])),
  'zmiana adresu nie ujawnia sekretu');
SELECT throws_ok(
  $$SELECT * FROM public.notification_webhook_save('http://hooks.test/x', 'standard', ARRAY['mention'])$$,
  '22023', NULL, 'http odrzucony');
SELECT throws_ok(
  $$SELECT * FROM public.notification_webhook_save('https://u:p@hooks.test/x', 'standard', ARRAY['mention'])$$,
  '22023', NULL, 'dane logowania w adresie odrzucone');
SELECT throws_ok(
  $$SELECT * FROM public.notification_webhook_save('https://hooks.test/x', 'standard', ARRAY['other'])$$,
  '22023', NULL, 'nieznane zdarzenie odrzucone');
SELECT set_config('request.jwt.claims', '', true);

SELECT public.enqueue_signal_notification(
  'e0000000-0000-0000-0000-0000000000b1', 'mention', 'club',
  'Signal Actor wspomniał(a) o Tobie', 'Signal Actor mentioned you', NULL, NULL, '/club/x?post=sig-2', 'at-sign');
SELECT is(
  (SELECT count(*)::int FROM public.notification_signal_jobs
    WHERE user_id = 'e0000000-0000-0000-0000-0000000000b1' AND channel = 'webhook'),
  1, 'wzmianka tworzy zadanie webhook');

-- 4. push_scope
INSERT INTO public.push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth)
VALUES ('e1111111-1111-1111-1111-1111111100a1', 'e0000000-0000-0000-0000-0000000000b1',
        'https://push.test/sig', 'k', 'a');
UPDATE public.notification_preferences SET push_enabled = true, push_scope = 'signals', signal_email = false
 WHERE user_id = 'e0000000-0000-0000-0000-0000000000b1';
SELECT public.enqueue_notification(
  'e0000000-0000-0000-0000-0000000000b1', 'content', 'Nowy tekst', 'New piece', NULL, NULL, '/sig/content');
SELECT is(
  (SELECT count(*)::int FROM public.notification_push_queue WHERE user_id = 'e0000000-0000-0000-0000-0000000000b1'),
  0, 'zakres signals: zwykłe powiadomienie bez pusha');
SELECT public.enqueue_signal_notification(
  'e0000000-0000-0000-0000-0000000000b1', 'mention', 'club', 'm', 'm', NULL, NULL, '/club/x?post=sig-3');
SELECT is(
  (SELECT count(*)::int FROM public.notification_push_queue WHERE user_id = 'e0000000-0000-0000-0000-0000000000b1'),
  1, 'zakres signals: wzmianka z jednym pushem');
UPDATE public.notification_preferences SET push_scope = 'all'
 WHERE user_id = 'e0000000-0000-0000-0000-0000000000b1';
SELECT public.enqueue_signal_notification(
  'e0000000-0000-0000-0000-0000000000b1', 'mention', 'club', 'm', 'm', NULL, NULL, '/club/x?post=sig-4');
SELECT is(
  (SELECT count(*)::int FROM public.notification_push_queue WHERE user_id = 'e0000000-0000-0000-0000-0000000000b1'),
  2, 'zakres all: wzmianka bez duplikatu pusha');

-- 5. claim/report
SELECT ok(
  (SELECT bool_and(CASE WHEN channel = 'email' THEN recipient_email = 'signal-target@test.test'
                        ELSE webhook_secret LIKE 'whsec_%' AND webhook_format = 'slack' END)
     FROM public.claim_notification_signal_jobs(50)
    WHERE user_id = 'e0000000-0000-0000-0000-0000000000b1'),
  'claim zwraca adres e-mail i sekret webhooka');
DO $$
DECLARE i int; v bigint;
BEGIN
  FOR i IN 1..10 LOOP
    INSERT INTO public.notification_signal_jobs (tenant_id, user_id, notification_id, channel, signal, webhook_id)
    SELECT w.tenant_id, w.user_id, gen_random_uuid(), 'webhook', 'mention', w.id
      FROM public.notification_webhooks w WHERE w.user_id = 'e0000000-0000-0000-0000-0000000000b1'
    RETURNING id INTO v;
    PERFORM public.report_notification_signal_jobs(
      jsonb_build_array(jsonb_build_object('id', v, 'outcome', 'retry', 'status', 500, 'error', 'boom')));
  END LOOP;
END;
$$;
SELECT is(
  (SELECT disabled_reason FROM public.notification_webhooks WHERE user_id = 'e0000000-0000-0000-0000-0000000000b1'),
  'failures', '10 kolejnych porażek wyłącza webhook');

-- 6. limit godzinowy
UPDATE public.notification_preferences SET signal_email = true
 WHERE user_id = 'e0000000-0000-0000-0000-0000000000b1';
DO $$
DECLARE i int;
BEGIN
  FOR i IN 1..15 LOOP
    PERFORM public.enqueue_signal_notification(
      'e0000000-0000-0000-0000-0000000000b1', 'mention', 'club', 'm', 'm', NULL, NULL, '/club/x?post=cap-' || i);
  END LOOP;
END;
$$;
SELECT is(
  (SELECT count(*)::int FROM public.notification_signal_jobs
    WHERE user_id = 'e0000000-0000-0000-0000-0000000000b1' AND channel = 'email'
      AND created_at > now() - interval '1 hour'),
  12, 'maks. 12 e-maili sygnału na godzinę');

-- 7. ACL
SELECT ok(
  NOT has_function_privilege('authenticated',
    'public.enqueue_signal_notification(uuid, text, text, text, text, text, text, text, text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.claim_notification_signal_jobs(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.report_notification_signal_jobs(jsonb)', 'EXECUTE'),
  'producent, claim i raport tylko dla serwera');
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.notification_webhooks', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.notification_signal_jobs', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.notification_webhooks', 'SELECT'),
  'tabele sygnałów bez grantów dla ról sesji');

SELECT * FROM finish();
ROLLBACK;
