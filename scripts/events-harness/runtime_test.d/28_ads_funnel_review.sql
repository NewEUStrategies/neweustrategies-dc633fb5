-- ============================================================================
-- 28_ads_funnel_review - LEJEK GOOGLE ADS: POPRAWKI PO PRZEGLADZIE
--
-- PO CO TEN PLIK ISTNIEJE
-- Migracja 20260927001100 poprawia liczby i zgode lejka z 20260927000300.
-- Kazda poprawka dotyczy danych, ktorych 28_ads_funnel.sql nie seeduje
-- (pakiety, pula planu, zwrot reczny, zamowienia gosci, cofnieta zgoda,
-- 60 kampanii z beaconu), wiec ma wlasne wydarzenia i wlasne asercje.
--
-- CZEGO TU DOWODZIMY
--   (a) `event_package_order_attribution_attach`: zapis raz, tylko wlasne
--       zamowienie, "za pozno", klikniecie bez zgody zdjete, granty;
--   (b) raport: pakiet jako konwersja (oplacony, bez atrybucji, zwrocony),
--       miejsce pakietu nie dubluje konwersji, przychod tylko z zaplaconych
--       zamowien i zgloszen paid/partially_refunded, pula planu nie jest
--       "oplacone", zamowienie z karty goscia doliczone do prowadzacego;
--   (c) eksport: pakiet z kliknieciem (bez zgloszenia), zgloszenie czekajace
--       na przyjecie pominiete, cofnieta zgoda platnika albo posiadacza;
--   (d) limit grup: 60 kampanii z beaconu -> 50 + `other`, ranking po
--       zgloszeniach, wizyty w sumie bez zmian;
--   (e) koszty: reczna poprawka dnia z CSV nie zeruje klikniec;
--   (f) retencja i RLS tabeli atrybucji pakietow.
--
-- SPRZATANIE. Transakcja z ROLLBACK - `now()` stale przez caly plik.
-- ============================================================================

\echo '== 28 lejek Google Ads - poprawki po przegladzie =='

BEGIN;

-- Najemca z hosta = A (przypiecie pakietu czyta public_tenant_id()).
SELECT set_config('nes.public_tenant', '11111111-1111-1111-1111-111111111111', false);

-- ---------------------------------------------------------------------------
-- SCENOGRAFIA
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) VALUES
  ('28d00000-0000-0000-0000-0000000000a1', 'przeglad.admin@example.org'),
  ('28d00000-0000-0000-0000-0000000000b1', 'przeglad.kupujacy@example.org'),
  ('28d00000-0000-0000-0000-0000000000b2', 'przeglad.obcy@example.org'),
  ('28d00000-0000-0000-0000-0000000000c1', 'przeglad.platnik@example.org'),
  ('28d00000-0000-0000-0000-0000000000c2', 'przeglad.posiadacz@example.org'),
  ('28d00000-0000-0000-0000-0000000000c3', 'przeglad.plan@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('28d00000-0000-0000-0000-0000000000a1', 'admin', '11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, tenant_id, display_name, slug) VALUES
  ('28d00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'Admin 28p', 'przeglad-admin'),
  ('28d00000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'Kupujacy 28p', 'przeglad-kupujacy'),
  ('28d00000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111', 'Obcy 28p', 'przeglad-obcy')
ON CONFLICT (id) DO NOTHING;

-- E3: pakiety i przychod; E4: eksport i zgoda; E5: limit grup.
INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status, timezone) VALUES
  ('28d0e000-0000-0000-0000-0000000000e3', '11111111-1111-1111-1111-111111111111',
   'przeglad-28-e3', 'Przeglad E3', 'Review E3', now() + interval '30 days', 'published', 'Europe/Warsaw'),
  ('28d0e000-0000-0000-0000-0000000000e4', '11111111-1111-1111-1111-111111111111',
   'przeglad-28-e4', 'Przeglad E4', 'Review E4', now() + interval '30 days', 'published', 'Europe/Warsaw'),
  ('28d0e000-0000-0000-0000-0000000000e5', '11111111-1111-1111-1111-111111111111',
   'przeglad-28-e5', 'Przeglad E5', 'Review E5', now() + interval '30 days', 'published', 'Europe/Warsaw')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, audience, requires_verification, max_per_person)
VALUES
  ('28d07000-0000-0000-0000-0000000000e3', '11111111-1111-1111-1111-111111111111',
   '28d0e000-0000-0000-0000-0000000000e3', 'firmowa', 'Firmowa', 'Corporate',
   50000, 'PLN', NULL, 'company', false, NULL),
  ('28d07000-0000-0000-0000-0000000000e4', '11111111-1111-1111-1111-111111111111',
   '28d0e000-0000-0000-0000-0000000000e4', 'firmowa', 'Firmowa', 'Corporate',
   50000, 'PLN', NULL, 'company', false, NULL);

INSERT INTO public.event_ticket_packages
  (id, tenant_id, event_id, ticket_type_id, key, name_pl, name_en, audience,
   seats, price_cents, currency, quota)
