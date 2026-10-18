-- pgTAP: produkcja zasilana WYLACZNIE pasem drizzle - bez triggera
-- `subscriptions_pin_tenant` subskrypcja z webhooka i zdarzenia operatora bez
-- `user_id` laduja w najemcy domyslnym; uzgodnienia 0305
-- (20261007140300_subscriptions_tenant_from_owner) i 0306
-- (20261018100000_payment_webhook_events_follow_subscription_tenant), w tej
-- kolejnosci, przepinaja je do najemcy PROFILU wlasciciela.
--
-- UWAGA: oba UPDATE-y ponizej sa kopia cial migracji (bez komentarzy). Zmiana
-- uzgodnienia w migracji wymaga tej samej zmiany tutaj - inaczej test
-- sprawdza nieaktualna regule.
BEGIN;
SELECT plan(11);

ALTER TABLE auth.users DISABLE TRIGGER USER;

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('5c0b0000-0000-0000-0000-0000000000bb', 'pwe-follow-b', 'PWE Follow B', 'pwe-follow-b.example'),
  ('5c0c0000-0000-0000-0000-0000000000cc', 'pwe-follow-c', 'PWE Follow C', 'pwe-follow-c.example');
INSERT INTO auth.users (id, email) VALUES
  ('5c000000-0000-0000-0000-0000000000b1', 'pwe-follow-b1@example.org'),
  ('5c000000-0000-0000-0000-0000000000d1', 'pwe-follow-d1@example.org');
INSERT INTO public.profiles (id, email, display_name, tenant_id) VALUES
  ('5c000000-0000-0000-0000-0000000000b1', 'pwe-follow-b1@example.org', 'PWE Follow B1',
   '5c0b0000-0000-0000-0000-0000000000bb'),
  -- Konto D placi, gdy stoi w najemcy domyslnym; potem przenosza je do B.
  ('5c000000-0000-0000-0000-0000000000d1', 'pwe-follow-d1@example.org', 'PWE Follow D1',
   public.email_default_tenant_id());

-- Stan pasa drizzle sprzed 0305: triggera nie ma (DROP wycofa ROLLBACK).
DROP TRIGGER subscriptions_pin_tenant ON public.subscriptions;

-- Zapis jak webhook sprzed poprawki: rola serwisowa, bez naglowka hosta,
-- bez tenant_id.
SELECT set_config('request.headers', '', true);
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SET LOCAL ROLE service_role;
INSERT INTO public.subscriptions
  (user_id, provider_subscription_id, provider_customer_id, product_id, price_id, status, environment)
VALUES
  ('5c000000-0000-0000-0000-0000000000b1', 'sub_pwe_follow_1', 'cus_pwe_follow_1',
   'prod_x', 'price_x', 'active', 'live'),
  ('5c000000-0000-0000-0000-0000000000d1', 'sub_pwe_moved_d', 'cus_pwe_moved_d',
   'prod_x', 'price_x', 'active', 'live');
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

SELECT is(
  (SELECT tenant_id FROM public.subscriptions WHERE provider_subscription_id = 'sub_pwe_follow_1'),
  public.email_default_tenant_id(),
  'DEFEKT: bez triggera subskrypcja konta z najemcy B trafia do najemcy domyslnego');

-- Zdarzenia operatora: faktura (po subskrypcji), obciazenie (po kliencie),
-- zdarzenie z platnikiem (po profilu), szum bez nosnikow, zdarzenie juz
-- rozstrzygniete gdzie indziej.
INSERT INTO public.payment_webhook_events
  (id, event_id, event_type, environment, subscription_id, customer_id, user_id, payload)
