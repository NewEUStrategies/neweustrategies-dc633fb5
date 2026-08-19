-- pgTAP: stany kuponu retencyjnego są rozstrzygane przez kanoniczne RPC
-- validate_b2b_coupon, nie przez atrapę w Vitest.

BEGIN;
SELECT plan(6);

INSERT INTO public.b2b_coupons
  (id, tenant_id, code, name, discount_kind, discount_percent, active,
   max_redemptions, redemptions_count, valid_until)
VALUES
  ('ec000000-0000-0000-0000-000000000001', public.public_tenant_id(),
   'RET-VALID-30', 'Ważny kupon retencyjny', 'percent', 30, true, 3, 0,
   now() + interval '7 days'),
  ('ec000000-0000-0000-0000-000000000002', public.public_tenant_id(),
   'RET-EXPIRED', 'Wygasły kupon retencyjny', 'percent', 30, true, 3, 0,
   now() - interval '1 second'),
  ('ec000000-0000-0000-0000-000000000003', public.public_tenant_id(),
   'RET-USED', 'Wykorzystany kupon retencyjny', 'percent', 30, true, 1, 1,
   now() + interval '7 days');

SELECT is(
  (SELECT ok FROM public.validate_b2b_coupon(' ret-valid-30 ', NULL, 10000, 'PLN')),
  true,
  'ważny kupon przechodzi po normalizacji kodu'
);

SELECT is(
  (SELECT discount_cents FROM public.validate_b2b_coupon('RET-VALID-30', NULL, 10000, 'PLN')),
  3000,
  'ważny kupon nalicza 30 procent rabatu'
);

SELECT is(
  (SELECT final_cents FROM public.validate_b2b_coupon('RET-VALID-30', NULL, 10000, 'PLN')),
  7000,
  'ważny kupon zwraca prawidłową cenę końcową'
);

SELECT is(
  (SELECT error FROM public.validate_b2b_coupon('RET-EXPIRED', NULL, 10000, 'PLN')),
  'expired',
  'kupon po terminie zwraca expired'
);

SELECT is(
  (SELECT error FROM public.validate_b2b_coupon('RET-USED', NULL, 10000, 'PLN')),
  'limit_reached',
  'wykorzystany kupon zwraca limit_reached'
);

SELECT is(
  (SELECT error FROM public.validate_b2b_coupon('RET-MISSING', NULL, 10000, 'PLN')),
  'not_found',
  'nieistniejący kupon zwraca not_found'
);

SELECT * FROM finish();
ROLLBACK;
