-- pgTAP: uprawnienia `user_subscriptions` znikają razem z kontem
-- (migracja 20261018150000_user_subscriptions_user_fk_cascade, RODO art. 17).
--
-- Bez klucza obcego `auth.admin.deleteUser()` zostawiał wiersze uprawnień
-- z surowym identyfikatorem osoby. Dowodem księgowym zostaje dokument
-- (`billing_documents`), który przeżywa uprawnienie z odpiętym
-- `subscription_id` - tego pilnują asercje 4-5.
BEGIN;
SELECT plan(7);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('e8f00000-0000-0000-0000-0000000000aa', 'us-fk', 'US FK', 'us-fk.example');
INSERT INTO auth.users (id, email) VALUES
  ('e8f00000-0000-0000-0000-0000000000b1', 'us-fk-a@example.org'),
  ('e8f00000-0000-0000-0000-0000000000b2', 'us-fk-b@example.org');
INSERT INTO public.access_plans
  (id, tenant_id, name_pl, name_en, price_cents, currency, interval, tier_key, active)
VALUES
  ('e8f00000-0000-0000-0000-0000000000c1', 'e8f00000-0000-0000-0000-0000000000aa',
   'Pro', 'Pro', 4900, 'PLN', 'month', 'pro', true);

SELECT fk_ok('public', 'user_subscriptions', 'user_id', 'auth', 'users', 'id',
  'user_subscriptions.user_id wskazuje auth.users(id)');

SELECT is(
  (SELECT confdeltype FROM pg_constraint
    WHERE conname = 'user_subscriptions_user_id_fkey'
      AND conrelid = 'public.user_subscriptions'::regclass),
  'c'::"char",
  'klucz właściciela kasuje uprawnienie kaskadowo (ON DELETE CASCADE)');

SELECT throws_ok(
  $$INSERT INTO public.user_subscriptions
      (user_id, tenant_id, plan_id, status, external_ref, current_period_end)
    VALUES ('e8f00000-0000-0000-0000-0000000000ff', 'e8f00000-0000-0000-0000-0000000000aa',
      'e8f00000-0000-0000-0000-0000000000c1', 'active', 'sub_us_fk_ghost', now() + interval '30 days')$$,
  '23503', NULL,
  'uprawnienie dla nieistniejącego konta jest odrzucane (23503) - nowych sierot nie będzie');

INSERT INTO public.user_subscriptions
  (id, user_id, tenant_id, plan_id, status, external_ref, current_period_end)
VALUES
  ('e8f00000-0000-0000-0000-0000000000d1', 'e8f00000-0000-0000-0000-0000000000b1',
   'e8f00000-0000-0000-0000-0000000000aa', 'e8f00000-0000-0000-0000-0000000000c1',
   'active', 'sub_us_fk_a', now() + interval '30 days'),
  ('e8f00000-0000-0000-0000-0000000000d2', 'e8f00000-0000-0000-0000-0000000000b2',
   'e8f00000-0000-0000-0000-0000000000aa', 'e8f00000-0000-0000-0000-0000000000c1',
   'active', 'sub_us_fk_b', now() + interval '30 days');
INSERT INTO public.billing_documents
  (id, tenant_id, user_id, subscription_id, provider_document_id)
VALUES
  ('e8f00000-0000-0000-0000-0000000000e1', 'e8f00000-0000-0000-0000-0000000000aa',
   'e8f00000-0000-0000-0000-0000000000b1', 'e8f00000-0000-0000-0000-0000000000d1',
   'in_us_fk_a');

DELETE FROM auth.users WHERE id = 'e8f00000-0000-0000-0000-0000000000b1';

SELECT is(
  (SELECT count(*)::int FROM public.user_subscriptions
    WHERE user_id = 'e8f00000-0000-0000-0000-0000000000b1'),
  0,
  'usunięcie konta zabiera jego uprawnienia - bez surowego identyfikatora osoby');

SELECT is(
  (SELECT count(*)::int FROM public.billing_documents
    WHERE id = 'e8f00000-0000-0000-0000-0000000000e1'),
  1,
  'dokument rozliczeniowy przeżywa uprawnienie (dowód księgowy zostaje)');

SELECT is(
  (SELECT subscription_id FROM public.billing_documents
    WHERE id = 'e8f00000-0000-0000-0000-0000000000e1'),
  NULL::uuid,
  'dokument odpina się od usuniętego uprawnienia (ON DELETE SET NULL)');

SELECT is(
  (SELECT count(*)::int FROM public.user_subscriptions
    WHERE id = 'e8f00000-0000-0000-0000-0000000000d2'),
  1,
  'uprawnienie innego konta zostaje nietknięte');

SELECT * FROM finish();
ROLLBACK;
