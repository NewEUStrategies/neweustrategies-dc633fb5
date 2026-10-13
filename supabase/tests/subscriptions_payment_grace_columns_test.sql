-- pgTAP: kolumny cyklu zycia subskrypcji (migracja
-- 20261013090500_subscription_payment_grace_lifecycle; audyt SUB-02/03/14/16).
--
-- KONTRAKT, NA KTORYM STOI KOD WEBHOOKA:
--   * `first_payment_failed_at`, `purchase_confirmed_at` (timestamptz) i
--     `pause_collection_behavior` (text) istnieja i sa NULL-owalne;
--   * wstawienie-jesli-brak (`ON CONFLICT DO NOTHING`) nie nadpisuje stanu;
--   * zajecie potwierdzenia (`UPDATE ... WHERE purchase_confirmed_at IS NULL`)
--     i zamkniecie cyklu windykacji (`... AND payment_failure_count > 0`)
--     trafiaja dokladnie raz.
-- Uprawnienia tabeli migracja zostawia bez zmian (zapis: rola serwisowa).
BEGIN;
SELECT plan(9);

SELECT col_type_is('public', 'subscriptions', 'first_payment_failed_at', 'timestamp with time zone',
  'first_payment_failed_at: timestamptz');
SELECT col_type_is('public', 'subscriptions', 'purchase_confirmed_at', 'timestamp with time zone',
  'purchase_confirmed_at: timestamptz');
SELECT col_type_is('public', 'subscriptions', 'pause_collection_behavior', 'text',
  'pause_collection_behavior: text');
SELECT col_is_null('public', 'subscriptions', 'first_payment_failed_at',
  'first_payment_failed_at dopuszcza NULL (brak otwartego cyklu windykacji)');

SELECT col_is_null('public', 'subscriptions', 'purchase_confirmed_at',
  'purchase_confirmed_at dopuszcza NULL (wiersz bez wyslanych efektow zakupu)');

ALTER TABLE auth.users DISABLE TRIGGER USER;
INSERT INTO auth.users (id, email) VALUES
  ('5c000000-0000-0000-0000-0000000000c1', 'subs-grace-c1@example.org');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;

-- Wstawienie-jesli-brak (`ignoreDuplicates`): drugie wstawienie tego samego
-- identyfikatora nie nadpisuje stanu.
INSERT INTO public.subscriptions
  (user_id, provider_subscription_id, provider_customer_id, product_id, price_id, status,
   environment, last_event_at)
VALUES
  ('5c000000-0000-0000-0000-0000000000c1', 'sub_grace_test_1', 'cus_grace_1', 'plan_plus',
   'plus_monthly', 'active', 'sandbox', '2026-10-12T10:00:05Z')
ON CONFLICT (provider_subscription_id) DO NOTHING;
INSERT INTO public.subscriptions
  (user_id, provider_subscription_id, provider_customer_id, product_id, price_id, status,
   environment, last_event_at)
VALUES
  ('5c000000-0000-0000-0000-0000000000c1', 'sub_grace_test_1', 'cus_grace_1', 'plan_plus',
   'plus_monthly', 'incomplete', 'sandbox', '2026-10-12T10:00:00Z')
ON CONFLICT (provider_subscription_id) DO NOTHING;

SELECT is(
  (SELECT status FROM public.subscriptions WHERE provider_subscription_id = 'sub_grace_test_1'),
  'active',
  'spoznione created(incomplete) nie nadpisuje nowszego stanu');

-- Zajecie potwierdzenia zakupu: pierwsze trafia, drugie nie.
WITH claimed AS (
  UPDATE public.subscriptions SET purchase_confirmed_at = now()
   WHERE provider_subscription_id = 'sub_grace_test_1' AND purchase_confirmed_at IS NULL
  RETURNING id
)
SELECT is((SELECT count(*)::int FROM claimed), 1, 'pierwsze zajecie potwierdzenia trafia');

WITH claimed AS (
  UPDATE public.subscriptions SET purchase_confirmed_at = now()
   WHERE provider_subscription_id = 'sub_grace_test_1' AND purchase_confirmed_at IS NULL
  RETURNING id
)
SELECT is((SELECT count(*)::int FROM claimed), 0, 'drugie zajecie potwierdzenia nie trafia');

-- Atomowe zamkniecie cyklu windykacji: tylko przy otwartym cyklu.
UPDATE public.subscriptions
   SET payment_failure_count = 1, first_payment_failed_at = '2026-10-01T00:00:00Z'
 WHERE provider_subscription_id = 'sub_grace_test_1';
WITH recovered AS (
  UPDATE public.subscriptions
     SET payment_failure_count = 0, first_payment_failed_at = NULL
   WHERE provider_subscription_id = 'sub_grace_test_1' AND payment_failure_count > 0
  RETURNING id
), again AS (
  SELECT count(*)::int AS n FROM recovered
)
SELECT is((SELECT n FROM again), 1, 'zamkniecie otwartego cyklu windykacji trafia raz');

RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT * FROM finish();
ROLLBACK;
