-- pgTAP: transport i operacje rozliczeń (PAY-08, PAY-17a, PAY-17c; przegląd
-- 3.1-3.3, 3.5, 7.6, 7.9). Migracje: billing_cron_own_secret,
-- payment_webhook_sweep_candidates, billing_probe_status.
--
-- CO PRZYPINA:
--   1. Sekret rozliczeń - prywatna kolumna `billing_secret` (bez SELECT dla
--      klienta), różna od sekretu runnera (CHECK); `invoke_billing_cron()`
--      puka NIĄ, nigdy sekretem wspólnym, z terminem 60 s.
--   2. Kandydaci zamiatarki liczeni w bazie:
--      * 3.2 - wiersz do wzięcia jest zwracany mimo 120 STARSZYCH wierszy
--        czekających na odstęp (wcześniej: 100 najstarszych + filtr w JS),
--      * 3.1 - porzucone `received` mają odstęp wykładniczy (retry 7 sprzed
--        6 min NIE jest do wzięcia, retry 1 sprzed 11 min jest),
--      * 3.3 - horyzont od czasu ZDARZENIA (20-dniowe zdarzenie w świeżym
--        wierszu odpada; bez `occurred_at` liczy się utworzenie; syntetyczna
--        naprawa `reconcile_…` - stan z chwili naprawy - od utworzenia),
--      * sufit prób, statusy końcowe, kolejność „najdłużej czeka", ACL.
--   3. Sonda bez service_role - token, którego skrót (nie wartość) leży
--      w bazie; odczyt wyłącznie piaskownicy jednej subskrypcji od chwili
--      zbrojenia, wyłącznie pól sondy; ACL i rotacja.
--
-- now() jest stały w transakcji - wszystkie znaczniki czasu liczą się od niego.
BEGIN;
SELECT plan(40);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('d2a00000-0000-0000-0000-0000000000aa', 'd2-billing-ops', 'D2 Billing Ops', 'd2-billing-ops.example');
INSERT INTO auth.users (id, email) VALUES
  ('d2a00000-0000-0000-0000-0000000000a1', 'd2-billing-ops@example.org');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('d2a00000-0000-0000-0000-0000000000a1', 'd2-billing-ops@example.org', 'D2 Ops',
   'd2a00000-0000-0000-0000-0000000000aa');

-- ── 1-11. Sekret rozliczeń i puknięcie pg_cron ──────────────────────────────
SELECT has_column('public', 'job_runner_settings', 'billing_secret',
  'job_runner_settings.billing_secret istnieje');
SELECT col_not_null('public', 'job_runner_settings', 'billing_secret',
  'billing_secret jest NOT NULL (puknięcie zawsze ma czym się przedstawić)');
SELECT ok(
  NOT has_column_privilege('anon', 'public.job_runner_settings', 'billing_secret', 'SELECT')
  AND NOT has_column_privilege('authenticated', 'public.job_runner_settings', 'billing_secret', 'SELECT'),
  'billing_secret: brak SELECT dla klienta (anon, authenticated)');
SELECT ok(
  has_column_privilege('service_role', 'public.job_runner_settings', 'billing_secret', 'SELECT'),
  'billing_secret: odczyt dla service_role (endpoint rozliczeń porównuje nagłówek)');
SELECT ok(
  (SELECT length(billing_secret) = 64 AND billing_secret <> secret
     FROM public.job_runner_settings WHERE id = 1),
  'wylosowany sekret rozliczeń ma 64 znaki i jest RÓŻNY od sekretu runnera');
SELECT throws_ok(
  $$UPDATE public.job_runner_settings SET billing_secret = secret WHERE id = 1$$,
  '23514', NULL,
  'CHECK: sekret rozliczeń nie może być sekretem wspólnym (community-cron, jobs-tick)');
SELECT ok(
  NOT has_function_privilege('anon', 'public.invoke_billing_cron()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.invoke_billing_cron()', 'EXECUTE'),
  'invoke_billing_cron: bez EXECUTE dla klienta');

