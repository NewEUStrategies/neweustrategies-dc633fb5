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
-- najemcy - nie; wrapper z JWT ma te same warunki. Klient wolajacy funkcje
-- wprost (scenariusz naduzycia) dostaje 42501; kazdy status zamowienia ma
-- przypisany werdykt, a powtorka (webhook ponowiony) niczego nie zmienia.
--
-- Status zamowienia jest czytany pod blokada wiersza (20261018120000):
-- rozliczenie platnosci nie wejdzie miedzy odczyt a usuniecie realizacji.
--
-- PAS PRODUKCYJNY. Ten plik buduje baze z supabase/migrations; na produkcje
-- poprawki jada bliznakami drizzle/migrations/0305_release_coupon_server_only
-- i 0306_release_coupon_order_lock (ten sam SQL wykonywalny - pilnuje
-- `check:migration-lanes`, REQUIRED_PRODUCTION_TWINS w
-- src/lib/ci/migrationLaneParity.ts).
BEGIN;
SELECT plan(25);

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

-- ── 15-16. Klient wprost: scenariusz naduzycia konczy sie 42501 ───────────
-- Przed poprawka: czlonek po oplaceniu zamowienia jednorazowym kodem wolal
-- `rpc/release_b2b_coupon(kod, wlasne_zamowienie)` i licznik spadal 1 -> 0.
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$SELECT public.release_b2b_coupon('c4300000-0000-0000-0000-000000000001',
    'c4600000-0000-0000-0000-0000000000f1')$$,
  '42501', NULL,
  'authenticated: release_b2b_coupon na wlasnym OPLACONYM zamowieniu - permission denied');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok(
  $$SELECT public.release_b2b_coupon('c4300000-0000-0000-0000-000000000001',
    'c4600000-0000-0000-0000-0000000000f1')$$,
  '42501', NULL,
  'anon: release_b2b_coupon - permission denied (bylo: domyslne EXECUTE dla anon)');
RESET ROLE;

-- ── 17-24. Werdykt dla kazdego statusu i powtorka ──────────────────────────
-- processing (kasa w toku u operatora) i refunded zachowuja realizacje;
-- pending i canceled ja oddaja - takze canceled z paid_at, czyli bilet za
-- zero anulowany przy pelnej sali (`refundOversold`) po zaksiegowaniu.
INSERT INTO public.payment_orders (id, tenant_id, user_id, kind, status, amount_cents, currency, paid_at) VALUES
  ('c4600000-0000-0000-0000-0000000000f4', 'c40a0000-0000-0000-0000-0000000000aa',
   'c4000000-0000-0000-0000-0000000000a1', 'subscription', 'processing', 0, 'PLN', NULL),
  ('c4600000-0000-0000-0000-0000000000f5', 'c40a0000-0000-0000-0000-0000000000aa',
   'c4000000-0000-0000-0000-0000000000a1', 'subscription', 'refunded', 0, 'PLN', now()),
  ('c4600000-0000-0000-0000-0000000000f6', 'c40a0000-0000-0000-0000-0000000000aa',
   'c4000000-0000-0000-0000-0000000000a1', 'subscription', 'pending', 0, 'PLN', NULL),
  ('c4600000-0000-0000-0000-0000000000f7', 'c40a0000-0000-0000-0000-0000000000aa',
   'c4000000-0000-0000-0000-0000000000a1', 'subscription', 'canceled', 0, 'PLN', now());
INSERT INTO public.b2b_coupon_redemptions
  (tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency)
SELECT 'c40a0000-0000-0000-0000-0000000000aa', 'c4300000-0000-0000-0000-000000000001',
       o, 'c4000000-0000-0000-0000-0000000000a1', 4900, 4900, 'PLN'
  FROM unnest(ARRAY['c4600000-0000-0000-0000-0000000000f4',
                    'c4600000-0000-0000-0000-0000000000f5',
                    'c4600000-0000-0000-0000-0000000000f6',
                    'c4600000-0000-0000-0000-0000000000f7']::uuid[]) AS o;