VALUES
  ('28d09000-0000-0000-0000-0000000000e3', '11111111-1111-1111-1111-111111111111',
   '28d0e000-0000-0000-0000-0000000000e3', '28d07000-0000-0000-0000-0000000000e3',
   'firmowy_3', 'Pakiet firmowy 3', 'Corporate 3', 'company', 3, 150000, 'PLN', NULL),
  ('28d09000-0000-0000-0000-0000000000e4', '11111111-1111-1111-1111-111111111111',
   '28d0e000-0000-0000-0000-0000000000e4', '28d07000-0000-0000-0000-0000000000e4',
   'firmowy_3', 'Pakiet firmowy 3', 'Corporate 3', 'company', 3, 150000, 'PLN', NULL);

-- Zamowienia pakietow. P1 oplacony (z kampania), P2 oplacony (bez atrybucji),
-- P4 zwrocony (z kampania); w E4: P3 sprzed dwoch dni, P5 do przypiecia bez zgody.
INSERT INTO public.event_package_orders
  (id, tenant_id, event_id, package_id, buyer_user_id, buyer_email, seats_total, status,
   amount_cents, discount_cents, currency, paid_at, created_at)
VALUES
  ('28d0a000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '28d0e000-0000-0000-0000-0000000000e3', '28d09000-0000-0000-0000-0000000000e3',
   '28d00000-0000-0000-0000-0000000000b1', 'przeglad.kupujacy@example.org', 3, 'paid',
   150000, 0, 'PLN', now() - interval '1 hour', now() - interval '2 hours'),
  ('28d0a000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '28d0e000-0000-0000-0000-0000000000e3', '28d09000-0000-0000-0000-0000000000e3',
   '28d00000-0000-0000-0000-0000000000b2', 'przeglad.obcy@example.org', 3, 'paid',
   80000, 0, 'PLN', now() - interval '1 hour', now() - interval '2 hours'),
  ('28d0a000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   '28d0e000-0000-0000-0000-0000000000e3', '28d09000-0000-0000-0000-0000000000e3',
   '28d00000-0000-0000-0000-0000000000b1', 'przeglad.kupujacy@example.org', 3, 'refunded',
   150000, 0, 'PLN', now() - interval '1 hour', now() - interval '2 hours'),
  ('28d0a000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   '28d0e000-0000-0000-0000-0000000000e4', '28d09000-0000-0000-0000-0000000000e4',
   '28d00000-0000-0000-0000-0000000000b1', 'przeglad.kupujacy@example.org', 3, 'pending',
   150000, 0, 'PLN', NULL, now() - interval '2 days'),
  ('28d0a000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   '28d0e000-0000-0000-0000-0000000000e4', '28d09000-0000-0000-0000-0000000000e4',
   '28d00000-0000-0000-0000-0000000000b1', 'przeglad.kupujacy@example.org', 3, 'pending',
   150000, 0, 'PLN', NULL, now() - interval '1 hour');

INSERT INTO public.event_people
  (id, tenant_id, user_id, email, first_name, last_name, consent_data_processing_at, source)
VALUES
  ('28d0f000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', NULL,
   'pula@example.org', 'Pula', 'Planu', now(), 'self_registration'),
  ('28d0f000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', NULL,
   'reczna@example.org', 'Wplata', 'Reczna', now(), 'self_registration'),
  ('28d0f000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', NULL,
   'zwrot@example.org', 'Zwrot', 'Reczny', now(), 'self_registration'),
  ('28d0f000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', NULL,
   'prowadzacy@example.org', 'Lider', 'Grupy', now(), 'self_registration'),
  ('28d0f000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', NULL,
   'gosc.karta@example.org', 'Gosc', 'Karta', now(), 'self_registration'),
  ('28d0f000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', NULL,
   'gosc.lidera@example.org', 'Gosc', 'Lidera', now(), 'self_registration'),
  ('28d0f000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111', NULL,
   'czeka@example.org', 'Czeka', 'Na Przyjecie', now(), 'self_registration'),
  ('28d0f000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', NULL,
   'miejsce.pakietu@example.org', 'Miejsce', 'Pakietu', now(), 'self_registration'),
  ('28d0f000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', NULL,
   'platnik.e4@example.org', 'Platnik', 'Cofnal', now(), 'self_registration'),
  ('28d0f000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111',
   '28d00000-0000-0000-0000-0000000000c2', 'posiadacz.e4@example.org', 'Posiadacz', 'Cofnal',
   now(), 'self_registration'),
  ('28d0f000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', NULL,
   'k60@example.org', 'Kampania', 'Szescdziesiat', now(), 'self_registration')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.payment_orders
  (id, tenant_id, user_id, status, amount_cents, currency, metadata, paid_at, refunded_amount_cents)