-- Nieobecność prawdziwego pg_net WYMUSZAMY (na Supabase jest zainstalowany),
-- a na jego miejsce wstawiamy atrapę zapisującą argumenty. DDL jest
-- transakcyjne - ROLLBACK na końcu przywraca rozszerzenie.
DROP EXTENSION IF EXISTS pg_net CASCADE;
CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE public.d2_http_capture (url text, headers jsonb, timeout_ms integer);
CREATE OR REPLACE FUNCTION net.http_post(
  url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
  headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
  RETURNS bigint LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.d2_http_capture VALUES (url, headers, timeout_milliseconds);
  RETURN 1;
END $$;

UPDATE public.job_runner_settings
   SET enabled = true, base_url = 'https://d2-billing-ops.example'
 WHERE id = 1;

SELECT lives_ok($$SELECT public.invoke_billing_cron()$$, 'invoke_billing_cron puka');
SELECT is(
  (SELECT headers->>'x-billing-cron-secret' FROM public.d2_http_capture),
  (SELECT billing_secret FROM public.job_runner_settings WHERE id = 1),
  'nagłówek niesie SEKRET ROZLICZEŃ');
SELECT isnt(
  (SELECT headers->>'x-billing-cron-secret' FROM public.d2_http_capture),
  (SELECT secret FROM public.job_runner_settings WHERE id = 1),
  'nagłówek NIE niesie sekretu runnera');
SELECT results_eq(
  $$SELECT url, timeout_ms FROM public.d2_http_capture$$,
  $$VALUES ('https://d2-billing-ops.example/api/public/billing-cron'::text, 60000)$$,
  'adres endpointu rozliczeń i termin 60 s (BILLING_CRON_CALLER_TIMEOUT_MS)');

-- ── 12-22. Kandydaci zamiatarki ──────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon',
    'public.payment_webhook_sweep_candidates(integer, integer, bigint, bigint, bigint)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'public.payment_webhook_sweep_candidates(integer, integer, bigint, bigint, bigint)', 'EXECUTE'),
  'payment_webhook_sweep_candidates: bez EXECUTE dla klienta');
SELECT ok(
  has_function_privilege('service_role',
    'public.payment_webhook_sweep_candidates(integer, integer, bigint, bigint, bigint)', 'EXECUTE'),
  'payment_webhook_sweep_candidates: EXECUTE dla service_role (zamiatarka)');

-- 120 STARSZYCH wierszy `failed` w odstępie (retry 3 = 40 min, ostatnia próba
-- 10 min temu) - dokładnie ta setka, która zasłaniała nowsze wiersze.
INSERT INTO public.payment_webhook_events
  (event_id, event_type, environment, status, created_at, occurred_at, processed_at, retry_count, tenant_id)
SELECT 'd2sweep_waiting_' || g, 'customer.updated', 'live', 'failed',
       now() - interval '2 days' + g * interval '1 second', now() - interval '2 days',
       now() - interval '10 minutes', 3, 'd2a00000-0000-0000-0000-0000000000aa'
  FROM generate_series(1, 120) g;

INSERT INTO public.payment_webhook_events
  (event_id, event_type, environment, status, created_at, occurred_at, processed_at,
   last_retried_at, retry_count, tenant_id)