VALUES
  ('5c0e0000-0000-0000-0000-000000000001', 'evt_pwe_invoice', 'invoice.paid', 'live',
   'sub_pwe_follow_1', NULL, NULL, '{}'),
  ('5c0e0000-0000-0000-0000-000000000002', 'evt_pwe_charge', 'charge.refunded', 'live',
   NULL, 'cus_pwe_follow_1', NULL, '{}'),
  ('5c0e0000-0000-0000-0000-000000000003', 'evt_pwe_user', 'subscription.created', 'live',
   'sub_pwe_follow_1', 'cus_pwe_follow_1', '5c000000-0000-0000-0000-0000000000b1', '{}'),
  ('5c0e0000-0000-0000-0000-000000000004', 'evt_pwe_ping', 'ping', 'live',
   NULL, NULL, NULL, '{}'),
  ('5c0e0000-0000-0000-0000-000000000005', 'evt_pwe_elsewhere', 'invoice.paid', 'live',
   'sub_pwe_follow_1', NULL, NULL, '{}');
-- Platnosc konta D, gdy stalo w najemcy domyslnym: oba zdarzenia slusznie tam.
INSERT INTO public.payment_webhook_events
  (id, event_id, event_type, environment, subscription_id, customer_id, user_id, payload)
VALUES
  ('5c0e0000-0000-0000-0000-0000000000d1', 'evt_pwe_d_user', 'subscription.created', 'live',
   'sub_pwe_moved_d', 'cus_pwe_moved_d', '5c000000-0000-0000-0000-0000000000d1', '{}'),
  ('5c0e0000-0000-0000-0000-0000000000d2', 'evt_pwe_d_invoice', 'invoice.paid', 'live',
   'sub_pwe_moved_d', NULL, NULL, '{}');
-- Przeniesienie konta D do najemcy B rola serwisowa (repin konta celowo
-- pomija platnosci).
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
UPDATE public.profiles
   SET tenant_id = '5c0b0000-0000-0000-0000-0000000000bb'
 WHERE id = '5c000000-0000-0000-0000-0000000000d1';
SELECT set_config('request.jwt.claims', '', true);
-- Wiersz rozstrzygniety kiedys w najemcy C: UPDATE OF tenant_id nie odpala
-- triggera wiazania, wiec stoi tam, gdzie go postawiono.
UPDATE public.payment_webhook_events
   SET tenant_id = '5c0c0000-0000-0000-0000-0000000000cc'
 WHERE id = '5c0e0000-0000-0000-0000-000000000005';

SELECT is(
  (SELECT array_agg(tenant_id = public.email_default_tenant_id() ORDER BY event_id)
     FROM public.payment_webhook_events
    WHERE id IN ('5c0e0000-0000-0000-0000-000000000001', '5c0e0000-0000-0000-0000-000000000002')),
  ARRAY[true, true],
  'DEFEKT: faktura i obciazenie bez platnika ida za subskrypcja do najemcy domyslnego');

SELECT is(
  (SELECT tenant_id FROM public.payment_webhook_events WHERE id = '5c0e0000-0000-0000-0000-000000000003'),
  '5c0b0000-0000-0000-0000-0000000000bb'::uuid,
  'zdarzenie z platnikiem rozstrzyga profil - od poczatku w najemcy B');

-- 0305: uzgodnienie subskrypcji (kopia z 20261007140300).
UPDATE public.subscriptions s
   SET tenant_id = p.tenant_id
  FROM public.profiles p
 WHERE p.id = s.user_id
   AND p.tenant_id IS NOT NULL
   AND s.tenant_id IS DISTINCT FROM p.tenant_id;

SELECT is(
  (SELECT tenant_id FROM public.subscriptions WHERE provider_subscription_id = 'sub_pwe_follow_1'),
  '5c0b0000-0000-0000-0000-0000000000bb'::uuid,
  '0305: subskrypcja wraca do najemcy profilu wlasciciela');

SELECT is(
  (SELECT tenant_id FROM public.payment_webhook_events WHERE id = '5c0e0000-0000-0000-0000-000000000001'),
  public.email_default_tenant_id(),
  'samo 0305 nie rusza zdarzen - trigger wiazania nie odpala na zmiane subskrypcji');

