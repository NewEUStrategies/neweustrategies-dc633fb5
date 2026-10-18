-- pgTAP: strażnik zamówień - plan poza sprzedażą
-- (migracja 20261018160400_payment_orders_for_sale_guard, cennik v6.2).
--
-- Drugi zamek decyzji 3 (Partner Biznesowy wycofany ze sprzedaży) i 5
-- (Decision Lab wyłącznie na zapytanie). Pierwszy - `planPurchaseRefusal`
-- w obu kasach - odmawia przed kuponem; ten łapie wstawienie zamówienia
-- z konta użytkownika, które ominęłoby serwer aplikacji (PostgREST wprost).
-- Test przypina też, że reszta ciała strażnika (pułap za miejsce, PAY-01)
-- przeżyła ponowne CREATE OR REPLACE, a rola serwisowa nadal go omija.
BEGIN;
SELECT plan(5);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('f0a50000-0000-4000-8000-0000000000aa', 'for-sale-guard', 'For Sale Guard', 'for-sale.example');
INSERT INTO auth.users (id, email) VALUES
  ('f0a50000-0000-4000-8000-0000000000b1', 'for-sale-buyer@example.org');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('f0a50000-0000-4000-8000-0000000000b1', 'for-sale-buyer@example.org', 'For Sale Buyer',
   'f0a50000-0000-4000-8000-0000000000aa');

INSERT INTO public.access_plans
  (id, tenant_id, name_pl, name_en, price_cents, currency, interval, tier_key, active, for_sale)
VALUES
  ('f0a50000-0000-4000-8000-0000000000c1', 'f0a50000-0000-4000-8000-0000000000aa',
   'Partner Biznesowy', 'Business Partner', 99000, 'PLN', 'month', 'business', true, false),
  ('f0a50000-0000-4000-8000-0000000000c2', 'f0a50000-0000-4000-8000-0000000000aa',
   'Zespół', 'Team', 8900, 'PLN', 'month', 'team', true, true);

-- Plan Decision Labu założył seed najemcy (`seed_decision_lab_product`):
-- aktywny, `for_sale = false`.
SELECT set_config('request.jwt.claims',
  '{"sub":"f0a50000-0000-4000-8000-0000000000b1","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', 'f0a50000-0000-4000-8000-0000000000b1', true);

SELECT throws_like(
  $$INSERT INTO public.payment_orders
      (tenant_id, user_id, kind, status, amount_cents, currency, plan_id, provider)
    VALUES ('f0a50000-0000-4000-8000-0000000000aa', 'f0a50000-0000-4000-8000-0000000000b1',
      'subscription', 'pending', 99000, 'PLN', 'f0a50000-0000-4000-8000-0000000000c1', 'stripe')$$,
  '%plan_not_for_sale%',
  'Partner Biznesowy (wycofany ze sprzedaży): nowe zamówienie z konta użytkownika odrzucone'
);

SELECT throws_like(
  format(
    $$INSERT INTO public.payment_orders
        (tenant_id, user_id, kind, status, amount_cents, currency, plan_id, provider)
      VALUES ('f0a50000-0000-4000-8000-0000000000aa', 'f0a50000-0000-4000-8000-0000000000b1',
        'one_time', 'pending', 1600000, 'PLN', %L, 'stripe')$$,
    (SELECT id FROM public.access_plans
      WHERE tenant_id = 'f0a50000-0000-4000-8000-0000000000aa' AND tier_key = 'decision_lab')
  ),
  '%plan_not_for_sale%',
  'Decision Lab (na zapytanie): zakup bezpośrednim zamówieniem odrzucony'
);

SELECT lives_ok(
  $$INSERT INTO public.payment_orders
      (tenant_id, user_id, kind, status, amount_cents, currency, plan_id, provider)
    VALUES ('f0a50000-0000-4000-8000-0000000000aa', 'f0a50000-0000-4000-8000-0000000000b1',
      'subscription', 'pending', 5 * 8900, 'PLN', 'f0a50000-0000-4000-8000-0000000000c2', 'stripe')$$,
  'plan w sprzedaży (Zespół, 5 miejsc po 89 zł) przechodzi'
);

SELECT throws_ok(
  $$INSERT INTO public.payment_orders
      (tenant_id, user_id, kind, status, amount_cents, currency, plan_id, provider)
    VALUES ('f0a50000-0000-4000-8000-0000000000aa', 'f0a50000-0000-4000-8000-0000000000b1',
      'subscription', 'pending', 101 * 8900, 'PLN', 'f0a50000-0000-4000-8000-0000000000c2', 'stripe')$$,
  'P0001', 'payment_orders.amount_cents exceeds plan price',
  'PAY-01 zostaje: pułap planu za miejsce = 100 miejsc'
);

-- Rola serwisowa (webhook, narzędzia admina) omija strażnika jak dotąd.
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT lives_ok(
  $$INSERT INTO public.payment_orders
      (tenant_id, user_id, kind, status, amount_cents, currency, plan_id, provider)
    VALUES ('f0a50000-0000-4000-8000-0000000000aa', 'f0a50000-0000-4000-8000-0000000000b1',
      'subscription', 'pending', 99000, 'PLN', 'f0a50000-0000-4000-8000-0000000000c1', 'stripe')$$,
  'service_role omija strażnika (zamówienie poza sprzedażą z narzędzi serwerowych)'
);

SELECT * FROM finish();
ROLLBACK;