VALUES
  -- do wzięcia: porażka sprzed 30 min, pierwszy odstęp 5 min (NAJDŁUŻEJ czeka)
  ('d2sweep_due_failed', 'transaction.completed', 'live', 'failed',
   now() - interval '1 hour', now() - interval '1 hour', now() - interval '30 minutes',
   NULL, 0, 'd2a00000-0000-0000-0000-0000000000aa'),
  -- porzucone `received`, retry 0: okno 5 min minęło
  ('d2sweep_recv_r0', 'customer.updated', 'live', 'received',
   now() - interval '6 minutes', now() - interval '6 minutes', NULL,
   NULL, 0, 'd2a00000-0000-0000-0000-0000000000aa'),
  -- porzucone `received`, retry 1: odstęp 10 min minął
  ('d2sweep_recv_r1', 'customer.updated', 'live', 'received',
   now() - interval '1 hour', now() - interval '1 hour', NULL,
   now() - interval '11 minutes', 1, 'd2a00000-0000-0000-0000-0000000000aa'),
  -- `received`, retry 1, przejęte 9 min temu: odstęp 10 min jeszcze trwa
  ('d2sweep_recv_r1_waiting', 'customer.updated', 'live', 'received',
   now() - interval '1 hour', now() - interval '1 hour', NULL,
   now() - interval '9 minutes', 1, 'd2a00000-0000-0000-0000-0000000000aa'),
  -- `received`, retry 7, przejęte 6 min temu: sam test porzucenia brał go co
  -- 5 minut; odstęp 640 min - nie teraz (3.1)
  ('d2sweep_recv_r7', 'customer.updated', 'live', 'received',
   now() - interval '1 hour', now() - interval '1 hour', NULL,
   now() - interval '6 minutes', 7, 'd2a00000-0000-0000-0000-0000000000aa'),
  -- zdarzenie sprzed 20 dni w ŚWIEŻYM wierszu (naprawa z uzgadniania) - poza
  -- horyzontem liczonym od czasu zdarzenia (3.3)
  ('d2sweep_stale_event', 'transaction.payment_failed', 'live', 'failed',
   now() - interval '1 hour', now() - interval '20 days', now() - interval '20 minutes',
   NULL, 0, 'd2a00000-0000-0000-0000-0000000000aa'),
  -- bez czasu zdarzenia: horyzont od utworzenia wiersza
  ('d2sweep_no_occurred', 'customer.updated', 'sandbox', 'failed',
   now() - interval '1 hour', NULL, now() - interval '10 minutes',
   NULL, 0, 'd2a00000-0000-0000-0000-0000000000aa'),
  -- syntetyczna naprawa zamówienia: stan sesji z chwili naprawy, occurred_at
  -- = czas zakupu sprzed tygodnia (paid_at) - wiek liczy się od wiersza
  ('reconcile_d2sweep_cs_1_4085000000', 'transaction.completed', 'live', 'failed',
   now() - interval '1 hour', now() - interval '7 days', now() - interval '10 minutes',
   NULL, 0, 'd2a00000-0000-0000-0000-0000000000aa'),
  -- sufit prób: automat oddaje zdarzenie człowiekowi
  ('d2sweep_capped', 'customer.updated', 'live', 'failed',
   now() - interval '1 hour', now() - interval '1 hour', now() - interval '2 days',
   NULL, 8, 'd2a00000-0000-0000-0000-0000000000aa'),
  -- status końcowy
  ('d2sweep_done', 'customer.updated', 'live', 'processed',
   now() - interval '1 hour', now() - interval '1 hour', now() - interval '50 minutes',
   NULL, 0, 'd2a00000-0000-0000-0000-0000000000aa');

SELECT set_eq(
  $$SELECT event_id FROM public.payment_webhook_sweep_candidates(100, 8, 300000, 300000, 259200000)
     WHERE event_id LIKE 'd2sweep_%'$$,
  ARRAY['d2sweep_due_failed', 'd2sweep_recv_r0', 'd2sweep_recv_r1', 'd2sweep_no_occurred'],
  'zwraca WYŁĄCZNIE wiersze do wzięcia teraz');
SELECT ok(
  'reconcile_d2sweep_cs_1_4085000000' IN (
    SELECT event_id FROM public.payment_webhook_sweep_candidates(100, 8, 300000, 300000, 259200000)),
  '3.3: syntetyczna naprawa (stan z chwili naprawy) liczy wiek od wiersza, nie od czasu zakupu');
SELECT ok(
  'd2sweep_due_failed' IN (
    SELECT event_id FROM public.payment_webhook_sweep_candidates(4, 8, 300000, 300000, 259200000)),
  '3.2: wiersz do wzięcia przechodzi przez limit mimo 120 starszych wierszy w odstępie');
SELECT is(
  (SELECT count(*)::int FROM public.payment_webhook_sweep_candidates(100, 8, 300000, 300000, 259200000)
    WHERE event_id LIKE 'd2sweep_waiting_%'),
  0,
  '3.2: wiersze w odstępie nie zajmują miejsc w partii');
SELECT ok(
  'd2sweep_recv_r7' NOT IN (
    SELECT event_id FROM public.payment_webhook_sweep_candidates(100, 8, 300000, 300000, 259200000)),
  '3.1: porzucone received z retry 7 czeka na odstęp 640 min, nie 5 min');
SELECT ok(
  'd2sweep_recv_r1_waiting' NOT IN (
    SELECT event_id FROM public.payment_webhook_sweep_candidates(100, 8, 300000, 300000, 259200000)),
  '3.1: porzucone received z retry 1 czeka 10 min od ostatniego przejęcia');