VALUES
  -- Ra: zamowienie z karty ODRZUCONE, zgloszenie rozliczyla potem pula planu.
  ('28d0b000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', NULL,
   'failed', 50000, 'PLN', '{}'::jsonb, NULL, 0),
  -- Rb: zamowienie NIEZAPLACONE, organizator oznaczyl wplate recznie.
  ('28d0b000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', NULL,
   'pending', 40000, 'PLN', '{}'::jsonb, NULL, 0),
  -- Rc: zwrot reczny z panelu - zamowienie zostaje paid ze zwrotem 0.
  ('28d0b000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', NULL,
   'paid', 30000, 'PLN', '{}'::jsonb, now() - interval '1 hour', 0),
  -- Rd: prowadzacy i gosc z WLASNYM zamowieniem z karty.
  ('28d0b000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', NULL,
   'paid', 20000, 'PLN', '{}'::jsonb, now() - interval '1 hour', 0),
  ('28d0b000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', NULL,
   'paid', 15000, 'PLN', '{}'::jsonb, now() - interval '1 hour', 0),
  -- Re: oplacone, zgloszenie czeka na akceptacje organizatora.
  ('28d0b000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', NULL,
   'paid', 25000, 'PLN', '{}'::jsonb, now() - interval '1 hour', 0),
  -- E4: platnik c1 (cofnie zgode) i zgloszenie posiadacza c2.
  ('28d0b000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
   '28d00000-0000-0000-0000-0000000000c1', 'paid', 10000, 'PLN', '{}'::jsonb,
   now() - interval '1 hour', 0),
  ('28d0b000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', NULL,
   'paid', 12000, 'PLN', '{}'::jsonb, now() - interval '1 hour', 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, payment_status,
   payment_order_id, created_at, group_lead_registration_id)
VALUES
  ('28d0c000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '28d0e000-0000-0000-0000-0000000000e3', '28d0f000-0000-0000-0000-000000000001',
   'approved', 'form', 'paid', '28d0b000-0000-0000-0000-000000000001', now() - interval '3 hours', NULL),
  ('28d0c000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '28d0e000-0000-0000-0000-0000000000e3', '28d0f000-0000-0000-0000-000000000002',
   'approved', 'form', 'paid', '28d0b000-0000-0000-0000-000000000002', now() - interval '3 hours', NULL),
  ('28d0c000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   '28d0e000-0000-0000-0000-0000000000e3', '28d0f000-0000-0000-0000-000000000003',
   'approved', 'form', 'refunded', '28d0b000-0000-0000-0000-000000000003', now() - interval '3 hours', NULL),
  ('28d0c000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   '28d0e000-0000-0000-0000-0000000000e3', '28d0f000-0000-0000-0000-000000000004',
   'approved', 'form', 'paid', '28d0b000-0000-0000-0000-000000000004', now() - interval '3 hours', NULL),
  ('28d0c000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   '28d0e000-0000-0000-0000-0000000000e3', '28d0f000-0000-0000-0000-000000000007',
   'pending', 'form', 'paid', '28d0b000-0000-0000-0000-000000000006', now() - interval '3 hours', NULL),
  -- Zgloszenie z MIEJSCA pakietu P1 - konwersja to pakiet, nie to zgloszenie.
  ('28d0c000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
   '28d0e000-0000-0000-0000-0000000000e3', '28d0f000-0000-0000-0000-000000000008',
   'approved', 'form', 'not_required', NULL, now() - interval '3 hours', NULL),
  ('28d0c000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
   '28d0e000-0000-0000-0000-0000000000e4', '28d0f000-0000-0000-0000-000000000009',
   'approved', 'form', 'paid', '28d0b000-0000-0000-0000-000000000009', now() - interval '3 hours', NULL),
  ('28d0c000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111',
   '28d0e000-0000-0000-0000-0000000000e5', '28d0f000-0000-0000-0000-000000000011',
   'approved', 'form', 'not_required', NULL, now() - interval '3 hours', NULL)
ON CONFLICT (id) DO NOTHING;

-- Goscie prowadzacego Rd: jeden z WLASNYM zamowieniem z karty, drugi na zamowieniu lidera.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, payment_status,
   payment_order_id, created_at, group_lead_registration_id)
VALUES
  ('28d0c000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   '28d0e000-0000-0000-0000-0000000000e3', '28d0f000-0000-0000-0000-000000000005',
   'approved', 'form', 'paid', '28d0b000-0000-0000-0000-000000000005', now() - interval '3 hours',
   '28d0c000-0000-0000-0000-000000000004'),
  ('28d0c000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   '28d0e000-0000-0000-0000-0000000000e3', '28d0f000-0000-0000-0000-000000000006',
   'approved', 'form', 'paid', '28d0b000-0000-0000-0000-000000000004', now() - interval '3 hours',
   '28d0c000-0000-0000-0000-000000000004')
ON CONFLICT (id) DO NOTHING;

-- Ra: aktywny bilet z puli planu na zgloszeniu (bez zamowienia z karty).
INSERT INTO public.plan_ticket_claims
  (tenant_id, user_id, event_id, tier_key, period_start, period_end, registration_id)
VALUES
  ('11111111-1111-1111-1111-111111111111', '28d00000-0000-0000-0000-0000000000c3',
   '28d0e000-0000-0000-0000-0000000000e3', 'member', current_date - 30, current_date + 335,
   '28d0c000-0000-0000-0000-000000000001');

INSERT INTO public.event_package_seats
  (tenant_id, event_id, package_order_id, registration_id, assigned_at)
VALUES
  ('11111111-1111-1111-1111-111111111111', '28d0e000-0000-0000-0000-0000000000e3',
   '28d0a000-0000-0000-0000-000000000001', '28d0c000-0000-0000-0000-000000000008', now());

