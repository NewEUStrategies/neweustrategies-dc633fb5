-- pgTAP: zwolnienie uzycia kodu tylko z serwera i tylko dla nieoplaconego
-- zamowienia tego konta (migracja 20261007140200_release_coupon_server_only).
--
-- DEFEKT. `release_b2b_coupon` byl wykonywalny dla authenticated (i anon) bez
-- sprawdzenia wlasciciela i statusu zamowienia: czlonek po oplaceniu zamowienia
-- z jednorazowym kodem zwalnial wlasna realizacje i kod byl znow wazny - bez
-- konca, z resetem limitu na osobe i licznika kampanii.
--
-- CO PRZYPINA: ACL (tylko service_role na *_for_user i na wrapperze), zwolnienie
-- wlasnego nieoplaconego zamowienia oddaje uzycie, a oplacone, cudze i z innego
-- najemcy - nie; wrapper z JWT ma te same warunki.
BEGIN;
SELECT plan(14);

ALTER TABLE auth.users DISABLE TRIGGER USER;
ALTER TABLE public.payment_orders DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('c40a0000-0000-0000-0000-0000000000aa', 'coupon-rel-a', 'Coupon Release A', 'coupon-rel-a.example'),
  ('c40b0000-0000-0000-0000-0000000000bb', 'coupon-rel-b', 'Coupon Release B', 'coupon-rel-b.example');

INSERT INTO auth.users (id, email) VALUES
  ('c4000000-0000-0000-0000-0000000000a1', 'coupon-rel-buyer@example.org'),
  ('c4000000-0000-0000-0000-0000000000a2', 'coupon-rel-other@example.org');

-- Kod jednorazowy (max_redemptions = 1, max_redemptions_per_user = 1).
INSERT INTO public.b2b_coupons
  (id, tenant_id, code, name, discount_kind, discount_percent, active,
   max_redemptions, max_redemptions_per_user, redemptions_count) VALUES
  ('c4300000-0000-0000-0000-000000000001', 'c40a0000-0000-0000-0000-0000000000aa',
   'REL-ONCE', 'Release once', 'percent', 100, true, 1, 1, 0);

-- Zamowienia kupujacego: oplacone i nieudane; nieudane zamowienie innego konta.
INSERT INTO public.payment_orders (id, tenant_id, user_id, kind, status, amount_cents, currency) VALUES
  ('c4600000-0000-0000-0000-0000000000f1', 'c40a0000-0000-0000-0000-0000000000aa',
   'c4000000-0000-0000-0000-0000000000a1', 'subscription', 'paid', 0, 'PLN'),
  ('c4600000-0000-0000-0000-0000000000f2', 'c40a0000-0000-0000-0000-0000000000aa',
   'c4000000-0000-0000-0000-0000000000a1', 'subscription', 'failed', 0, 'PLN'),
  ('c4600000-0000-0000-0000-0000000000f3', 'c40a0000-0000-0000-0000-0000000000aa',
   'c4000000-0000-0000-0000-0000000000a2', 'subscription', 'failed', 0, 'PLN');

-- Realizacja na OPLACONYM zamowieniu (licznik 1 = kod wyczerpany).
INSERT INTO public.b2b_coupon_redemptions
  (tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency) VALUES
  ('c40a0000-0000-0000-0000-0000000000aa', 'c4300000-0000-0000-0000-000000000001',
   'c4600000-0000-0000-0000-0000000000f1', 'c4000000-0000-0000-0000-0000000000a1', 4900, 4900, 'PLN');
UPDATE public.b2b_coupons SET redemptions_count = 1 WHERE id = 'c4300000-0000-0000-0000-000000000001';

-- ── 1-4. Uprawnienia ────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.release_b2b_coupon(uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.release_b2b_coupon(uuid,uuid)', 'EXECUTE'),
  'release_b2b_coupon: ani anon, ani authenticated (bylo: GRANT authenticated + domyslne anon)');
SELECT ok(
  NOT has_function_privilege('anon', 'public.release_b2b_coupon_for_user(uuid,uuid,uuid,uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.release_b2b_coupon_for_user(uuid,uuid,uuid,uuid)', 'EXECUTE'),
  'release_b2b_coupon_for_user: bez EXECUTE dla klienta');
SELECT ok(has_function_privilege('service_role', 'public.release_b2b_coupon_for_user(uuid,uuid,uuid,uuid)', 'EXECUTE'),
  'release_b2b_coupon_for_user: service_role (kasa po odmowie dostawcy)');