SELECT ok(
  'd2sweep_stale_event' NOT IN (
    SELECT event_id FROM public.payment_webhook_sweep_candidates(100, 8, 300000, 300000, 259200000)),
  '3.3: horyzont liczy się od occurred_at - 20-dniowe zdarzenie w świeżym wierszu odpada');
SELECT is(
  (SELECT event_id FROM public.payment_webhook_sweep_candidates(100, 8, 300000, 300000, 259200000)
    WHERE event_id LIKE 'd2sweep_%' LIMIT 1),
  'd2sweep_due_failed',
  'najdłużej czekający wiersz idzie pierwszy');
SELECT is(
  (SELECT count(*)::int FROM public.payment_webhook_sweep_candidates(2, 8, 300000, 300000, 259200000)),
  2,
  'limit partii jest respektowany');

-- ── 23-40. Sonda bez service_role ─────────────────────────────────────────────
SELECT ok(
  NOT has_table_privilege('anon', 'public.billing_probe_credentials', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.billing_probe_credentials', 'SELECT'),
  'billing_probe_credentials: brak SELECT dla klienta');
SELECT ok(
  NOT has_function_privilege('anon', 'public.billing_probe_rotate_token()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.billing_probe_rotate_token()', 'EXECUTE'),
  'billing_probe_rotate_token: wyłącznie service_role / SQL editor');
SELECT ok(
  has_function_privilege('anon', 'public.billing_probe_status(text, text, timestamptz)', 'EXECUTE'),
  'billing_probe_status: wołana kluczem publikowalnym (anon) - autoryzuje token');

INSERT INTO public.payment_webhook_events
  (event_id, event_type, environment, status, error, subscription_id, created_at, payload, tenant_id)
VALUES
  ('d2probe_renewal', 'subscription.updated', 'sandbox', 'processed', NULL, 'sub_d2probe',
   now() - interval '10 minutes', '{"secret":"x"}'::jsonb, 'd2a00000-0000-0000-0000-0000000000aa'),
  ('d2probe_invoice', 'transaction.completed', 'sandbox', 'failed', repeat('e', 900), 'sub_d2probe',
   now() - interval '5 minutes', '{}'::jsonb, 'd2a00000-0000-0000-0000-0000000000aa'),
  -- produkcja z tym samym identyfikatorem - sonda jej NIE widzi
  ('d2probe_live', 'subscription.updated', 'live', 'processed', NULL, 'sub_d2probe',
   now() - interval '5 minutes', '{}'::jsonb, 'd2a00000-0000-0000-0000-0000000000aa'),
  -- inna subskrypcja i zdarzenie sprzed zbrojenia - też nie
  ('d2probe_other', 'subscription.updated', 'sandbox', 'processed', NULL, 'sub_d2other',
   now() - interval '5 minutes', '{}'::jsonb, 'd2a00000-0000-0000-0000-0000000000aa'),
  ('d2probe_before', 'subscription.updated', 'sandbox', 'failed', 'stare', 'sub_d2probe',
   now() - interval '2 hours', '{}'::jsonb, 'd2a00000-0000-0000-0000-0000000000aa');

INSERT INTO public.subscriptions
  (user_id, tenant_id, environment, provider_subscription_id, provider_customer_id,
   price_id, product_id, status, current_period_end)
VALUES
  ('d2a00000-0000-0000-0000-0000000000a1', 'd2a00000-0000-0000-0000-0000000000aa', 'sandbox',
   'sub_d2probe', 'cus_d2probe', 'plus_monthly', 'plus', 'active', now() + interval '30 days');

-- Przed pierwszą rotacją sonda jest wyłączona - każdy token to odmowa.
SELECT throws_ok(
  $$SELECT public.billing_probe_status(repeat('a', 64), 'sub_d2probe', now() - interval '1 hour')$$,
  '42501', NULL,
  'bez tokenu w bazie (przed rotacją) odczyt jest odmową');

-- Zwykłe tabele (wycofywane ROLLBACK-iem), bo rola `anon` nie tworzy tabel
-- tymczasowych i nie czyta cudzych.
CREATE TABLE public.d2_probe_token AS SELECT public.billing_probe_rotate_token() AS t;
CREATE TABLE public.d2_probe_result (r jsonb);
GRANT SELECT ON public.d2_probe_token TO anon;
GRANT INSERT ON public.d2_probe_result TO anon;

SELECT ok((SELECT t ~ '^[0-9a-f]{64}$' FROM public.d2_probe_token), 'rotacja zwraca 64-znakowy token');
SELECT is(
  (SELECT token_sha256 FROM public.billing_probe_credentials WHERE id = 1),
  (SELECT encode(sha256(convert_to(t, 'UTF8')), 'hex') FROM public.d2_probe_token),
  'w bazie leży SKRÓT tokenu, nie token');

SET LOCAL ROLE anon;
INSERT INTO public.d2_probe_result
  SELECT public.billing_probe_status(
    (SELECT t FROM public.d2_probe_token), 'sub_d2probe', now() - interval '1 hour');
RESET ROLE;

SELECT set_eq(
  $$SELECT e->>'event_id' FROM public.d2_probe_result, jsonb_array_elements(r->'webhook_events') e$$,
  ARRAY['d2probe_renewal', 'd2probe_invoice'],
  'anon z tokenem widzi wyłącznie zdarzenia PIASKOWNICY tej subskrypcji od zbrojenia');
SELECT set_eq(
  $$SELECT DISTINCT k FROM public.d2_probe_result, jsonb_array_elements(r->'webhook_events') e,
           jsonb_object_keys(e) k$$,
  ARRAY['event_id', 'event_type', 'status', 'error', 'created_at'],
  'zdarzenia niosą wyłącznie pola sondy (bez ładunku, najemcy, użytkownika)');
SELECT is(
  (SELECT max(length(e->>'error')) FROM public.d2_probe_result, jsonb_array_elements(r->'webhook_events') e),
  500,
  'komunikat błędu przycięty do 500 znaków');
SELECT is(
  (SELECT r->'subscription'->>'provider_subscription_id' FROM public.d2_probe_result),
  'sub_d2probe',
  'stan subskrypcji z piaskownicy');
SELECT set_eq(
  $$SELECT k FROM public.d2_probe_result, jsonb_object_keys(r->'subscription') k$$,
  ARRAY['provider_subscription_id', 'status', 'current_period_end'],
  'subskrypcja niesie wyłącznie pola sondy');

SELECT throws_ok(
  $$SELECT public.billing_probe_status(repeat('b', 64), 'sub_d2probe', now() - interval '1 hour')$$,
  '42501', NULL,
  'zły token: odmowa');
SELECT throws_ok(
  $$SELECT public.billing_probe_status(NULL, 'sub_d2probe', now() - interval '1 hour')$$,
  '42501', NULL,
  'brak tokenu: odmowa');
SELECT throws_ok(
  $$SELECT public.billing_probe_status((SELECT t FROM public.d2_probe_token), 'cus_d2probe', now() - interval '1 hour')$$,
  '22023', NULL,
  'identyfikator spoza kształtu sub_… jest odrzucany');
SELECT throws_ok(
  $$SELECT public.billing_probe_status((SELECT t FROM public.d2_probe_token), 'sub_d2probe', now() - interval '8 days')$$,
  '22023', NULL,
  'okno dłuższe niż 7 dni jest odrzucane');

-- Rotacja unieważnia poprzedni token.
CREATE TABLE public.d2_probe_token_2 AS SELECT public.billing_probe_rotate_token() AS t;
SELECT throws_ok(
  $$SELECT public.billing_probe_status((SELECT t FROM public.d2_probe_token), 'sub_d2probe', now() - interval '1 hour')$$,
  '42501', NULL,
  'po rotacji stary token jest odmową');
SELECT lives_ok(
  $$SELECT public.billing_probe_status((SELECT t FROM public.d2_probe_token_2), 'sub_d2probe', now() - interval '1 hour')$$,
  'po rotacji nowy token działa');
SELECT ok(
  (SELECT r->'subscription' = 'null'::jsonb OR r->'subscription' IS NULL
     FROM (SELECT public.billing_probe_status((SELECT t FROM public.d2_probe_token_2), 'sub_d2none',
                                              now() - interval '1 hour') AS r) x),
  'subskrypcja bez wiersza: `subscription` puste, nie błąd');

SELECT * FROM finish();
ROLLBACK;