-- Atrybucje zgloszen E3/E4 (zapis bezposredni - przypiecie ma testy w 28_ads_funnel.sql).
-- Wszystkie z kampanii "wiosna"; Rd, Re, R9 z kliknieciem przy zgodzie.
INSERT INTO public.event_registration_attributions
  (tenant_id, registration_id, event_id, source, medium, utm_source, utm_medium, utm_campaign,
   click_id_type, click_id, click_at, ad_user_data, ad_personalization, created_at)
SELECT '11111111-1111-1111-1111-111111111111', r.id, r.event_id, 'google', 'cpc', 'google', 'cpc',
       'wiosna', x.t, x.c, CASE WHEN x.c IS NOT NULL THEN now() - interval '2 hours' END,
       x.c IS NOT NULL, x.c IS NOT NULL, now() - interval '3 hours'
  FROM public.event_registrations r
  JOIN (VALUES
    ('28d0c000-0000-0000-0000-000000000001'::uuid, NULL::text, NULL::text),
    ('28d0c000-0000-0000-0000-000000000002', NULL, NULL),
    ('28d0c000-0000-0000-0000-000000000003', 'gclid', 'CjwKCAjw-zwrot-reczny'),
    ('28d0c000-0000-0000-0000-000000000004', 'gclid', 'CjwKCAjw-prowadzacy-d'),
    ('28d0c000-0000-0000-0000-000000000007', 'gclid', 'CjwKCAjw-czeka-na-przyjecie'),
    ('28d0c000-0000-0000-0000-000000000008', NULL, NULL),
    ('28d0c000-0000-0000-0000-000000000009', 'gclid', 'CjwKCAjw-platnik-cofnal')
  ) AS x(id, t, c) ON x.id = r.id;

-- ---------------------------------------------------------------------------
-- (a) PRZYPIECIE ATRYBUCJI DO ZAMOWIENIA PAKIETU
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('28d00000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111');

DO $$
DECLARE
  v_ms numeric := floor(extract(epoch FROM now() - interval '3 hours') * 1000);
  v_res jsonb;
  v_a public.event_package_order_attributions%ROWTYPE;
BEGIN
  v_res := public.event_package_order_attribution_attach(jsonb_build_object(
    'order_id', '28d0a000-0000-0000-0000-000000000001',
    'first', jsonb_build_object('ts', v_ms, 'referrer_host', 'google.com'),
    'last', jsonb_build_object('ts', v_ms, 'utm_source', 'google', 'utm_medium', 'cpc',
      'utm_campaign', 'Pakiety', 'click_id_type', 'gclid', 'click_id', 'CjwKCAjw-pakiet-jeden'),
    'ad_consent', true));
  PERFORM pg_temp.assert(v_res = '{"ok":true,"attached":true,"source":"google","medium":"cpc","click":true}'::jsonb,
    '28p/pakiet: przypiecie wlasnego zamowienia z kanalem i faktem klikniecia');
  SELECT a.* INTO v_a FROM public.event_package_order_attributions a
   WHERE a.package_order_id = '28d0a000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(v_a.tenant_id = '11111111-1111-1111-1111-111111111111'
    AND v_a.event_id = '28d0e000-0000-0000-0000-0000000000e3'
    AND v_a.utm_campaign = 'Pakiety' AND v_a.click_id = 'CjwKCAjw-pakiet-jeden'
    AND v_a.click_at = to_timestamp(v_ms / 1000.0) AND v_a.ad_user_data
    AND v_a.first_touch->>'medium' = 'organic',
    '28p/pakiet: wiersz atrybucji z wydarzeniem zamowienia, kampania i kliknieciem');

  v_res := public.event_package_order_attribution_attach(jsonb_build_object(
    'order_id', '28d0a000-0000-0000-0000-000000000001',
    'last', jsonb_build_object('ts', v_ms, 'utm_source', 'nadpis'), 'ad_consent', true));
  PERFORM pg_temp.assert(v_res->>'reason' = 'already_attached'
    AND (SELECT a.utm_source FROM public.event_package_order_attributions a
          WHERE a.package_order_id = '28d0a000-0000-0000-0000-000000000001') = 'google',
    '28p/pakiet: drugie wywolanie niczego nie zmienia');

  PERFORM public.event_package_order_attribution_attach(jsonb_build_object(
    'order_id', '28d0a000-0000-0000-0000-000000000004',
    'last', jsonb_build_object('ts', v_ms, 'utm_source', 'google', 'utm_medium', 'cpc',
      'utm_campaign', 'pakiety', 'click_id_type', 'gclid', 'click_id', 'CjwKCAjw-pakiet-zwrot'),
    'ad_consent', true));

  v_res := public.event_package_order_attribution_attach(jsonb_build_object(
    'order_id', '28d0a000-0000-0000-0000-000000000005',
    'last', jsonb_build_object('ts', v_ms, 'click_id_type', 'gclid', 'click_id', 'CjwKCAjw-bez-zgody-p5'),
    'ad_consent', false));
  PERFORM pg_temp.assert(v_res->>'click' = 'false'
    AND (SELECT a.click_id IS NULL AND NOT a.ad_user_data AND a.source = 'google' AND a.medium = 'cpc'
           FROM public.event_package_order_attributions a
          WHERE a.package_order_id = '28d0a000-0000-0000-0000-000000000005'),
    '28p/pakiet: bez zgody reklamowej identyfikator zdjety, kanal zostaje');

  PERFORM pg_temp.assert(public.event_package_order_attribution_attach(jsonb_build_object(
      'order_id', '28d0a000-0000-0000-0000-000000000003'))->>'reason' = 'too_late',
    '28p/pakiet/ODMOWA: zamowienie starsze niz doba');
  PERFORM pg_temp.assert(public.event_package_order_attribution_attach(jsonb_build_object(
      'order_id', '28d0a000-0000-0000-0000-000000000002')) = '{"ok":false,"reason":"not_found"}'::jsonb,
    '28p/pakiet/ODMOWA: cudze zamowienie = nie znaleziono (bez wyroczni)');
  PERFORM pg_temp.assert(public.event_package_order_attribution_attach('{"order_id":"x"}'::jsonb)->>'reason' = 'not_found'
    AND public.event_package_order_attribution_attach('{}'::jsonb)->>'reason' = 'not_found',
    '28p/pakiet/ODMOWA: zly i brakujacy identyfikator zamowienia');
  PERFORM pg_temp.assert(NOT EXISTS (SELECT 1 FROM public.event_package_order_attributions a
      WHERE a.package_order_id IN ('28d0a000-0000-0000-0000-000000000002', '28d0a000-0000-0000-0000-000000000003')),
    '28p/pakiet/ODMOWA: odmowy niczego nie zapisuja');