UPDATE public.b2b_coupons SET redemptions_count = 10 WHERE id = 'c4300000-0000-0000-0000-000000000001';

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
SELECT is(
  public.release_b2b_coupon_for_user('c40a0000-0000-0000-0000-0000000000aa',
    'c4000000-0000-0000-0000-0000000000a1', 'c4300000-0000-0000-0000-000000000001',
    'c4600000-0000-0000-0000-0000000000f4'),
  false, 'PROCESSING (platnosc w toku u operatora): odmowa');
SELECT is(
  public.release_b2b_coupon_for_user('c40a0000-0000-0000-0000-0000000000aa',
    'c4000000-0000-0000-0000-0000000000a1', 'c4300000-0000-0000-0000-000000000001',
    'c4600000-0000-0000-0000-0000000000f5'),
  false, 'REFUNDED (rabat juz wykorzystany): odmowa');
SELECT is(
  public.release_b2b_coupon_for_user('c40a0000-0000-0000-0000-0000000000aa',
    'c4000000-0000-0000-0000-0000000000a1', 'c4300000-0000-0000-0000-000000000001',
    'c4600000-0000-0000-0000-0000000000f6'),
  true, 'PENDING (odmowa dostawcy przed sesja): zwolnienie przechodzi');
SELECT is(
  public.release_b2b_coupon_for_user('c40a0000-0000-0000-0000-0000000000aa',
    'c4000000-0000-0000-0000-0000000000a1', 'c4300000-0000-0000-0000-000000000001',
    'c4600000-0000-0000-0000-0000000000f7'),
  true, 'CANCELED z paid_at (bilet za zero przy pelnej sali): zwolnienie przechodzi');
RESET ROLE;
SELECT is(
  (SELECT redemptions_count FROM public.b2b_coupons WHERE id = 'c4300000-0000-0000-0000-000000000001'),
  8, 'licznik spada wylacznie o dwa oddane uzycia');
SET LOCAL ROLE service_role;
SELECT is(
  public.release_b2b_coupon_for_user('c40a0000-0000-0000-0000-0000000000aa',
    'c4000000-0000-0000-0000-0000000000a1', 'c4300000-0000-0000-0000-000000000001',
    'c4600000-0000-0000-0000-0000000000f6'),
  false, 'powtorka (webhook ponowiony): false, bez drugiego zwolnienia');
RESET ROLE;
SELECT is(
  (SELECT redemptions_count FROM public.b2b_coupons WHERE id = 'c4300000-0000-0000-0000-000000000001'),
  8, 'powtorka nie zmienia licznika');
SELECT is(
  (SELECT array_agg(order_id ORDER BY order_id) FROM public.b2b_coupon_redemptions
    WHERE coupon_id = 'c4300000-0000-0000-0000-000000000001'),
  ARRAY['c4600000-0000-0000-0000-0000000000f1', 'c4600000-0000-0000-0000-0000000000f3',
        'c4600000-0000-0000-0000-0000000000f4', 'c4600000-0000-0000-0000-0000000000f5']::uuid[],
  'zostaja: oplacone, cudze, w toku i zwrocone - zadne inne wiersze nie znikaja');

-- ── 25. Status zamowienia pod blokada wiersza ──────────────────────────────
-- Bez blokady: zwolnienie widzi `failed`, webhook przestawia na `paid`,
-- `apply_b2b_coupon_effects` nadaje efekty kodu, a zwolnienie i tak usuwa
-- realizacje - kod jednorazowy znow wazny po skorzystaniu z efektow.
-- Wspolbieznosci pgTAP nie odtworzy w jednej sesji, wiec przypinamy ksztalt:
-- odczyt `payment_orders` w rdzeniu idzie z FOR SHARE (dowod dwiema sesjami -
-- opis PR #522).
SELECT ok(
  pg_get_functiondef('public._release_b2b_coupon(uuid,uuid,uuid,uuid)'::regprocedure)
    ~* 'FROM\s+public\.payment_orders[^;]*FOR\s+SHARE',
  'rdzen _release_b2b_coupon czyta status zamowienia pod blokada wiersza (FOR SHARE)');

SELECT set_config('request.jwt.claims', '', true);
SELECT * FROM finish();
ROLLBACK;