-- 0306: zdarzenia puli domyslnej rozstrzygane od nowa (kopia z 20261018100000).
WITH resolved AS (
  SELECT
    e.id,
    public.payment_webhook_event_tenant(
      e.user_id, e.customer_id, e.subscription_id, e.environment, e.payload
    ) AS tenant_id
  FROM public.payment_webhook_events e
  WHERE e.tenant_id = public.email_default_tenant_id()
)
UPDATE public.payment_webhook_events e
   SET tenant_id = r.tenant_id
  FROM resolved r
 WHERE r.id = e.id
   AND r.tenant_id IS NOT NULL
   AND r.tenant_id IS DISTINCT FROM e.tenant_id;

SELECT is(
  (SELECT array_agg(tenant_id ORDER BY event_id)
     FROM public.payment_webhook_events
    WHERE id IN ('5c0e0000-0000-0000-0000-000000000001', '5c0e0000-0000-0000-0000-000000000002')),
  ARRAY['5c0b0000-0000-0000-0000-0000000000bb', '5c0b0000-0000-0000-0000-0000000000bb']::uuid[],
  '0306: faktura (po subskrypcji) i obciazenie (po kliencie) ida za przepieta subskrypcja');

SELECT is(
  (SELECT tenant_id FROM public.payment_webhook_events WHERE id = '5c0e0000-0000-0000-0000-000000000004'),
  public.email_default_tenant_id(),
  '0306: zdarzenie bez nosnikow zostaje w puli domyslnej');

SELECT is(
  (SELECT tenant_id FROM public.payment_webhook_events WHERE id = '5c0e0000-0000-0000-0000-000000000005'),
  '5c0c0000-0000-0000-0000-0000000000cc'::uuid,
  '0306: wiersz spoza puli domyslnej nie jest ruszany');

SELECT is(
  (SELECT tenant_id FROM public.payment_webhook_events WHERE id = '5c0e0000-0000-0000-0000-000000000003'),
  '5c0b0000-0000-0000-0000-0000000000bb'::uuid,
  '0306: zdarzenie z platnikiem bez zmian');

SELECT is(
  ARRAY[
    (SELECT tenant_id FROM public.subscriptions WHERE provider_subscription_id = 'sub_pwe_moved_d'),
    (SELECT tenant_id FROM public.payment_webhook_events WHERE id = '5c0e0000-0000-0000-0000-0000000000d1'),
    (SELECT tenant_id FROM public.payment_webhook_events WHERE id = '5c0e0000-0000-0000-0000-0000000000d2')
  ],
  ARRAY['5c0b0000-0000-0000-0000-0000000000bb', '5c0b0000-0000-0000-0000-0000000000bb',
        '5c0b0000-0000-0000-0000-0000000000bb']::uuid[],
  'konto przeniesione z najemcy domyslnego: subskrypcja i CALA jej historia ida za biezacym profilem razem, bez rozdzielenia zakupu');

-- Idempotencja: drugi przebieg nie znajduje juz nic do przepiecia.
WITH resolved AS (
  SELECT
    e.id,
    public.payment_webhook_event_tenant(
      e.user_id, e.customer_id, e.subscription_id, e.environment, e.payload
    ) AS tenant_id
  FROM public.payment_webhook_events e
  WHERE e.tenant_id = public.email_default_tenant_id()
), moved AS (
  UPDATE public.payment_webhook_events e
     SET tenant_id = r.tenant_id
    FROM resolved r
   WHERE r.id = e.id
     AND r.tenant_id IS NOT NULL
     AND r.tenant_id IS DISTINCT FROM e.tenant_id
  RETURNING e.id
)
SELECT is(count(*)::int, 0, '0306 jest idempotentna: drugi przebieg niczego nie przepina')
  FROM moved;

SELECT * FROM finish();
ROLLBACK;