END $$;

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_package_order_attribution_attach('[1]'::jsonb)$q$,
  'invalid_payload', '28p/pakiet/ODMOWA: ladunek nie jest obiektem');

SELECT pg_temp.act_as(NULL, NULL);
SELECT pg_temp.assert(public.event_package_order_attribution_attach(jsonb_build_object(
    'order_id', '28d0a000-0000-0000-0000-000000000002'))->>'reason' = 'not_found',
  '28p/pakiet/ODMOWA: bez zalogowania nie ma kupujacego');
SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.event_package_order_attribution_attach(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.event_package_order_attribution_attach(jsonb)', 'EXECUTE'),
  '28p/granty: przypiecie pakietu wylacznie dla zalogowanych');

-- ---------------------------------------------------------------------------
-- (b) RAPORT: PAKIETY I PRZYCHOD
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('28d00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');

CREATE TEMP TABLE t28p_ids (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT ALL ON t28p_ids TO PUBLIC;

DO $$
BEGIN
  INSERT INTO t28p_ids VALUES
    ('wiosna', public.admin_event_ad_campaign_save(jsonb_build_object(
      'event_id', '28d0e000-0000-0000-0000-0000000000e3', 'match_kind', 'utm_campaign',
      'match_value', 'wiosna', 'label', 'Wiosna', 'conversion_action_name', 'Bilet'))),
    ('pakiety', public.admin_event_ad_campaign_save(jsonb_build_object(
      'event_id', '28d0e000-0000-0000-0000-0000000000e3', 'match_kind', 'utm_campaign',
      'match_value', 'pakiety', 'label', 'Pakiety', 'conversion_action_name', 'Pakiet'))),
    ('e4', public.admin_event_ad_campaign_save(jsonb_build_object(
      'event_id', '28d0e000-0000-0000-0000-0000000000e4', 'match_kind', 'utm_campaign',
      'match_value', 'wiosna', 'label', 'Wiosna E4', 'conversion_action_name', 'Bilet')));
END $$;

DO $$
DECLARE
  v jsonb := public.admin_event_ads_funnel('28d0e000-0000-0000-0000-0000000000e3');
  g jsonb;
BEGIN
  SELECT x INTO g FROM jsonb_array_elements(v->'groups') x
   WHERE x->>'key' = 'campaign:' || (SELECT id FROM t28p_ids WHERE name = 'pakiety');
  PERFORM pg_temp.assert((g->>'registrations')::int = 2 AND (g->>'paid')::int = 1
    AND g->'revenue' = '[{"currency":"PLN","cents":150000}]'::jsonb,
    '28p/lejek: pakiet oplacony i zwrocony w kampanii - dwie konwersje, jedna oplacona, przychod tylko oplaconego');

  SELECT x INTO g FROM jsonb_array_elements(v->'groups') x
   WHERE x->>'key' = 'campaign:' || (SELECT id FROM t28p_ids WHERE name = 'wiosna');
  PERFORM pg_temp.assert((g->>'registrations')::int = 5,
    '28p/lejek: zgloszenie z miejsca pakietu i goscie grupy nie sa osobnymi konwersjami');
  PERFORM pg_temp.assert((g->>'paid')::int = 3,
    '28p/lejek: oplacone bez zgloszenia rozliczonego pula planu (zamowienie odrzucone) i bez zwrotu recznego');
  PERFORM pg_temp.assert(g->'revenue' = '[{"currency":"PLN","cents":60000}]'::jsonb,
    '28p/lejek: przychod = zamowienie lidera + zamowienie z karty goscia + czekajacy (bez niezaplaconych, odrzuconych i zwrotu recznego)');
  PERFORM pg_temp.assert(g->'channels'->0->'revenue' = '[{"currency":"PLN","cents":60000}]'::jsonb,
    '28p/lejek: przychod kanalu z tego samego zbioru zamowien');

  PERFORM pg_temp.assert(v->'unattributed' = '{"registrations":1,"paid":1,"revenue":[{"currency":"PLN","cents":80000}]}'::jsonb,
    '28p/lejek: pakiet bez atrybucji w wierszu bez atrybucji');
  PERFORM pg_temp.assert((v->'totals'->>'registrations')::int = 8
    AND (v->'totals'->>'attributed_registrations')::int = 7
    AND (v->'totals'->>'paid')::int = 5
    AND v->'totals'->'revenue' = '[{"currency":"PLN","cents":290000}]'::jsonb
    AND (v->>'groups_folded')::int = 0,
    '28p/lejek: sumy - zgloszenia prowadzacych i pakiety, przychod per zaplacone zamowienie');
END $$;

-- ---------------------------------------------------------------------------
-- (c) EKSPORT: PAKIET, OCZEKUJACE NA PRZYJECIE, COFNIETA ZGODA
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v jsonb := public.admin_event_ads_conversions_export('28d0e000-0000-0000-0000-0000000000e3');
BEGIN
  PERFORM pg_temp.assert(jsonb_array_length(v->'rows') = 2
    AND (SELECT array_agg(x->>'order_id' ORDER BY x->>'order_id') FROM jsonb_array_elements(v->'rows') x)
      = ARRAY['28d0a000-0000-0000-0000-000000000001', '28d0b000-0000-0000-0000-000000000004'],
    '28p/eksport: oplacony pakiet z kliknieciem i lider (bez zamowienia goscia, zwrotu recznego i czekajacego)');
  PERFORM pg_temp.assert((SELECT x FROM jsonb_array_elements(v->'rows') x
      WHERE x->>'order_id' = '28d0a000-0000-0000-0000-000000000001')
      @> '{"registration_id":null,"click_id":"CjwKCAjw-pakiet-jeden","value_cents":150000,"conversion_action_name":"Pakiet"}'::jsonb,
    '28p/eksport: wiersz pakietu bez zgloszenia, wartosc zamowienia, nazwa konwersji z kampanii');
  PERFORM pg_temp.assert(v->'skipped' = '{"unattributed":1,"no_click":0,"expired":0,"before_click":0,"consent_withdrawn":0,"awaiting_admission":1}'::jsonb,
    '28p/eksport: pakiet bez atrybucji i zgloszenie czekajace na przyjecie w licznikach');
END $$;

DO $$
DECLARE
  v jsonb := public.admin_event_ads_conversions_export('28d0e000-0000-0000-0000-0000000000e4');
BEGIN
  PERFORM pg_temp.assert(jsonb_array_length(v->'rows') = 1
    AND v->'rows'->0->>'click_id' = 'CjwKCAjw-platnik-cofnal',
    '28p/zgoda: przed cofnieciem zgody zgloszenie jest w pliku');
END $$;

INSERT INTO public.user_consents (user_id, consent_key, given, version, withdrawn_at)
VALUES ('28d00000-0000-0000-0000-0000000000c1', 'cookies_marketing', false, '2.0', now());

DO $$
DECLARE
  v jsonb := public.admin_event_ads_conversions_export('28d0e000-0000-0000-0000-0000000000e4');
BEGIN
  PERFORM pg_temp.assert(jsonb_array_length(v->'rows') = 0
    AND (v->'skipped'->>'consent_withdrawn')::int = 1,
    '28p/zgoda: platnik cofnal zgode na cookies marketingowe - 0 wierszy, consent_withdrawn = 1');
END $$;

-- Posiadacz biletu (osoba wydarzenia z kontem) cofa zgode; zgoda udzielona nie wyklucza.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, status, registration_mode, payment_status,
   payment_order_id, created_at, attended_at, group_lead_registration_id)