SELECT ok(
  NOT has_function_privilege('authenticated', 'public._release_b2b_coupon(uuid,uuid,uuid,uuid)', 'EXECUTE'),
  'rdzen _release_b2b_coupon niedostepny dla klienta');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;

-- ── 5-7. Oplacone zamowienie zachowuje realizacje ──────────────────────────
SELECT is(
  public.release_b2b_coupon_for_user('c40a0000-0000-0000-0000-0000000000aa',
    'c4000000-0000-0000-0000-0000000000a1', 'c4300000-0000-0000-0000-000000000001',
    'c4600000-0000-0000-0000-0000000000f1'),
  false,
  'OPLACONE zamowienie: zwolnienie odmowione (sedno defektu - reset limitu po skorzystaniu z rabatu)');
SELECT is(
  (SELECT redemptions_count FROM public.b2b_coupons WHERE id = 'c4300000-0000-0000-0000-000000000001'),
  1, 'licznik kampanii nietkniety');
SELECT is(
  (SELECT count(*)::int FROM public.b2b_coupon_redemptions
    WHERE coupon_id = 'c4300000-0000-0000-0000-000000000001'),
  1, 'wiersz realizacji zostaje (limit na osobe nadal dziala)');
RESET ROLE;

-- ── 8-9. Cudze zamowienie i obcy najemca ───────────────────────────────────
INSERT INTO public.b2b_coupon_redemptions
  (tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency) VALUES
  ('c40a0000-0000-0000-0000-0000000000aa', 'c4300000-0000-0000-0000-000000000001',
   'c4600000-0000-0000-0000-0000000000f3', 'c4000000-0000-0000-0000-0000000000a2', 4900, 4900, 'PLN');
SET LOCAL ROLE service_role;
SELECT is(
  public.release_b2b_coupon_for_user('c40a0000-0000-0000-0000-0000000000aa',
    'c4000000-0000-0000-0000-0000000000a1', 'c4300000-0000-0000-0000-000000000001',
    'c4600000-0000-0000-0000-0000000000f3'),
  false,
  'CUDZE zamowienie (nieudane, ale innego konta): odmowa');
SELECT is(
  public.release_b2b_coupon_for_user('c40b0000-0000-0000-0000-0000000000bb',
    'c4000000-0000-0000-0000-0000000000a2', 'c4300000-0000-0000-0000-000000000001',
    'c4600000-0000-0000-0000-0000000000f3'),
  false,
  'najemca inny niz najemca zamowienia: odmowa');
RESET ROLE;

-- ── 10-12. Wlasne nieudane zamowienie: uzycie wraca do puli ────────────────
INSERT INTO public.b2b_coupon_redemptions
  (tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency) VALUES
  ('c40a0000-0000-0000-0000-0000000000aa', 'c4300000-0000-0000-0000-000000000001',
   'c4600000-0000-0000-0000-0000000000f2', 'c4000000-0000-0000-0000-0000000000a1', 4900, 4900, 'PLN');
UPDATE public.b2b_coupons SET redemptions_count = 3 WHERE id = 'c4300000-0000-0000-0000-000000000001';
SET LOCAL ROLE service_role;
SELECT is(
  public.release_b2b_coupon_for_user('c40a0000-0000-0000-0000-0000000000aa',
    'c4000000-0000-0000-0000-0000000000a1', 'c4300000-0000-0000-0000-000000000001',
    'c4600000-0000-0000-0000-0000000000f2'),
  true,
  'wlasne NIEUDANE zamowienie: zwolnienie przechodzi (kasa po odmowie dostawcy)');
RESET ROLE;
SELECT is(
  (SELECT redemptions_count FROM public.b2b_coupons WHERE id = 'c4300000-0000-0000-0000-000000000001'),
  2, 'licznik spada dokladnie o zwolnione uzycie');
SELECT is(
  (SELECT count(*)::int FROM public.b2b_coupon_redemptions
    WHERE order_id = 'c4600000-0000-0000-0000-0000000000f2'),
  0, 'usuniety wylacznie wiersz tego zamowienia');

-- ── 13-14. Wrapper z JWT: te same warunki ─────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"c4000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE service_role;
SELECT is(
  public.release_b2b_coupon('c4300000-0000-0000-0000-000000000001',
    'c4600000-0000-0000-0000-0000000000f1'),
  false,
  'wrapper: oplacone zamowienie wolajacego - odmowa');
RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.b2b_coupon_redemptions
    WHERE order_id = 'c4600000-0000-0000-0000-0000000000f1'),
  1, 'wrapper niczego nie usunal');

SELECT set_config('request.jwt.claims', '', true);
SELECT * FROM finish();
ROLLBACK;
