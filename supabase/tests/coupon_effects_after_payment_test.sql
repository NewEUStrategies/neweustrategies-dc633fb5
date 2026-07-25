-- pgTAP: efekty kuponu B2B tylko po potwierdzonej płatności (20260725090300).
--
-- Chroni trzy rzeczy naraz:
--   1) FUNKCJA ŻYJE - `grants_tier_key` faktycznie nadaje warstwę (dotąd nikt
--      nie wołał `redeem_b2b_coupon_with_effects`, więc kupon nie robił nic),
--   2) FAIL-CLOSED - zamówienie 'pending' NIE nadaje warstwy (inaczej kod kuponu
--      jest darmowym tokenem premium),
--   3) IDEMPOTENCJA - ponowna dostawa webhooka nie dubluje nadania ani punktów CRM.
--
-- Uruchamianie: patrz supabase/tests/README.md (`supabase test db`).

BEGIN;
SELECT plan(9);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('f1a11111-1111-1111-1111-111111111111', 'cpn-a', 'Coupon Tenant A', 'a.cpn.example');

INSERT INTO auth.users (id, email) VALUES
  ('f0000000-0000-0000-0000-0000000000a1', 'buyer@cpn.test');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('f0000000-0000-0000-0000-0000000000a1', 'buyer@cpn.test', 'Buyer',
   'f1a11111-1111-1111-1111-111111111111');

-- Warstwa docelowa musi istnieć (FK membership_grants -> membership_tiers).
INSERT INTO public.membership_tiers (tenant_id, key, rank, name_pl, name_en) VALUES
  ('f1a11111-1111-1111-1111-111111111111', 'pro-cpn', 50, 'Pro', 'Pro');

-- Kupon nadający warstwę na 90 dni.
INSERT INTO public.b2b_coupons
  (id, tenant_id, code, name, discount_kind, discount_percent, active,
   grants_tier_key, grants_duration_days)
VALUES
  ('f2000000-0000-0000-0000-000000000001', 'f1a11111-1111-1111-1111-111111111111',
   'PRO90', 'Pro na 90 dni', 'percent', 20, true, 'pro-cpn', 90);

-- Dwa zamówienia: jedno nieopłacone, jedno opłacone.
INSERT INTO public.payment_orders
  (id, tenant_id, user_id, kind, status, amount_cents, currency, provider)
VALUES
  ('f3000000-0000-0000-0000-000000000001', 'f1a11111-1111-1111-1111-111111111111',
   'f0000000-0000-0000-0000-0000000000a1', 'subscription', 'pending', 8000, 'PLN', 'stripe'),
  ('f3000000-0000-0000-0000-000000000002', 'f1a11111-1111-1111-1111-111111111111',
   'f0000000-0000-0000-0000-0000000000a1', 'subscription', 'paid', 8000, 'PLN', 'stripe');

INSERT INTO public.b2b_coupon_redemptions
  (tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency)
VALUES
  ('f1a11111-1111-1111-1111-111111111111', 'f2000000-0000-0000-0000-000000000001',
   'f3000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-0000000000a1',
   2000, 10000, 'PLN'),
  ('f1a11111-1111-1111-1111-111111111111', 'f2000000-0000-0000-0000-000000000001',
   'f3000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-0000000000a1',
   2000, 10000, 'PLN');

-- ── 1. Zamówienie NIEOPŁACONE: brak nadania ─────────────────────────────────
SELECT is(
  (SELECT public.apply_b2b_coupon_effects(
     'f3000000-0000-0000-0000-000000000001')->>'reason'),
  'order_not_paid',
  'zamówienie pending: efekty odrzucone (kupon nie jest darmowym tokenem premium)'
);
SELECT is(
  (SELECT count(*)::int FROM public.membership_grants
    WHERE user_id = 'f0000000-0000-0000-0000-0000000000a1'),
  0,
  'zamówienie pending: zero nadań warstwy'
);
SELECT is(
  (SELECT effects_applied_at FROM public.b2b_coupon_redemptions
    WHERE order_id = 'f3000000-0000-0000-0000-000000000001'),
  NULL,
  'zamówienie pending: zatrzask nietknięty (efekty wrócą po płatności)'
);

-- ── 2. Zamówienie OPŁACONE: warstwa nadana ──────────────────────────────────
SELECT is(
  (SELECT (public.apply_b2b_coupon_effects(
     'f3000000-0000-0000-0000-000000000002')->>'tier_granted')::boolean),
  true,
  'zamówienie paid: warstwa z kuponu faktycznie nadana'
);
SELECT is(
  (SELECT source FROM public.membership_grants
    WHERE user_id = 'f0000000-0000-0000-0000-0000000000a1'),
  'coupon',
  'nadanie ma pochodzenie ''coupon'' (nie mylące ''manual'')'
);
SELECT is(
  (SELECT source_coupon_id FROM public.membership_grants
    WHERE user_id = 'f0000000-0000-0000-0000-0000000000a1'),
  'f2000000-0000-0000-0000-000000000001'::uuid,
  'nadanie wskazuje kupon źródłowy'
);
SELECT ok(
  (SELECT expires_at > now() + interval '89 days'
     AND expires_at < now() + interval '91 days'
     FROM public.membership_grants
    WHERE user_id = 'f0000000-0000-0000-0000-0000000000a1'),
  'grants_duration_days przełożone na expires_at (90 dni)'
);

-- ── 3. Ponowna dostawa webhooka: no-op ──────────────────────────────────────
SELECT is(
  (SELECT public.apply_b2b_coupon_effects(
     'f3000000-0000-0000-0000-000000000002')->>'reason'),
  'already_applied',
  'ponowne wywołanie raportuje already_applied (zatrzask effects_applied_at)'
);
SELECT is(
  (SELECT count(*)::int FROM public.membership_grants
    WHERE user_id = 'f0000000-0000-0000-0000-0000000000a1'),
  1,
  'ponowne wywołanie nie dubluje nadania warstwy'
);

SELECT * FROM finish();
ROLLBACK;