VALUES
  ('28d0c000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111',
   '28d0e000-0000-0000-0000-0000000000e4', '28d0f000-0000-0000-0000-000000000010',
   'attended', 'form', 'paid', '28d0b000-0000-0000-0000-000000000010', now() - interval '3 hours',
   now() - interval '30 minutes', NULL);
INSERT INTO public.event_registration_attributions
  (tenant_id, registration_id, event_id, source, medium, utm_campaign,
   click_id_type, click_id, click_at, ad_user_data, ad_personalization, created_at)
VALUES
  ('11111111-1111-1111-1111-111111111111', '28d0c000-0000-0000-0000-000000000010',
   '28d0e000-0000-0000-0000-0000000000e4', 'google', 'cpc', 'wiosna',
   'gclid', 'CjwKCAjw-posiadacz-cofnal', now() - interval '2 hours', true, true, now() - interval '3 hours');
INSERT INTO public.user_consents (user_id, consent_key, given, version, given_at)
VALUES ('28d00000-0000-0000-0000-0000000000c2', 'cookies_analytics', false, '2.0', now()),
       ('28d00000-0000-0000-0000-0000000000c2', 'cookies_marketing', true, '2.0', now());

SELECT pg_temp.assert(jsonb_array_length(public.admin_event_ads_conversions_export(
    '28d0e000-0000-0000-0000-0000000000e4')->'rows') = 1,
  '28p/zgoda: zgoda marketingowa udzielona (i odmowa innej kategorii) nie wyklucza - obecnosc na wydarzeniu to przyjecie');

