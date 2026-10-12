-- pgTAP: pułap kwoty zamówienia planu za miejsce
-- (migracja 20261012130400_payment_orders_per_seat_plan_amount, audyt PAY-01).
--
-- Kasa liczy kwotę zamówienia z wiersza planu RAZEM z liczbą miejsc. Strażnik
-- wstawienia porównywał ją z ceną jednego miejsca, więc zamówienie Zespołu na
-- dwa miejsca kończyło się wyjątkiem zamiast wyceną. Test przypina obie
-- strony: plan za miejsce przyjmuje do 100 miejsc, a każdy inny plan dalej
-- odrzuca kwotę wyższą od swojej ceny.
BEGIN;
SELECT plan(4);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('5ea70000-0000-0000-0000-0000000000aa', 'seat-cap', 'Seat Cap', 'seat-cap.example');
INSERT INTO auth.users (id, email) VALUES
  ('5ea70000-0000-0000-0000-0000000000b1', 'seat-buyer@example.org');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('5ea70000-0000-0000-0000-0000000000b1', 'seat-buyer@example.org', 'Seat Buyer',
   '5ea70000-0000-0000-0000-0000000000aa');

INSERT INTO public.access_plans
  (id, tenant_id, name_pl, name_en, price_cents, currency, interval, tier_key, active)
VALUES
  ('5ea70000-0000-0000-0000-0000000000c1', '5ea70000-0000-0000-0000-0000000000aa',
   'Zespół', 'Team', 9900, 'PLN', 'month', 'team', true),
  ('5ea70000-0000-0000-0000-0000000000c2', '5ea70000-0000-0000-0000-0000000000aa',
   'Pro', 'Pro', 4900, 'PLN', 'month', 'pro', true);

-- Wstawienie jak z kasy: konto kupującego z JWT, bez roli serwisowej - tylko
-- wtedy strażnik w ogóle sprawdza kwotę.
SELECT set_config('request.jwt.claims',
  '{"sub":"5ea70000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SELECT set_config('request.jwt.claim.sub', '5ea70000-0000-0000-0000-0000000000b1', true);

SELECT lives_ok(
  $$INSERT INTO public.payment_orders
      (tenant_id, user_id, kind, status, amount_cents, currency, plan_id, provider)
    VALUES ('5ea70000-0000-0000-0000-0000000000aa', '5ea70000-0000-0000-0000-0000000000b1',
      'subscription', 'pending', 5 * 9900, 'PLN', '5ea70000-0000-0000-0000-0000000000c1', 'stripe')$$,
  'Zespół na 5 miejsc: kwota = 5 x cena miejsca przechodzi');

SELECT throws_ok(
  $$INSERT INTO public.payment_orders
      (tenant_id, user_id, kind, status, amount_cents, currency, plan_id, provider)
    VALUES ('5ea70000-0000-0000-0000-0000000000aa', '5ea70000-0000-0000-0000-0000000000b1',
      'subscription', 'pending', 101 * 9900, 'PLN', '5ea70000-0000-0000-0000-0000000000c1', 'stripe')$$,
  'P0001', 'payment_orders.amount_cents exceeds plan price',
  'Zespół ponad 100 miejsc: odmowa (pułap = limit miejsc kasy)');

SELECT throws_ok(
  $$INSERT INTO public.payment_orders
      (tenant_id, user_id, kind, status, amount_cents, currency, plan_id, provider)
    VALUES ('5ea70000-0000-0000-0000-0000000000aa', '5ea70000-0000-0000-0000-0000000000b1',
      'subscription', 'pending', 2 * 4900, 'PLN', '5ea70000-0000-0000-0000-0000000000c2', 'stripe')$$,
  'P0001', 'payment_orders.amount_cents exceeds plan price',
  'plan NIE za miejsce: kwota wyższa od ceny dalej jest odrzucana');

SELECT lives_ok(
  $$INSERT INTO public.payment_orders
      (tenant_id, user_id, kind, status, amount_cents, currency, plan_id, provider)
    VALUES ('5ea70000-0000-0000-0000-0000000000aa', '5ea70000-0000-0000-0000-0000000000b1',
      'subscription', 'pending', 3900, 'PLN', '5ea70000-0000-0000-0000-0000000000c2', 'stripe')$$,
  'plan NIE za miejsce: kwota po kuponie (niższa od ceny) przechodzi');

SELECT * FROM finish();
ROLLBACK;
