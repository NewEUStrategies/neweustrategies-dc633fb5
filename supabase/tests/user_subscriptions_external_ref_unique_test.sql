-- pgTAP: jedno uprawnienie na klucz operatora + kolumna strażnika kolejności
-- (migracje 20261012100200_subscription_event_guard
--  i 20261012100300_user_subscriptions_external_ref_unique, audyt PAY-02/PAY-10).
--
-- `syncEntitlementState` i `grantEntitlement` zamieniają przegrany wyścig
-- (23505) w aktualizację TEGO SAMEGO klucza - działa to wyłącznie wtedy, gdy
-- baza naprawdę odrzuca drugi wiersz z tym samym `external_ref`. Bez indeksu
-- dwa równoległe zdarzenia zakładały dwa uprawnienia, a późniejsza rezygnacja
-- trafiała tylko w najstarsze - drugie dawało dostęp bez płatności.
BEGIN;
SELECT plan(6);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('e7f00000-0000-0000-0000-0000000000aa', 'ext-ref', 'Ext Ref', 'ext-ref.example');
INSERT INTO auth.users (id, email) VALUES
  ('e7f00000-0000-0000-0000-0000000000b1', 'ext-ref-a@example.org'),
  ('e7f00000-0000-0000-0000-0000000000b2', 'ext-ref-b@example.org');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('e7f00000-0000-0000-0000-0000000000b1', 'ext-ref-a@example.org', 'A',
   'e7f00000-0000-0000-0000-0000000000aa'),
  ('e7f00000-0000-0000-0000-0000000000b2', 'ext-ref-b@example.org', 'B',
   'e7f00000-0000-0000-0000-0000000000aa');
INSERT INTO public.access_plans
  (id, tenant_id, name_pl, name_en, price_cents, currency, interval, tier_key, active)
VALUES
  ('e7f00000-0000-0000-0000-0000000000c1', 'e7f00000-0000-0000-0000-0000000000aa',
   'Pro', 'Pro', 4900, 'PLN', 'month', 'pro', true);

SELECT has_column('public', 'subscriptions', 'last_event_id',
  'strażnik kolejności zna identyfikator ostatniego zdarzenia (ponowienie vs remis)');

SELECT has_index('public', 'user_subscriptions', 'user_subscriptions_external_ref_key',
  'external_ref ma indeks unikalny - arbiter ON CONFLICT dla zapisu uprawnienia');

INSERT INTO public.user_subscriptions
  (user_id, tenant_id, plan_id, status, external_ref, current_period_end)
VALUES
  ('e7f00000-0000-0000-0000-0000000000b1', 'e7f00000-0000-0000-0000-0000000000aa',
   'e7f00000-0000-0000-0000-0000000000c1', 'active', 'sub_ext_ref_1', now() + interval '30 days');

SELECT throws_ok(
  $$INSERT INTO public.user_subscriptions
      (user_id, tenant_id, plan_id, status, external_ref, current_period_end)
    VALUES ('e7f00000-0000-0000-0000-0000000000b1', 'e7f00000-0000-0000-0000-0000000000aa',
      'e7f00000-0000-0000-0000-0000000000c1', 'active', 'sub_ext_ref_1', now() + interval '30 days')$$,
  '23505', NULL,
  'drugie uprawnienie na ten sam klucz operatora: 23505 (wyścig created/updated nie dubluje dostępu)');

SELECT lives_ok(
  $$INSERT INTO public.user_subscriptions
      (user_id, tenant_id, plan_id, status, external_ref, current_period_end)
    VALUES ('e7f00000-0000-0000-0000-0000000000b1', 'e7f00000-0000-0000-0000-0000000000aa',
      'e7f00000-0000-0000-0000-0000000000c1', 'active', 'sub_ext_ref_1', now() + interval '30 days')
    ON CONFLICT (external_ref) DO NOTHING$$,
  'ON CONFLICT (external_ref) DO NOTHING ma arbitra - zapis bez wyjątku');

SELECT is(
  (SELECT count(*)::int FROM public.user_subscriptions WHERE external_ref = 'sub_ext_ref_1'),
  1,
  'po wyścigu klucz ma dokładnie jeden wiersz');

SELECT lives_ok(
  $$INSERT INTO public.user_subscriptions
      (user_id, tenant_id, plan_id, status, external_ref, current_period_end)
    VALUES
      ('e7f00000-0000-0000-0000-0000000000b1', 'e7f00000-0000-0000-0000-0000000000aa',
       'e7f00000-0000-0000-0000-0000000000c1', 'active', NULL, NULL),
      ('e7f00000-0000-0000-0000-0000000000b2', 'e7f00000-0000-0000-0000-0000000000aa',
       'e7f00000-0000-0000-0000-0000000000c1', 'active', NULL, NULL)$$,
  'uprawnienia bez klucza operatora (NULL) wciąż mogą współistnieć');

SELECT * FROM finish();
ROLLBACK;