UPDATE public.user_consents SET given = false, withdrawn_at = now()
 WHERE user_id = '28d00000-0000-0000-0000-0000000000c2' AND consent_key = 'cookies_marketing';

SELECT pg_temp.assert(
  jsonb_array_length(public.admin_event_ads_conversions_export('28d0e000-0000-0000-0000-0000000000e4')->'rows') = 0
  AND (public.admin_event_ads_conversions_export('28d0e000-0000-0000-0000-0000000000e4')->'skipped'->>'consent_withdrawn')::int = 2,
  '28p/zgoda: posiadacz biletu z kontem cofnal zgode - wiersz wypada');

-- ---------------------------------------------------------------------------
-- (d) LIMIT GRUP: 60 KAMPANII Z BEACONU
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_ms numeric := floor(extract(epoch FROM now() - interval '2 hours') * 1000);
  i integer;
BEGIN
  FOR i IN 1..60 LOOP
    PERFORM public.event_funnel_track('11111111-1111-1111-1111-111111111111', jsonb_build_object(
      'step', 'visit', 'slug', 'przeglad-28-e5',
      'visitor', 'visitor-k' || lpad(i::text, 4, '0'), 'session', 'session-k' || lpad(i::text, 4, '0'),
      'touch', jsonb_build_object('ts', v_ms, 'utm_source', 'spam', 'utm_medium', 'cpc',
        'utm_campaign', 'k' || lpad(i::text, 2, '0'))));
  END LOOP;
  PERFORM public.event_funnel_track('11111111-1111-1111-1111-111111111111', jsonb_build_object(
    'step', 'visit', 'slug', 'przeglad-28-e5', 'visitor', 'visitor-mapped', 'session', 'session-mapped',
    'touch', jsonb_build_object('ts', v_ms, 'utm_source', 'google', 'utm_medium', 'cpc',
      'utm_campaign', 'Zmapowana')));
  PERFORM public.event_funnel_track('11111111-1111-1111-1111-111111111111', jsonb_build_object(
    'step', 'visit', 'slug', 'przeglad-28-e5', 'visitor', 'visitor-direct', 'session', 'session-direct'));
END $$;

-- Zgloszenie z kampanii k60 - ranking po zgloszeniach wyciaga ja do pierwszej piecdziesiatki.
INSERT INTO public.event_registration_attributions
  (tenant_id, registration_id, event_id, source, medium, utm_campaign, created_at)
VALUES
  ('11111111-1111-1111-1111-111111111111', '28d0c000-0000-0000-0000-000000000011',
   '28d0e000-0000-0000-0000-0000000000e5', 'spam', 'cpc', 'k60', now() - interval '3 hours');

DO $$
DECLARE
  v_c uuid := public.admin_event_ad_campaign_save(jsonb_build_object(
    'event_id', '28d0e000-0000-0000-0000-0000000000e5', 'match_kind', 'utm_campaign',
    'match_value', 'zmapowana', 'label', 'Zmapowana'));
  v jsonb := public.admin_event_ads_funnel('28d0e000-0000-0000-0000-0000000000e5');
  g jsonb;
BEGIN
  PERFORM pg_temp.assert(jsonb_array_length(v->'groups') = 1 + 50 + 1 + 1
    AND (v->>'groups_folded')::int = 10,
    '28p/limit: zmapowana + 50 kampanii UTM + pozostale + brak kampanii; zwinietych 10');
  PERFORM pg_temp.assert((v->'totals'->>'visits')::int = 62
    AND (v->'totals'->>'registrations')::int = 1,
    '28p/limit: sumy wizyt i zgloszen bez zmian po zwinieciu');
  SELECT x INTO g FROM jsonb_array_elements(v->'groups') x WHERE x->>'key' = 'other';
  PERFORM pg_temp.assert(g->>'kind' = 'other' AND (g->>'visits')::int = 10
    AND (g->>'registrations')::int = 0 AND g->'utm_campaign' = 'null'::jsonb
    AND g->'channels'->0->>'source' = 'spam',
    '28p/limit: grupa pozostalych - 10 wizyt, bez nazwy kampanii, z kanalem');
  PERFORM pg_temp.assert(EXISTS (SELECT 1 FROM jsonb_array_elements(v->'groups') x
      WHERE x->>'key' = 'utm:k60' AND (x->>'registrations')::int = 1)
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v->'groups') x WHERE x->>'key' = 'utm:k50')
    AND EXISTS (SELECT 1 FROM jsonb_array_elements(v->'groups') x WHERE x->>'key' = 'utm:k49'),
    '28p/limit: ranking po zgloszeniach, potem wizytach i kluczu');
  PERFORM pg_temp.assert((SELECT array_agg(x->>'key' ORDER BY o) FROM jsonb_array_elements(v->'groups')
      WITH ORDINALITY AS t(x, o) WHERE x->>'key' IN ('campaign:' || v_c, 'other', 'none'))
      = ARRAY['campaign:' || v_c, 'other', 'none'],
    '28p/limit: kolejnosc - zmapowane, UTM, pozostale, brak kampanii');
