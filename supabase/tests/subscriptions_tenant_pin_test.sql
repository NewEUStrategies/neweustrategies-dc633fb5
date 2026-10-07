-- pgTAP: subskrypcja zapisana przez webhook (rola serwisowa, bez naglowka hosta)
-- trafia do najemcy PROFILU wlasciciela (migracja
-- 20261007140300_subscriptions_tenant_from_owner).
--
-- DEFEKT. DEFAULT public_tenant_id() pod rola serwisowa zwraca najemce
-- domyslnego, a webhook nie podaje tenant_id - kazda subskrypcja konta
-- z innego najemcy ladowala w domyslnym.
BEGIN;
SELECT plan(5);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('5b0b0000-0000-0000-0000-0000000000bb', 'subs-pin-b', 'Subs Pin B', 'subs-pin-b.example');
INSERT INTO auth.users (id, email) VALUES
  ('5b000000-0000-0000-0000-0000000000b1', 'subs-pin-b1@example.org');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('5b000000-0000-0000-0000-0000000000b1', 'subs-pin-b1@example.org', 'Subs Pin B1',
   '5b0b0000-0000-0000-0000-0000000000bb');

SELECT ok(
  NOT has_function_privilege('anon', 'public.subscriptions_pin_tenant()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.subscriptions_pin_tenant()', 'EXECUTE'),
  'funkcja triggera niedostepna dla klienta');

-- Zapis jak webhook: rola serwisowa, brak naglowka hosta, brak tenant_id.
SELECT set_config('request.headers', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO public.subscriptions
  (user_id, provider_subscription_id, provider_customer_id, product_id, price_id, status, environment)
VALUES
  ('5b000000-0000-0000-0000-0000000000b1', 'sub_pin_test_1', 'cus_pin_test_1', 'prod_x', 'price_x', 'active', 'sandbox');
RESET ROLE;

SELECT is(
  (SELECT tenant_id FROM public.subscriptions WHERE provider_subscription_id = 'sub_pin_test_1'),
  '5b0b0000-0000-0000-0000-0000000000bb'::uuid,
  'subskrypcja z webhooka trafia do najemcy PROFILU wlasciciela, nie do domyslnego');

-- Aktualizacja statusu (kolejne zdarzenie webhooka) nie przepina najemcy.
UPDATE public.subscriptions SET status = 'past_due' WHERE provider_subscription_id = 'sub_pin_test_1';
SELECT is(
  (SELECT tenant_id FROM public.subscriptions WHERE provider_subscription_id = 'sub_pin_test_1'),
  '5b0b0000-0000-0000-0000-0000000000bb'::uuid,
  'zmiana statusu zostawia najemce');

-- Konto bez profilu: zapis platnosci sie nie wywraca (wartosc z DEFAULT zostaje).
INSERT INTO auth.users (id, email) VALUES
  ('5b000000-0000-0000-0000-0000000000b9', 'subs-pin-noprofile@example.org');
SELECT lives_ok(
  $$INSERT INTO public.subscriptions
      (user_id, provider_subscription_id, provider_customer_id, product_id, price_id, status, environment)
    VALUES ('5b000000-0000-0000-0000-0000000000b9', 'sub_pin_test_2', 'cus_pin_test_2', 'prod_x', 'price_x', 'active', 'sandbox')$$,
  'konto bez profilu: zapis subskrypcji przechodzi');
SELECT ok(
  (SELECT tenant_id IS NOT NULL FROM public.subscriptions WHERE provider_subscription_id = 'sub_pin_test_2'),
  'konto bez profilu: tenant_id z wartosci awaryjnej (DEFAULT)');

SELECT set_config('request.jwt.claims', '', true);
SELECT * FROM finish();
ROLLBACK;