END $$;

-- ---------------------------------------------------------------------------
-- (e) KOSZTY: RECZNA POPRAWKA NIE ZERUJE KLIKNIEC DNIA Z CSV
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_c uuid := (SELECT id FROM t28p_ids WHERE name = 'wiosna');
  v_day date := (now() AT TIME ZONE 'Europe/Warsaw')::date - 1;
  v_row public.event_ad_campaign_costs%ROWTYPE;
BEGIN
  PERFORM public.admin_event_ad_costs_save(jsonb_build_object('campaign_id', v_c, 'source', 'csv',
    'rows', jsonb_build_array(jsonb_build_object('day', to_char(v_day, 'YYYY-MM-DD'),
      'cost_micros', 100000000, 'currency', 'PLN', 'clicks', 40, 'impressions', 1000))));
  PERFORM public.admin_event_ad_costs_save(jsonb_build_object('campaign_id', v_c,
    'rows', jsonb_build_array(jsonb_build_object('day', to_char(v_day, 'YYYY-MM-DD'),
      'cost_micros', 90000000, 'currency', 'PLN'))));
  SELECT k.* INTO v_row FROM public.event_ad_campaign_costs k WHERE k.campaign_id = v_c AND k.day = v_day;
  PERFORM pg_temp.assert(v_row.cost_micros = 90000000 AND v_row.source = 'manual'
    AND v_row.clicks = 40 AND v_row.impressions = 1000,
    '28p/koszt: reczna poprawka kosztu zostawia klikniecia i wyswietlenia z CSV');
  PERFORM public.admin_event_ad_costs_save(jsonb_build_object('campaign_id', v_c,
    'rows', jsonb_build_array(jsonb_build_object('day', to_char(v_day, 'YYYY-MM-DD'),
      'cost_micros', 90000000, 'currency', 'PLN', 'clicks', NULL, 'impressions', 7))));
  SELECT k.* INTO v_row FROM public.event_ad_campaign_costs k WHERE k.campaign_id = v_c AND k.day = v_day;
  PERFORM pg_temp.assert(v_row.clicks IS NULL AND v_row.impressions = 7,
    '28p/koszt: jawny null czysci, podana wartosc nadpisuje');
END $$;

-- ---------------------------------------------------------------------------
-- (f) RLS I RETENCJA ATRYBUCJI PAKIETOW
-- ---------------------------------------------------------------------------
SET ROLE authenticated;
SELECT pg_temp.assert((SELECT count(*) FROM public.event_package_order_attributions) = 3,
  '28p/RLS: admin najemcy czyta atrybucje pakietow');
RESET ROLE;

SELECT pg_temp.act_as('28d00000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111');
SET ROLE authenticated;
SELECT pg_temp.assert((SELECT count(*) FROM public.event_package_order_attributions) = 0,
  '28p/RLS: kupujacy nie czyta atrybucji (tylko panel)');
SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_package_order_attributions (tenant_id, package_order_id, event_id)
     VALUES ('11111111-1111-1111-1111-111111111111', '28d0a000-0000-0000-0000-000000000002',
             '28d0e000-0000-0000-0000-0000000000e3')$q$,
  'permission denied', '28p/RLS: zapis z klienta tylko przez RPC');
RESET ROLE;

SELECT pg_temp.act_as(NULL, NULL);
SET ROLE anon;
SELECT pg_temp.assert_raises_like($q$SELECT count(*) FROM public.event_package_order_attributions$q$,
  'permission denied', '28p/RLS: anonim nie ma grantu do atrybucji pakietow');
RESET ROLE;

UPDATE public.event_package_order_attributions
   SET created_at = now() - interval '121 days'
 WHERE package_order_id = '28d0a000-0000-0000-0000-000000000001';

SELECT pg_temp.act_as('28d00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111');
DO $$
DECLARE
  v jsonb := public.event_ads_retention_prune();
  v_a public.event_package_order_attributions%ROWTYPE;
BEGIN
  PERFORM pg_temp.assert((v->>'package_attribution_clicks_cleared')::int = 1,
    '28p/retencja: klikniecie atrybucji pakietu starsze niz 120 dni zerowane');
  SELECT a.* INTO v_a FROM public.event_package_order_attributions a
   WHERE a.package_order_id = '28d0a000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(v_a.click_id IS NULL AND v_a.click_at IS NULL AND v_a.click_pruned_at = now()
    AND NOT (v_a.last_touch ? 'click_id') AND v_a.utm_campaign = 'Pakiety',
    '28p/retencja: pakiet traci klikniecie, kampania zostaje');
  v := public.admin_event_ads_conversions_export('28d0e000-0000-0000-0000-0000000000e3');
  PERFORM pg_temp.assert(jsonb_array_length(v->'rows') = 1 AND (v->'skipped'->>'expired')::int = 1,
    '28p/retencja: przyciety pakiet nie wraca do eksportu - wygasly');
END $$;

ROLLBACK;
SELECT set_config('nes.public_tenant', '', false);
