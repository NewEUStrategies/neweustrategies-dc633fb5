-- ============================================================================
-- 27_invoices - FAKTURY NA FIRME ZA BILETY I PAKIETY (TAKZE ZBIORCZE)
--
-- PO CO TEN PLIK ISTNIEJE
-- Migracja 20260926110000 stawia silnik dokumentow organizatora: dane
-- wystawcy, prosby kupujacych, szkic z jednego albo WIELU zamowien, numeracje
-- bez luk, wystawienie, proforme, korekte, stan KSeF i powiazanie z CRM.
-- Wszystko to jest logika W BAZIE (SECURITY DEFINER + triggery), wiec jedynym
-- miejscem, gdzie mozna ja zobaczyc w dzialaniu, jest replay na prawdziwym
-- PostgreSQL. Bramki tekstowe `check:sql-*` nie zobacza zlego zaokraglenia
-- netto, luki w numeracji ani faktury wystawionej dwa razy za to samo
-- zamowienie.
--
-- CO SPRAWDZA
--   1. Funkcje czyste: netto z brutto (te same wektory co vitest
--      eventInvoiceMath), stawki, NIP, normalizacja identyfikatora.
--   2. Ustawienia wystawcy: kazdy kod odmowy, wlaczenie wymaga kompletu
--      danych i JEDNORAZOWEGO potwierdzenia, klucz pominiety = bez zmian,
--      bramka (redaktor, zwykly uzytkownik, anonim), izolacja najemcy, granty.
--   3. Prosba kupujacego: wlasnosc w SQL, gosc grupy -> prowadzacy, okno do
--      konca trzeciego miesiaca po zaplacie, limit czestotliwosci, wycofanie.
--   4. Kandydaci do fakturowania (karta/przelew, kwota z zamowienia/cennika).
--   5. Szkic ZBIORCZY i pojedynczy, proforma po angielsku, kazdy kod odmowy,
--      unikalny indeks "jedna aktywna faktura na zamowienie".
--   6. Edycja szkicu: nabywca, pozycje, stawki, walidacja.
--   7. Wystawienie: odmowa MoR, numer, migawka sprzedawcy, KSeF, CRM (NIP,
--      najstarsza firma, tylko puste pola, os czasu, most osoby), prosby,
--      zdarzenie domenowe, licznik >= 10000, NIEZMIENNOSC dokumentu.
--   8. Stawka zw (podstawa zwolnienia), proforma -> faktura, anulowanie szkicu.
--   9. KSeF i data zaplaty.
--  10. Korekty: czesciowa (para przed/po) i pelna (zwalnia zamowienia).
--  11. Masowe wystawienie zbiorcze z oczekujacych prosb.
--  12. Odczyty panelu i kupujacego (anulowany SZKIC nie jest dokumentem).
--  13. RLS: tylko admin/super_admin najemcy czyta tabele, zapis wylacznie RPC.
--
-- SPRZATANIE: caly plik siedzi w BEGIN ... ROLLBACK.
-- ============================================================================

\echo '== 27 faktury wydarzen: szkic, zbiorcza, proforma, korekta, KSeF, CRM =='

BEGIN;

-- Identyfikatory generowane w trakcie scenariusza (szkice, prosby) trzymamy
-- w GUC-ach sesji - nazwa zamiast kopiowania uuid miedzy blokami.
CREATE FUNCTION pg_temp.t27(_k text) RETURNS uuid
LANGUAGE sql STABLE AS $f$ SELECT NULLIF(current_setting('nes.t27_' || _k, true), '')::uuid $f$;
CREATE FUNCTION pg_temp.t27_set(_k text, _v uuid) RETURNS uuid
LANGUAGE sql AS $f$ SELECT set_config('nes.t27_' || _k, _v::text, false)::uuid $f$;
CREATE FUNCTION pg_temp.t27_today() RETURNS date
LANGUAGE sql STABLE AS $f$ SELECT (now() AT TIME ZONE 'Europe/Warsaw')::date $f$;

-- Bramka czestotliwosci: atrapa sterowana GUC-iem (deterministyczna odmowa).
-- Ksztalt z 20260724221149; wycofywana razem z plikiem.
DROP FUNCTION IF EXISTS public.rate_limit_hit(text, text, integer, integer);
CREATE FUNCTION public.rate_limit_hit(
  _scope text, _subject text, _max integer, _window_minutes integer DEFAULT 1
) RETURNS TABLE(allowed boolean, hits integer, bucket_start timestamptz)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $rl$
  SELECT COALESCE(current_setting('nes.t27_rate_limit', true), '') <> 'deny', 1, now();
$rl$;

-- ---------------------------------------------------------------------------
-- SCENOGRAFIA
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('27000000-0000-0000-0000-0000000000a0', 'Tenant 27 (faktury)', 't27-fv'),
  ('27000000-0000-0000-0000-0000000000b0', 'Tenant 27 B (faktury)', 't27-fv-b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('27a00000-0000-0000-0000-0000000000a1', 'admin27@org27.example'),
  ('27a00000-0000-0000-0000-0000000000a2', 'redaktor27@org27.example'),
  ('27a00000-0000-0000-0000-0000000000a3', 'kupujacy@acme.example'),
  ('27a00000-0000-0000-0000-0000000000a4', 'obcy@example.org'),
  ('27a00000-0000-0000-0000-0000000000a5', 'ewa.druga@example.org'),
  ('27a00000-0000-0000-0000-0000000000b1', 'admin27b@orgb.example')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id) VALUES
  ('27a00000-0000-0000-0000-0000000000a1', '27000000-0000-0000-0000-0000000000a0'),
  ('27a00000-0000-0000-0000-0000000000a2', '27000000-0000-0000-0000-0000000000a0'),
  ('27a00000-0000-0000-0000-0000000000a3', '27000000-0000-0000-0000-0000000000a0'),
  ('27a00000-0000-0000-0000-0000000000a4', '27000000-0000-0000-0000-0000000000a0'),
  ('27a00000-0000-0000-0000-0000000000a5', '27000000-0000-0000-0000-0000000000a0'),
  ('27a00000-0000-0000-0000-0000000000b1', '27000000-0000-0000-0000-0000000000b0')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('27a00000-0000-0000-0000-0000000000a1', 'admin', '27000000-0000-0000-0000-0000000000a0'),
  ('27a00000-0000-0000-0000-0000000000a2', 'editor', '27000000-0000-0000-0000-0000000000a0'),
  ('27a00000-0000-0000-0000-0000000000b1', 'admin', '27000000-0000-0000-0000-0000000000b0');

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status, registration_mode, registration_flow, capacity)
VALUES
  ('27e00000-0000-0000-0000-0000000000e1', '27000000-0000-0000-0000-0000000000a0',
   'kongres-27', 'Kongres 27', 'Congress 27', now() + interval '30 days',
   'published', 'form', 'instant', NULL),
  ('27e00000-0000-0000-0000-0000000000eb', '27000000-0000-0000-0000-0000000000b0',
   'kongres-27b', 'Kongres 27 B', 'Congress 27 B', now() + interval '30 days',
   'published', 'form', 'instant', NULL);

INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, min_tier_rank, requires_approval, is_active, sort_order,
   group_registration_enabled, group_max_size, tax_mode)
VALUES
  ('27100000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-0000000000a0',
   '27e00000-0000-0000-0000-0000000000e1', 'standard', 'Standard', 'Standard', 12300, 'PLN',
   NULL, 0, false, true, 10, true, 10, 'inclusive'),
  ('27100000-0000-0000-0000-000000000002', '27000000-0000-0000-0000-0000000000a0',
   '27e00000-0000-0000-0000-0000000000e1', 'euro', 'Euro', 'Euro', 5000, 'EUR',
   NULL, 0, false, true, 20, false, 10, 'inclusive'),
  ('27100000-0000-0000-0000-0000000000b1', '27000000-0000-0000-0000-0000000000b0',
   '27e00000-0000-0000-0000-0000000000eb', 'standard', 'Standard B', 'Standard B', 9900, 'PLN',
   NULL, 0, false, true, 10, false, 10, 'inclusive');

INSERT INTO public.event_ticket_packages
  (id, tenant_id, event_id, ticket_type_id, key, name_pl, name_en, seats, price_cents, currency)
VALUES
  ('27800000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-0000000000a0',
   '27e00000-0000-0000-0000-0000000000e1', '27100000-0000-0000-0000-000000000001',
   'firma5', 'Firmowy 5', 'Company 5', 5, 50000, 'PLN');

-- Kartoteka CRM: DWIE firmy z tym samym NIP-em (duplikat z importu). Resolver
-- ma wybrac NAJSTARSZA i uzupelnic w niej WYLACZNIE puste pola.
INSERT INTO public.crm_companies (id, tenant_id, name, tax_id, city, created_at) VALUES
  ('27c00000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-0000000000a0',
   'ACME Polska', 'PL 526-025-02-74', 'Gdansk', now() - interval '2 years'),
  ('27c00000-0000-0000-0000-000000000002', '27000000-0000-0000-0000-0000000000a0',
   'Acme Duplikat', '5260250274', NULL, now() - interval '1 year');

INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name, company_text) VALUES
  ('27300000-0000-0000-0000-000000000003', '27000000-0000-0000-0000-0000000000a0',
   '27a00000-0000-0000-0000-0000000000a3', 'kupujacy@acme.example', 'Anna', 'Kupujaca', 'Acme'),
  ('27300000-0000-0000-0000-000000000033', '27000000-0000-0000-0000-0000000000a0',
   NULL, 'gosc@acme.example', 'Gosc', 'Grupowy', NULL),
  ('27300000-0000-0000-0000-000000000005', '27000000-0000-0000-0000-0000000000a0',
   '27a00000-0000-0000-0000-0000000000a5', 'ewa.druga@example.org', 'Ewa', 'Druga', NULL),
  ('27300000-0000-0000-0000-000000000007', '27000000-0000-0000-0000-0000000000a0',
   NULL, 'kolega@acme.example', 'Karol', 'Kolega', NULL),
  ('27300000-0000-0000-0000-000000000008', '27000000-0000-0000-0000-0000000000a0',
   NULL, 'odwolany@example.org', 'Olek', 'Odwolany', NULL),
  ('27300000-0000-0000-0000-000000000009', '27000000-0000-0000-0000-0000000000a0',
   NULL, 'euro@example.org', 'Eryk', 'Euro', NULL),
  ('27300000-0000-0000-0000-000000000010', '27000000-0000-0000-0000-0000000000a0',
   NULL, 'stary@acme.example', 'Stefan', 'Stary', NULL),
  ('27300000-0000-0000-0000-0000000000b1', '27000000-0000-0000-0000-0000000000b0',
   NULL, 'b@orgb.example', 'Bartek', 'Obcy', NULL);

-- O1: zamowienie z karty za zapis grupowy (2 miejsca, 246,01 zl - kwota NIE
-- dzieli sie rowno, wiec faktura musi miec dwie pozycje). O6: zaplacone pol
-- roku temu - okno prosby o fakture jest juz zamkniete.
INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, paid_at) VALUES
  ('27600000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-0000000000a0',
   '27a00000-0000-0000-0000-0000000000a3', 'paid', 24601, 'PLN', now()),
  ('27600000-0000-0000-0000-000000000006', '27000000-0000-0000-0000-0000000000a0',
   '27a00000-0000-0000-0000-0000000000a3', 'paid', 12300, 'PLN', now() - interval '5 months');

INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
   payment_status, payment_order_id, paid_at, cancelled_at, created_by)
VALUES
  -- R1: prowadzacy grupy, karta (O1).
  ('27400000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-0000000000a0',
   '27e00000-0000-0000-0000-0000000000e1', '27300000-0000-0000-0000-000000000003',
   '27100000-0000-0000-0000-000000000001', 'approved', 'form', 'paid',
   '27600000-0000-0000-0000-000000000001', now(), NULL, '27a00000-0000-0000-0000-0000000000a3'),
  -- R2: wplata zaksiegowana recznie (przelew), bez zamowienia z karty.
  ('27400000-0000-0000-0000-000000000002', '27000000-0000-0000-0000-0000000000a0',
   '27e00000-0000-0000-0000-0000000000e1', '27300000-0000-0000-0000-000000000005',
   '27100000-0000-0000-0000-000000000001', 'approved', 'form', 'paid',
   NULL, now(), NULL, '27a00000-0000-0000-0000-0000000000a5'),
  -- R3: nieoplacony zapis kolegi zalozony przez kupujacego (proforma).
  ('27400000-0000-0000-0000-000000000003', '27000000-0000-0000-0000-0000000000a0',
   '27e00000-0000-0000-0000-0000000000e1', '27300000-0000-0000-0000-000000000007',
   '27100000-0000-0000-0000-000000000001', 'pending', 'form', 'unpaid',
   NULL, NULL, NULL, '27a00000-0000-0000-0000-0000000000a3'),
  -- R4: odwolany.
  ('27400000-0000-0000-0000-000000000004', '27000000-0000-0000-0000-0000000000a0',
   '27e00000-0000-0000-0000-0000000000e1', '27300000-0000-0000-0000-000000000008',
   '27100000-0000-0000-0000-000000000001', 'cancelled', 'form', 'unpaid',
   NULL, NULL, now(), '27a00000-0000-0000-0000-0000000000a4'),
  -- R5: bilet w EUR.
  ('27400000-0000-0000-0000-000000000005', '27000000-0000-0000-0000-0000000000a0',
   '27e00000-0000-0000-0000-0000000000e1', '27300000-0000-0000-0000-000000000009',
   '27100000-0000-0000-0000-000000000002', 'approved', 'form', 'paid',
   NULL, now(), NULL, '27a00000-0000-0000-0000-0000000000a5'),
  -- R6: zaplacony piec miesiecy temu.
  ('27400000-0000-0000-0000-000000000006', '27000000-0000-0000-0000-0000000000a0',
   '27e00000-0000-0000-0000-0000000000e1', '27300000-0000-0000-0000-000000000010',
   '27100000-0000-0000-0000-000000000001', 'approved', 'form', 'paid',
   '27600000-0000-0000-0000-000000000006', now() - interval '5 months', NULL,
   '27a00000-0000-0000-0000-0000000000a3'),
  -- RB: zapis najemcy B.
  ('27400000-0000-0000-0000-0000000000b1', '27000000-0000-0000-0000-0000000000b0',
   '27e00000-0000-0000-0000-0000000000eb', '27300000-0000-0000-0000-0000000000b1',
   '27100000-0000-0000-0000-0000000000b1', 'approved', 'form', 'paid',
   NULL, now(), NULL, NULL);

-- R11: gosc grupy R1 (ta sama wplata).
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
   payment_status, paid_at, group_lead_registration_id)
VALUES
  ('27400000-0000-0000-0000-000000000011', '27000000-0000-0000-0000-0000000000a0',
   '27e00000-0000-0000-0000-0000000000e1', '27300000-0000-0000-0000-000000000033',
   '27100000-0000-0000-0000-000000000001', 'approved', 'form', 'paid', now(),
   '27400000-0000-0000-0000-000000000001');

-- PO1: pakiet firmowy 5 miejsc oplacony przelewem.
INSERT INTO public.event_package_orders
  (id, tenant_id, event_id, package_id, buyer_user_id, buyer_person_id, buyer_email,
   buyer_name, seats_total, status, amount_cents, currency, paid_at)
VALUES
  ('27900000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-0000000000a0',
   '27e00000-0000-0000-0000-0000000000e1', '27800000-0000-0000-0000-000000000001',
   '27a00000-0000-0000-0000-0000000000a3', '27300000-0000-0000-0000-000000000003',
   'kupujacy@acme.example', 'Anna Kupujaca', 5, 'paid', 50000, 'PLN', now());

SELECT set_config('nes.public_tenant', '27000000-0000-0000-0000-0000000000a0', false);

-- ---------------------------------------------------------------------------
-- 1) FUNKCJE CZYSTE - te same wektory co src/lib/events/__tests__/eventInvoiceMath.test.ts
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    (12300::bigint, '23', 10000::bigint), (100, '23', 81), (61, '23', 50), (1, '23', 1),
    (-12300, '23', -10000), (-61, '23', -50), (10800, '8', 10000), (105, '5', 100),
    (999, 'np', 999), (5000, 'zw', 5000), (777, '0', 777), (0, '23', 0),
    (12301, '23', 10001), (50000, '23', 40650), (12300, '8', 11389), (2100, '5', 2000)
  ) AS v(gross, rate, net) LOOP
    PERFORM pg_temp.assert(public._event_invoice_net_from_gross(r.gross, r.rate) = r.net,
      format('27/netto: %s @%s = %s', r.gross, r.rate, r.net));
  END LOOP;
  PERFORM pg_temp.assert(
    public._event_invoice_vat_percent('23') = 23 AND public._event_invoice_vat_percent('8') = 8
    AND public._event_invoice_vat_percent('5') = 5 AND public._event_invoice_vat_percent('0') = 0
    AND public._event_invoice_vat_percent('zw') = 0 AND public._event_invoice_vat_percent('np') = 0,
    '27/stawki: 23/8/5 procentowo, 0/zw/np = 0');

  PERFORM pg_temp.assert(
    public._event_invoice_pl_nip_valid('5260250274') AND public._event_invoice_pl_nip_valid('7011278375')
    AND public._event_invoice_pl_nip_valid('5250000009'),
    '27/NIP: poprawne sumy kontrolne przechodza');
  PERFORM pg_temp.assert(
    NOT public._event_invoice_pl_nip_valid('5260250275') AND NOT public._event_invoice_pl_nip_valid('526025027')
    AND NOT public._event_invoice_pl_nip_valid('1234567890') AND NOT public._event_invoice_pl_nip_valid(NULL),
    '27/NIP: zla suma, zla dlugosc i NULL odpadaja');
  PERFORM pg_temp.assert(
    public._event_invoice_tax_id_normalize('PL 526-025-02-74', 'PL') = '5260250274'
    AND public._event_invoice_tax_id_normalize('7011278375', 'pl') = '7011278375'
    AND public._event_invoice_tax_id_normalize('', 'PL') = ''
    AND public._event_invoice_tax_id_normalize(NULL, 'PL') = ''
    AND public._event_invoice_tax_id_normalize('de 123.456.789', 'DE') = 'DE123456789',
    '27/identyfikator: PL bez prefiksu i separatorow, puste = pusty napis, VAT ID wielkimi literami');
  PERFORM pg_temp.assert(
    public._event_invoice_tax_id_normalize('5260250275', 'PL') IS NULL
    AND public._event_invoice_tax_id_normalize('X', 'DE') IS NULL,
    '27/identyfikator: niepoprawny = NULL');
  PERFORM pg_temp.assert(
    public._event_invoice_tax_key('PL 526-025-02-74') = '5260250274'
    AND public._event_invoice_tax_key('de 123') = 'DE123' AND public._event_invoice_tax_key(NULL) = '',
    '27/klucz NIP: wolny tekst z kartoteki porownywalny z NIP-em z faktury');
END $$;

-- ---------------------------------------------------------------------------
-- 2) USTAWIENIA WYSTAWCY
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a1', '27000000-0000-0000-0000-0000000000a0');

DO $$
DECLARE v jsonb;
BEGIN
  v := public.admin_event_invoice_settings_get();
  PERFORM pg_temp.assert(v->>'enabled' = 'false' AND v->>'series_invoice' = 'FV'
    AND v->>'series_proforma' = 'PRO' AND v->>'series_correction' = 'KOR'
    AND (v->>'payment_days')::integer = 14 AND v->>'default_vat_rate' = '23'
    AND v->>'default_locale' = 'pl' AND v->>'seller_country' = 'PL' AND v->'confirmed_at' = 'null'::jsonb,
    '27/ustawienia: brak wiersza = domyslne i WYLACZONE');
END $$;

SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_settings_save('{"seller_country":"P1"}')$q$,
  'invalid_country', '27/ustawienia: kraj spoza ISO alpha-2');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_settings_save('{"seller_tax_id":"123"}')$q$,
  'invalid_tax_id', '27/ustawienia: NIP wystawcy z bledna suma');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_settings_save(jsonb_build_object('seller_name', repeat('x', 201)))$q$,
  'invalid_settings', '27/ustawienia: za dlugie pole tekstowe');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_settings_save('{"seller_email":"zly"}')$q$,
  'invalid_email', '27/ustawienia: zly e-mail wystawcy');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_settings_save('{"series_invoice":"F V"}')$q$,
  'invalid_series', '27/ustawienia: prefiks serii ze spacja');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_settings_save('{"series_proforma":"fv"}')$q$,
  'series_not_distinct', '27/ustawienia: serie faktury i proformy musza sie roznic (bez wzgledu na wielkosc liter)');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_settings_save('{"payment_days":121}')$q$,
  'invalid_payment_days', '27/ustawienia: termin platnosci > 120 dni');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_settings_save('{"payment_days":-1}')$q$,
  'invalid_payment_days', '27/ustawienia: ujemny termin platnosci');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_settings_save('{"default_vat_rate":"7"}')$q$,
  'invalid_vat_rate', '27/ustawienia: nieznana stawka domyslna');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_settings_save('{"default_locale":"de"}')$q$,
  'invalid_locale', '27/ustawienia: jezyk dokumentu spoza pl/en');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_settings_save('{"default_vat_rate":"zw"}')$q$,
  'vat_exempt_basis_required', '27/ustawienia: domyslne zw bez podstawy zwolnienia');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_settings_save('{"enabled":true}')$q$,
  'seller_incomplete', '27/ustawienia: wlaczenie bez danych sprzedawcy');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_settings_save('{"enabled":true,"seller_name":"Organizator 27","seller_tax_id":"7011278375","seller_address":"ul. Dluga 1","seller_postal_code":"00-001","seller_city":"Warszawa"}')$q$,
  'seller_confirmation_required', '27/ustawienia: pierwsze wlaczenie wymaga jawnego potwierdzenia "jestesmy sprzedawca"');

DO $$
DECLARE v jsonb; v2 jsonb; s public.event_invoice_settings;
BEGIN
  v := public.admin_event_invoice_settings_save(
    '{"enabled":true,"confirm_seller":true,"seller_name":"  Organizator 27 Sp. z o.o. ",
      "seller_tax_id":"PL 701-127-83-75","seller_address":"ul. Dluga 1","seller_postal_code":"00-001",
      "seller_city":"Warszawa","seller_email":"FAKTURY@Org27.example",
      "seller_bank_account":"pl61 1090 1014 0000 0712 1981 2874","seller_bank_swift":"wbkpplpp",
      "series_invoice":"fv"}'::jsonb);
  PERFORM pg_temp.assert(v->>'enabled' = 'true' AND v->>'confirmed_at' IS NOT NULL,
    '27/ustawienia: wlaczone po potwierdzeniu, stempel potwierdzenia jest');
  PERFORM pg_temp.assert(v->>'seller_name' = 'Organizator 27 Sp. z o.o.' AND v->>'seller_tax_id' = '7011278375'
    AND v->>'seller_email' = 'faktury@org27.example' AND v->>'series_invoice' = 'FV'
    AND v->>'seller_bank_account' = 'PL61109010140000071219812874' AND v->>'seller_bank_swift' = 'WBKPPLPP',
    '27/ustawienia: normalizacja (przyciecie, NIP bez PL, e-mail malymi, rachunek bez spacji, seria wielkimi)');
  SELECT * INTO s FROM public.event_invoice_settings WHERE tenant_id = '27000000-0000-0000-0000-0000000000a0';
  PERFORM pg_temp.assert(s.confirmed_by = '27a00000-0000-0000-0000-0000000000a1'
    AND s.updated_by = '27a00000-0000-0000-0000-0000000000a1',
    '27/ustawienia: kto potwierdzil i kto zmienil - zapisane');

  v2 := public.admin_event_invoice_settings_save('{"footer_note":"Dziekujemy za udzial"}'::jsonb);
  PERFORM pg_temp.assert(v2->>'enabled' = 'true' AND v2->>'seller_name' = 'Organizator 27 Sp. z o.o.'
    AND v2->>'footer_note' = 'Dziekujemy za udzial' AND v2->>'confirmed_at' = v->>'confirmed_at',
    '27/ustawienia: klucz pominiety = bez zmian, potwierdzenie sie nie resetuje');
END $$;

SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a2', '27000000-0000-0000-0000-0000000000a0');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_settings_get()$q$,
  'forbidden', '27/bramka: redaktor nie czyta danych wystawcy');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_settings_save('{}')$q$,
  'forbidden', '27/bramka: redaktor nie zapisuje danych wystawcy');
SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a3', '27000000-0000-0000-0000-0000000000a0');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoices_list('27e00000-0000-0000-0000-0000000000e1')$q$,
  'forbidden', '27/bramka: zwykly uzytkownik nie widzi dokumentow panelu');
SELECT pg_temp.act_as(NULL, '27000000-0000-0000-0000-0000000000a0');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_settings_get()$q$,
  'forbidden', '27/bramka: anonim odbity');

SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000b1', '27000000-0000-0000-0000-0000000000b0');
SELECT pg_temp.assert((public.admin_event_invoice_settings_get())->>'enabled' = 'false'
  AND (public.admin_event_invoice_settings_get())->>'seller_name' = '',
  '27/izolacja: admin najemcy B widzi WLASNE (puste) ustawienia, nie dane najemcy A');

SELECT pg_temp.assert(
  NOT has_function_privilege('anon', 'public.admin_event_invoice_settings_save(jsonb)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.admin_event_invoice_settings_save(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.event_invoice_request_save(jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.event_my_invoices()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_invoice_draft_build(uuid, uuid, jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_invoice_issue_core(uuid, uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_invoice_next_number(uuid, text, date)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public._event_invoice_crm_link(uuid, uuid, uuid)', 'EXECUTE'),
  '27/granty: RPC dla zalogowanych, funkcje wewnetrzne wylacznie service_role, nic dla anonima');
SELECT pg_temp.assert(
  has_table_privilege('authenticated', 'public.event_invoices', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.event_invoices', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.event_invoices', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.event_invoice_lines', 'DELETE')
  AND NOT has_table_privilege('authenticated', 'public.event_invoice_requests', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.event_invoice_sources', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.event_invoice_settings', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.event_invoice_counters', 'SELECT')
  AND NOT has_table_privilege('anon', 'public.event_invoices', 'SELECT'),
  '27/granty: klient tylko CZYTA (przez RLS); licznik numeracji niewidoczny; anonim nic');

-- ---------------------------------------------------------------------------
-- 3) PROSBA KUPUJACEGO O FAKTURE
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as(NULL, '27000000-0000-0000-0000-0000000000a0');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_invoice_request_save('{"registration_id":"27400000-0000-0000-0000-000000000001"}')$q$,
  'auth_required', '27/prosba: anonim musi sie zalogowac');

SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a3', '27000000-0000-0000-0000-0000000000a0');
SELECT pg_temp.assert_raises_like($q$SELECT public.event_invoice_request_save('{}')$q$,
  'invalid_source', '27/prosba: bez zamowienia');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_invoice_request_save('{"registration_id":"27400000-0000-0000-0000-000000000001","package_order_id":"27900000-0000-0000-0000-000000000001"}')$q$,
  'invalid_source', '27/prosba: dwa zamowienia naraz');

-- Kazdy kod walidacji nabywcy (lustro eventInvoiceBuyerDraft.ts).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('{"name":"A"}', 'invalid_buyer_name'),
    ('{"name":"Acme","country":"POL"}', 'invalid_country'),
    ('{"name":"Acme","tax_id":"123"}', 'invalid_tax_id'),
    ('{"name":"Acme","is_company":true}', 'tax_id_required'),
    ('{"name":"Acme","tax_id":"5260250274"}', 'invalid_buyer_address'),
    ('{"name":"Acme","tax_id":"5260250274","address":"ul. Morska 5","postal_code":"80001","city":"Gdansk"}', 'invalid_postal_code'),
    ('{"name":"Acme","tax_id":"5260250274","address":"ul. Morska 5","postal_code":"80-001","city":"Gdansk","email":"zly@"}', 'invalid_email'),
    ('{"name":"Acme","tax_id":"5260250274","address":"ul. Morska 5","postal_code":"80-001","city":"Gdansk","po_number":"' || repeat('9', 101) || '"}', 'invalid_po_number'),
    ('{"name":"Acme","tax_id":"5260250274","address":"ul. Morska 5","postal_code":"80-001","city":"Gdansk","recipient_name":"' || repeat('r', 201) || '"}', 'invalid_recipient')
  ) AS v(buyer, code) LOOP
    PERFORM pg_temp.assert_raises_like(
      format('SELECT public.event_invoice_request_save(jsonb_build_object(%L, %L, %L, %L::jsonb))',
             'registration_id', '27400000-0000-0000-0000-000000000001', 'buyer', r.buyer),
      r.code, '27/prosba/nabywca: ' || r.code);
  END LOOP;
END $$;

DO $$
DECLARE v_id uuid; v_again uuid; q public.event_invoice_requests;
BEGIN
  -- Gosc grupy (R11) prosi o fakture - prosba wisi na zapisie PROWADZACEGO.
  v_id := public.event_invoice_request_save(jsonb_build_object(
    'registration_id', '27400000-0000-0000-0000-000000000011',
    'buyer', '{"is_company":true,"name":" Acme Sp. z o.o. ","tax_id":"PL 526-025-02-74","country":"pl",
               "address":"ul. Morska 5","postal_code":"80-001","city":"Gdansk",
               "email":"Ksiegowosc@Acme.example","po_number":"PO-27A"}'::jsonb));
  PERFORM pg_temp.t27_set('req1', v_id);
  SELECT * INTO q FROM public.event_invoice_requests WHERE id = v_id;
  PERFORM pg_temp.assert(q.registration_id = '27400000-0000-0000-0000-000000000001'
    AND q.source_kind = 'registration' AND q.event_id = '27e00000-0000-0000-0000-0000000000e1'
    AND q.status = 'pending' AND q.requested_by = '27a00000-0000-0000-0000-0000000000a3',
    '27/prosba: zapis goscia mapuje sie na prowadzacego grupy, wlasciciel zapisany');
  PERFORM pg_temp.assert(q.buyer_name = 'Acme Sp. z o.o.' AND q.buyer_tax_id = '5260250274'
    AND q.buyer_country = 'PL' AND q.buyer_email = 'ksiegowosc@acme.example',
    '27/prosba: dane nabywcy znormalizowane (NIP, kraj, e-mail)');

  v_again := public.event_invoice_request_save(jsonb_build_object(
    'registration_id', '27400000-0000-0000-0000-000000000001',
    'buyer', '{"is_company":true,"name":"Acme Sp. z o.o.","tax_id":"5260250274","country":"PL",
               "address":"ul. Morska 5","postal_code":"80-001","city":"Gdansk",
               "email":"ksiegowosc@acme.example","po_number":"PO-27B"}'::jsonb));
  PERFORM pg_temp.assert(v_again = v_id
    AND (SELECT count(*) FROM public.event_invoice_requests
          WHERE registration_id = '27400000-0000-0000-0000-000000000001') = 1
    AND (SELECT po_number FROM public.event_invoice_requests WHERE id = v_id) = 'PO-27B',
    '27/prosba: ponowny zapis poprawia TE SAMA prosbe (jedna na zamowienie)');

  v_id := public.event_invoice_request_save(jsonb_build_object(
    'package_order_id', '27900000-0000-0000-0000-000000000001',
    'buyer', '{"is_company":true,"name":"Acme Sp. z o.o.","tax_id":"5260250274",
               "address":"ul. Morska 5","postal_code":"80-001","city":"Gdansk",
               "email":"ksiegowosc@acme.example","po_number":"PO-27P"}'::jsonb));
  PERFORM pg_temp.t27_set('reqp', v_id);
  PERFORM pg_temp.assert(
    (SELECT source_kind FROM public.event_invoice_requests WHERE id = v_id) = 'package_order',
    '27/prosba: pakiet firmowy');
  -- W jednej transakcji now() jest stale - prosba za zapis ma byc STARSZA.
  UPDATE public.event_invoice_requests SET created_at = now() - interval '1 hour'
   WHERE id = pg_temp.t27('req1');
END $$;

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_invoice_request_save('{"registration_id":"27400000-0000-0000-0000-000000000006","buyer":{"is_company":false,"name":"Stefan Stary","address":"ul. Stara 1","postal_code":"00-001","city":"Warszawa"}}')$q$,
  'request_window_closed', '27/prosba: po koncu trzeciego miesiaca od zaplaty - za pozno');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_invoice_request_save('{"registration_id":"27400000-0000-0000-0000-000000000002","buyer":{"name":"Obcy"}}')$q$,
  'not_found', '27/prosba: cudzy zapis');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_invoice_request_save('{"registration_id":"27400000-0000-0000-0000-0000000000b1","buyer":{"name":"Obcy"}}')$q$,
  'not_found', '27/prosba: zapis innego najemcy');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_invoice_request_save('{"registration_id":"27400000-0000-0000-0000-000000000004","buyer":{"name":"Obcy"}}')$q$,
  'not_found', '27/prosba: odwolany zapis');
SELECT set_config('nes.t27_rate_limit', 'deny', false);
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_invoice_request_save('{"registration_id":"27400000-0000-0000-0000-000000000001"}')$q$,
  'rate_limited', '27/prosba: bramka czestotliwosci');
SELECT set_config('nes.t27_rate_limit', '', false);

DO $$
DECLARE v_id uuid;
BEGIN
  v_id := public.event_invoice_request_save(jsonb_build_object(
    'registration_id', '27400000-0000-0000-0000-000000000003',
    'buyer', '{"is_company":false,"name":"Karol Kolega","address":"ul. Kolejowa 3","postal_code":"00-100","city":"Warszawa"}'::jsonb));
  PERFORM pg_temp.t27_set('req3', v_id);
  PERFORM pg_temp.assert(v_id IS NOT NULL, '27/prosba: przed zaplata bez ograniczenia okna');
END $$;

SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a4', '27000000-0000-0000-0000-0000000000a0');
SELECT pg_temp.assert_raises_like($q$SELECT public.event_invoice_request_cancel(pg_temp.t27('req3'))$q$,
  'not_found', '27/prosba: obcy nie wycofa cudzej prosby');
SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a3', '27000000-0000-0000-0000-0000000000a0');
DO $$
BEGIN
  -- Dwie instrukcje: podzapytanie w TEJ SAMEJ instrukcji co wywolanie widzialoby
  -- migawke sprzed zmiany.
  PERFORM pg_temp.assert(public.event_invoice_request_cancel(pg_temp.t27('req3')) = pg_temp.t27('req3'),
    '27/prosba: wycofanie zwraca identyfikator prosby');
  PERFORM pg_temp.assert(
    (SELECT status FROM public.event_invoice_requests WHERE id = pg_temp.t27('req3')) = 'cancelled',
    '27/prosba: wlasciciel wycofuje oczekujaca prosbe');
END $$;
SELECT pg_temp.assert_raises_like($q$SELECT public.event_invoice_request_cancel(pg_temp.t27('req3'))$q$,
  'not_found', '27/prosba: wycofanej nie wycofa sie drugi raz');

DO $$
DECLARE r1 record; r6 record; po record; n integer;
BEGIN
  SELECT count(*) INTO n FROM public.event_my_invoice_sources();
  PERFORM pg_temp.assert(n = 4, '27/moje zamowienia: zapis, zapis kolegi, stary zapis, pakiet (bez goscia i odwolanych)');
  SELECT * INTO r1 FROM public.event_my_invoice_sources() WHERE source_id = '27400000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(r1.seats = 2 AND r1.gross_cents = 24601 AND r1.request_status = 'pending'
    AND r1.po_number = 'PO-27B' AND r1.can_request AND r1.invoice_id IS NULL
    AND r1.request_deadline >= pg_temp.t27_today(),
    '27/moje zamowienia: zapis grupowy 2 miejsca, kwota z zamowienia, prosba oczekuje');
  SELECT * INTO r6 FROM public.event_my_invoice_sources() WHERE source_id = '27400000-0000-0000-0000-000000000006';
  PERFORM pg_temp.assert(NOT r6.can_request AND r6.request_deadline < pg_temp.t27_today(),
    '27/moje zamowienia: po terminie prosby nie ma');
  SELECT * INTO po FROM public.event_my_invoice_sources() WHERE source_id = '27900000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(po.source_kind = 'package_order' AND po.seats = 5 AND po.gross_cents = 50000,
    '27/moje zamowienia: pakiet z liczba miejsc i kwota');
  PERFORM pg_temp.assert((SELECT request_id FROM public.event_my_invoice_sources()
                           WHERE source_id = '27400000-0000-0000-0000-000000000003') IS NULL,
    '27/moje zamowienia: wycofana prosba nie wisi przy zamowieniu');
END $$;

SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a4', '27000000-0000-0000-0000-0000000000a0');
SELECT pg_temp.assert((SELECT count(*) FROM public.event_my_invoice_sources()) = 0,
  '27/moje zamowienia: obcy (tylko odwolany zapis) nie ma nic');
SELECT pg_temp.act_as(NULL, '27000000-0000-0000-0000-0000000000a0');
SELECT pg_temp.assert((SELECT count(*) FROM public.event_my_invoice_sources()) = 0
  AND (SELECT count(*) FROM public.event_my_invoices()) = 0,
  '27/moje zamowienia: anonim nie ma nic');

-- ---------------------------------------------------------------------------
-- 4) KANDYDACI DO FAKTUROWANIA
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a1', '27000000-0000-0000-0000-0000000000a0');

DO $$
DECLARE r record; n integer;
BEGIN
  SELECT count(*) INTO n FROM public.admin_event_invoice_candidates('27e00000-0000-0000-0000-0000000000e1');
  PERFORM pg_temp.assert(n = 6, '27/kandydaci: 5 zapisow prowadzacych + pakiet (bez goscia i odwolanego)');
  SELECT * INTO r FROM public.admin_event_invoice_candidates('27e00000-0000-0000-0000-0000000000e1')
   WHERE source_id = '27400000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(r.paid_via = 'card' AND r.amount_source = 'order' AND r.gross_cents = 24601
    AND r.seats = 2 AND r.tax_key = '5260250274' AND r.request_status = 'pending' AND r.company_text = 'Acme',
    '27/kandydaci: karta, kwota z zamowienia, NIP z prosby');
  SELECT * INTO r FROM public.admin_event_invoice_candidates('27e00000-0000-0000-0000-0000000000e1')
   WHERE source_id = '27400000-0000-0000-0000-000000000002';
  PERFORM pg_temp.assert(r.paid_via = 'transfer' AND r.amount_source = 'price_list' AND r.gross_cents = 12300
    AND r.request_id IS NULL AND r.tax_key IS NULL,
    '27/kandydaci: przelew, kwota z cennika');
  SELECT * INTO r FROM public.admin_event_invoice_candidates('27e00000-0000-0000-0000-0000000000e1') LIMIT 1;
  PERFORM pg_temp.assert(r.tax_key = '5260250274', '27/kandydaci: grupowanie po NIP (NIP-y pierwsze)');
END $$;

SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_invoice_candidates('27e00000-0000-0000-0000-0000000000eb')$q$,
  'not_found', '27/kandydaci: wydarzenie innego najemcy');
SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a2', '27000000-0000-0000-0000-0000000000a0');
SELECT pg_temp.assert_raises_like(
  $q$SELECT * FROM public.admin_event_invoice_candidates('27e00000-0000-0000-0000-0000000000e1')$q$,
  'forbidden', '27/kandydaci: redaktor odbity');

-- ---------------------------------------------------------------------------
-- 5) SZKICE: ZBIORCZY, POJEDYNCZY, PROFORMA
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a1', '27000000-0000-0000-0000-0000000000a0');

DO $$
DECLARE v_id uuid; i public.event_invoices; v_lines text;
BEGIN
  v_id := public.admin_event_invoice_draft_create(jsonb_build_object(
    'event_id', '27e00000-0000-0000-0000-0000000000e1', 'kind', 'invoice', 'aggregate', 'per_ticket_type',
    'sources', jsonb_build_array(
      jsonb_build_object('kind', 'registration', 'id', '27400000-0000-0000-0000-000000000001'),
      jsonb_build_object('kind', 'package_order', 'id', '27900000-0000-0000-0000-000000000001'))));
  PERFORM pg_temp.t27_set('collective', v_id);
  SELECT * INTO i FROM public.event_invoices WHERE id = v_id;
  SELECT string_agg(l.quantity || 'x' || l.unit_gross_cents || '@' || l.vat_rate || '=' || l.net_cents || '+' || l.vat_cents,
                    ';' ORDER BY l.position) INTO v_lines
    FROM public.event_invoice_lines l WHERE l.invoice_id = v_id;
  PERFORM pg_temp.assert(v_lines = '1x12300@23=10000+2300;1x12301@23=10001+2300;1x50000@23=40650+9350',
    '27/zbiorcza: 246,01 zl na dwa miejsca = dwie pozycje (12300 i 12301), pakiet jako komplet');
  PERFORM pg_temp.assert(i.gross_cents = 74601 AND i.net_cents = 60651 AND i.vat_cents = 13950,
    '27/zbiorcza: sumy = sumy pozycji');
  PERFORM pg_temp.assert(i.status = 'draft' AND i.kind = 'invoice' AND i.number IS NULL AND i.issue_date IS NULL
    AND i.currency = 'PLN' AND i.payment_method = 'transfer' AND i.paid_at IS NOT NULL
    AND i.event_slug = 'kongres-27' AND i.event_title_pl = 'Kongres 27' AND i.locale = 'pl',
    '27/zbiorcza: szkic bez numeru i daty, przelew (nie wszystko z karty), oplacony');
  PERFORM pg_temp.assert(i.buyer_name = 'Acme Sp. z o.o.' AND i.po_number = 'PO-27B' AND i.buyer_is_company
    AND i.buyer_user_id = '27a00000-0000-0000-0000-0000000000a3'
    AND i.buyer_person_id = '27300000-0000-0000-0000-000000000003',
    '27/zbiorcza: nabywca z NAJSTARSZEJ oczekujacej prosby, kupujacy i jego osoba');
  PERFORM pg_temp.assert(
    (SELECT description FROM public.event_invoice_lines WHERE invoice_id = v_id AND position = 1) = 'Bilet: Standard - Kongres 27'
    AND (SELECT description || '|' || unit FROM public.event_invoice_lines WHERE invoice_id = v_id AND position = 3)
        = 'Pakiet: Firmowy 5, miejsc: 5 - Kongres 27|kpl.',
    '27/zbiorcza: opisy pozycji po polsku');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_invoice_sources WHERE invoice_id = v_id AND covers AND released_at IS NULL) = 2
    AND (SELECT payment_order_id FROM public.event_invoice_sources
          WHERE invoice_id = v_id AND registration_id = '27400000-0000-0000-0000-000000000001')
        = '27600000-0000-0000-0000-000000000001'
    AND (SELECT seats FROM public.event_invoice_sources
          WHERE invoice_id = v_id AND package_order_id = '27900000-0000-0000-0000-000000000001') = 5,
    '27/zbiorcza: dwa zrodla, zamowienie z karty zapamietane, pakiet z liczba miejsc');
END $$;

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_draft_create('{"event_id":"27e00000-0000-0000-0000-0000000000e1","sources":[{"kind":"registration","id":"27400000-0000-0000-0000-000000000001"}]}')$q$,
  'already_invoiced', '27/szkic: zamowienie z aktywna faktura (takze szkicem) nie dostanie drugiej');

DO $$
DECLARE v_id uuid; i public.event_invoices;
BEGIN
  v_id := public.admin_event_invoice_draft_create(
    '{"event_id":"27e00000-0000-0000-0000-0000000000e1","sources":[{"kind":"registration","id":"27400000-0000-0000-0000-000000000002"}]}');
  PERFORM pg_temp.t27_set('single', v_id);
  SELECT * INTO i FROM public.event_invoices WHERE id = v_id;
  PERFORM pg_temp.assert(i.buyer_name = 'Ewa Druga' AND NOT i.buyer_is_company
    AND i.buyer_email = 'ewa.druga@example.org' AND i.buyer_user_id = '27a00000-0000-0000-0000-0000000000a5'
    AND i.gross_cents = 12300 AND i.payment_method = 'transfer',
    '27/pojedyncza: bez prosby nabywca z danych osoby (do uzupelnienia w szkicu)');
  PERFORM pg_temp.assert(
    (SELECT string_agg(description || '|' || unit || '|' || quantity, ';') FROM public.event_invoice_lines
      WHERE invoice_id = v_id) = 'Bilet: Standard - Kongres 27|szt.|1',
    '27/pojedyncza: jedna pozycja z cennika');

  v_id := public.admin_event_invoice_draft_create(
    '{"event_id":"27e00000-0000-0000-0000-0000000000e1","kind":"proforma","locale":"en","sources":[{"kind":"registration","id":"27400000-0000-0000-0000-000000000003"}]}');
  PERFORM pg_temp.t27_set('proforma', v_id);
  SELECT * INTO i FROM public.event_invoices WHERE id = v_id;
  PERFORM pg_temp.assert(i.kind = 'proforma' AND i.locale = 'en' AND i.paid_at IS NULL
    AND i.buyer_name = 'Karol Kolega'
    AND (SELECT description || '|' || unit FROM public.event_invoice_lines WHERE invoice_id = v_id)
        = 'Ticket: Standard - Congress 27|pcs'
    AND NOT (SELECT covers FROM public.event_invoice_sources WHERE invoice_id = v_id),
    '27/proforma: po angielsku, NIE blokuje zamowienia (covers = false)');
END $$;

SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_invoice_sources (tenant_id, invoice_id, source_kind, registration_id, seats, gross_cents, covers)
     VALUES ('27000000-0000-0000-0000-0000000000a0', pg_temp.t27('single'), 'registration',
             '27400000-0000-0000-0000-000000000001', 1, 1, true)$q$,
  'event_invoice_sources_registration_once',
  '27/indeks: nawet z pominieciem RPC zamowienie nie trafi na druga aktywna fakture (wyscig adminow)');

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('{"kind":"proforma","sources":[{"kind":"registration","id":"27400000-0000-0000-0000-000000000002"},{"kind":"registration","id":"27400000-0000-0000-0000-000000000002"}]}', 'duplicate_source'),
    ('{"sources":[{"kind":"registration","id":"27400000-0000-0000-0000-000000000011"}]}', 'source_not_lead'),
    ('{"sources":[{"kind":"registration","id":"27400000-0000-0000-0000-000000000004"}]}', 'source_not_invoiceable'),
    ('{"sources":[{"kind":"registration","id":"27400000-0000-0000-0000-00000000dead"}]}', 'source_not_found'),
    ('{"sources":[{"kind":"registration","id":"27400000-0000-0000-0000-0000000000b1"}]}', 'source_not_found'),
    ('{"sources":[{"kind":"package_order","id":"27400000-0000-0000-0000-000000000001"}]}', 'source_not_found'),
    ('{"kind":"proforma","sources":[{"kind":"registration","id":"27400000-0000-0000-0000-000000000003"},{"kind":"registration","id":"27400000-0000-0000-0000-000000000005"}]}', 'currency_mismatch'),
    ('{"sources":[]}', 'no_sources'),
    ('{"kind":"correction","sources":[]}', 'invalid_kind'),
    ('{"aggregate":"x","sources":[]}', 'invalid_aggregate'),
    ('{"locale":"de","sources":[]}', 'invalid_locale'),
    ('{"vat_rate":"7","sources":[]}', 'invalid_vat_rate'),
    ('{"sources":[{"kind":"ticket","id":"27400000-0000-0000-0000-000000000002"}]}', 'invalid_source'),
    ('{"kind":"proforma","request_id":"27400000-0000-0000-0000-00000000dead","sources":[{"kind":"registration","id":"27400000-0000-0000-0000-000000000002"}]}', 'request_not_found')
  ) AS v(payload, code) LOOP
    PERFORM pg_temp.assert_raises_like(
      format('SELECT public.admin_event_invoice_draft_create(%L::jsonb || %L::jsonb)',
             '{"event_id":"27e00000-0000-0000-0000-0000000000e1"}', r.payload),
      r.code, '27/szkic: ' || r.code);
  END LOOP;
END $$;
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_draft_create(jsonb_build_object('event_id', '27e00000-0000-0000-0000-0000000000e1', 'note', repeat('n', 1001), 'sources', '[]'::jsonb))$q$,
  'invalid_note', '27/szkic: za dluga uwaga');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_draft_create('{"event_id":"27e00000-0000-0000-0000-00000000dead","sources":[]}')$q$,
  'not_found', '27/szkic: nieznane wydarzenie');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_draft_create('{"event_id":"27e00000-0000-0000-0000-0000000000eb","sources":[]}')$q$,
  'not_found', '27/szkic: wydarzenie innego najemcy');

SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000b1', '27000000-0000-0000-0000-0000000000b0');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_draft_create('{"event_id":"27e00000-0000-0000-0000-0000000000eb","sources":[{"kind":"registration","id":"27400000-0000-0000-0000-0000000000b1"}]}')$q$,
  'invoicing_disabled', '27/szkic: najemca bez potwierdzonego wystawcy nic nie fakturuje');

-- ---------------------------------------------------------------------------
-- 6) EDYCJA SZKICU
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a1', '27000000-0000-0000-0000-0000000000a0');

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_draft_update(jsonb_build_object('id', pg_temp.t27('single'), 'buyer', '{"tax_id":"123"}'::jsonb))$q$,
  'invalid_tax_id', '27/edycja: nabywca scalany z zapisanym i walidowany');

DO $$
DECLARE i public.event_invoices; v_lines text;
BEGIN
  PERFORM public.admin_event_invoice_draft_update(jsonb_build_object(
    'id', pg_temp.t27('single'),
    'buyer', '{"is_company":true,"name":"Druga Firma SA","tax_id":"113-285-38-69","address":"ul. Polna 2",
               "postal_code":"00-950","city":"Warszawa","email":"Faktury@Druga.example"}'::jsonb,
    'note', '  Zamowienie telefoniczne ',
    'lines', '[{"description":"Bilet: Standard - Kongres 27","unit":"szt.","quantity":1,"unit_gross_cents":12300,"vat_rate":"8"},
               {"description":"Parking","unit":"szt.","quantity":2,"unit_gross_cents":1050,"vat_rate":"5"}]'::jsonb));
  SELECT * INTO i FROM public.event_invoices WHERE id = pg_temp.t27('single');
  PERFORM pg_temp.assert(i.buyer_is_company AND i.buyer_name = 'Druga Firma SA' AND i.buyer_tax_id = '1132853869'
    AND i.buyer_email = 'faktury@druga.example' AND i.note = 'Zamowienie telefoniczne',
    '27/edycja: nabywca firmowy znormalizowany, uwaga przycieta');
  SELECT string_agg(l.quantity || 'x' || l.unit_gross_cents || '@' || l.vat_rate || '=' || l.net_cents || '+' || l.vat_cents
                    || '/' || l.unit_net_cents, ';' ORDER BY l.position) INTO v_lines
    FROM public.event_invoice_lines l WHERE l.invoice_id = pg_temp.t27('single');
  PERFORM pg_temp.assert(v_lines = '1x12300@8=11389+911/11389;2x1050@5=2000+100/1000',
    '27/edycja: pozycje zastapione, netto/VAT liczone na POZYCJI');
  PERFORM pg_temp.assert(i.gross_cents = 14400 AND i.net_cents = 13389 AND i.vat_cents = 1011,
    '27/edycja: sumy przeliczone');
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('{"lines":[{"description":"X","unit":"szt.","quantity":0,"unit_gross_cents":100,"vat_rate":"23"}]}', 'invalid_quantity'),
    ('{"lines":[{"description":"X","unit":"szt.","quantity":-1,"unit_gross_cents":100,"vat_rate":"23"}]}', 'invalid_quantity'),
    ('{"lines":[{"description":"X","unit":"szt.","quantity":10001,"unit_gross_cents":100,"vat_rate":"23"}]}', 'invalid_quantity'),
    ('{"lines":[{"description":"X","unit":"szt.","quantity":1,"unit_gross_cents":-1,"vat_rate":"23"}]}', 'invalid_price'),
    ('{"lines":[{"description":"X","unit":"szt.","quantity":1,"unit_gross_cents":100000001,"vat_rate":"23"}]}', 'invalid_price'),
    ('{"lines":[{"description":"X","unit":"szt.","quantity":1,"unit_gross_cents":100,"vat_rate":"7"}]}', 'invalid_vat_rate'),
    ('{"lines":[{"description":" ","unit":"szt.","quantity":1,"unit_gross_cents":100,"vat_rate":"23"}]}', 'invalid_line'),
    ('{"lines":[{"description":"X","unit":"","quantity":1,"unit_gross_cents":100,"vat_rate":"23"}]}', 'invalid_line'),
    ('{"lines":[]}', 'no_lines'),
    ('{"lines":{}}', 'no_lines'),
    ('{"payment_method":"cash"}', 'invalid_payment_method'),
    ('{"locale":"de"}', 'invalid_locale')
  ) AS v(payload, code) LOOP
    PERFORM pg_temp.assert_raises_like(
      format('SELECT public.admin_event_invoice_draft_update(jsonb_build_object(%L, pg_temp.t27(%L)) || %L::jsonb)',
             'id', 'single', r.payload),
      r.code, '27/edycja: ' || r.code);
  END LOOP;
END $$;
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_draft_update(jsonb_build_object('id', pg_temp.t27('single'), 'note', repeat('n', 1001)))$q$,
  'invalid_note', '27/edycja: za dluga uwaga');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_draft_update(jsonb_build_object('id', pg_temp.t27('single'), 'lines', (SELECT jsonb_agg('{"description":"X","unit":"szt.","quantity":1,"unit_gross_cents":1,"vat_rate":"23"}'::jsonb) FROM generate_series(1, 201))))$q$,
  'too_many_lines', '27/edycja: najwyzej 200 pozycji');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_draft_update('{"id":"27400000-0000-0000-0000-00000000dead"}')$q$,
  'not_found', '27/edycja: nieznany dokument');

SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000b1', '27000000-0000-0000-0000-0000000000b0');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_draft_update(jsonb_build_object('id', pg_temp.t27('single'), 'note', 'obcy'))$q$,
  'not_found', '27/edycja: admin innego najemcy nie dotknie szkicu');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_get(pg_temp.t27('single'))$q$,
  'not_found', '27/odczyt: admin innego najemcy nie czyta dokumentu');

-- ---------------------------------------------------------------------------
-- 7) WYSTAWIENIE
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a1', '27000000-0000-0000-0000-0000000000a0');

-- Kasa bez wiersza checkout_settings = operator jest sprzedawca (MoR).
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_issue(pg_temp.t27('collective'))$q$,
  'mor_seller_conflict', '27/MoR: zamowienia z karty w trybie operatora - wlasnej faktury VAT nie wolno');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_invoice_counters WHERE tenant_id = '27000000-0000-0000-0000-0000000000a0') = 0,
  '27/MoR: odmowa nie zuzyla numeru');

DO $$
DECLARE v jsonb; i public.event_invoices; v_prefix text := to_char(pg_temp.t27_today(), 'YYYY/MM');
BEGIN
  -- Faktura za przelew przechodzi takze w trybie operatora.
  v := public.admin_event_invoice_issue(pg_temp.t27('single'));
  SELECT * INTO i FROM public.event_invoices WHERE id = pg_temp.t27('single');
  PERFORM pg_temp.assert(v->>'number' = 'FV/' || v_prefix || '/0001' AND i.number = v->>'number'
    AND i.series = 'FV' AND i.period = to_char(pg_temp.t27_today(), 'YYYY-MM') AND i.seq = 1,
    '27/wystawienie: pierwszy numer w miesiacu FV/RRRR/MM/0001');
  PERFORM pg_temp.assert(i.status = 'issued' AND i.issue_date = pg_temp.t27_today()
    AND i.issued_by = '27a00000-0000-0000-0000-0000000000a1' AND i.issued_at IS NOT NULL
    AND i.due_date = i.issue_date AND i.ksef_status = 'pending' AND i.vat_exempt_basis = '',
    '27/wystawienie: data wystawienia dzis (Warszawa), oplacona = termin dzis, KSeF do wyslania');
  PERFORM pg_temp.assert(i.seller->>'seller_name' = 'Organizator 27 Sp. z o.o.'
    AND i.seller->>'seller_tax_id' = '7011278375' AND i.seller->>'footer_note' = 'Dziekujemy za udzial'
    AND NOT (i.seller ? 'series_invoice') AND NOT (i.seller ? 'enabled'),
    '27/wystawienie: migawka sprzedawcy bez ustawien technicznych');
END $$;

INSERT INTO public.checkout_settings (tenant_id, automatic_tax)
VALUES ('27000000-0000-0000-0000-0000000000a0', true);

DO $$
DECLARE v jsonb; i public.event_invoices; c public.crm_companies; n integer; k record; d record;
        v_prefix text := to_char(pg_temp.t27_today(), 'YYYY/MM');
BEGIN
  v := public.admin_event_invoice_issue(pg_temp.t27('collective'));
  SELECT * INTO i FROM public.event_invoices WHERE id = pg_temp.t27('collective');
  PERFORM pg_temp.assert(i.number = 'FV/' || v_prefix || '/0002' AND v->>'kind' = 'invoice'
    AND v->>'event_id' = '27e00000-0000-0000-0000-0000000000e1',
    '27/wystawienie: kasa na wlasnym koncie (Stripe Tax) - zbiorcza dostaje kolejny numer');

  -- CRM: NAJSTARSZA firma z tym NIP-em, uzupelnione tylko puste pola.
  PERFORM pg_temp.assert(i.crm_company_id = '27c00000-0000-0000-0000-000000000001',
    '27/CRM: firma po NIP-ie (najstarsze trafienie, nie duplikat)');
  SELECT * INTO c FROM public.crm_companies WHERE id = '27c00000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(c.tax_id = 'PL 526-025-02-74' AND c.city = 'Gdansk' AND c.address = 'ul. Morska 5'
    AND c.postal_code = '80-001' AND c.email = 'ksiegowosc@acme.example' AND c.country = 'PL'
    AND c.name = 'ACME Polska',
    '27/CRM: istniejace pola nietkniete, puste uzupelnione');
  PERFORM pg_temp.assert(
    (SELECT address FROM public.crm_companies WHERE id = '27c00000-0000-0000-0000-000000000002') IS NULL,
    '27/CRM: duplikat nietkniety');
  PERFORM pg_temp.assert(
    (SELECT company_id FROM public.event_package_orders WHERE id = '27900000-0000-0000-0000-000000000001')
      = '27c00000-0000-0000-0000-000000000001'
    AND (SELECT count(*) FROM public.event_invoice_requests
          WHERE id IN (pg_temp.t27('req1'), pg_temp.t27('reqp'))
            AND crm_company_id = '27c00000-0000-0000-0000-000000000001'
            AND status = 'invoiced' AND invoice_id = pg_temp.t27('collective')) = 2,
    '27/CRM: firma na zamowieniu pakietu i prosbach; prosby zafakturowane');
  SELECT count(*) INTO n FROM public.audit_log
   WHERE entity_type = 'crm_company' AND entity_id = '27c00000-0000-0000-0000-000000000001'
     AND action = 'event.invoice.issued' AND metadata->>'number' = i.number
     AND (metadata->>'gross_cents')::bigint = 74601 AND metadata->>'event_slug' = 'kongres-27'
     AND metadata->>'summary_pl' = 'Faktura ' || i.number || ' - Kongres 27';
  PERFORM pg_temp.assert(n = 1, '27/CRM: wpis osi czasu firmy wg kontraktu eventActivity');
  PERFORM pg_temp.assert(EXISTS (
    SELECT 1 FROM public.crm_companies x
     WHERE x.tenant_id = '27000000-0000-0000-0000-0000000000a0' AND x.name = 'Druga Firma SA'
       AND x.tax_id = '1132853869' AND x.address = 'ul. Polna 2'
       AND x.created_by = '27a00000-0000-0000-0000-0000000000a1'),
    '27/CRM: nowa firma zalozona po nazwie, gdy NIP-u nie ma w kartotece');
  SELECT * INTO k FROM public.event_person_crm_links
   WHERE tenant_id = '27000000-0000-0000-0000-0000000000a0' AND person_id = '27300000-0000-0000-0000-000000000003';
  PERFORM pg_temp.assert(k.sync_status = 'ok' AND k.last_source_type = 'event_participant'
    AND k.last_source_label = 'event:kongres-27:invoice' AND k.last_tags = ARRAY['event:kongres-27'],
    '27/CRM: osoba kupujaca przez most (segment uczestnika, etykieta faktury, tag wydarzenia)');
  PERFORM pg_temp.assert(
    (SELECT NOT marketing_consent FROM public.crm_leads WHERE id = k.crm_lead_id),
    '27/CRM: faktura nie wytwarza zgody marketingowej');

  SELECT * INTO d FROM public.domain_events
   WHERE aggregate_type = 'event_invoice' AND aggregate_id = pg_temp.t27('collective')::text
     AND event_type = 'event_invoice.issued.v1';
  PERFORM pg_temp.assert(d.id IS NOT NULL AND d.payload->>'event_id' = '27e00000-0000-0000-0000-0000000000e1'
    AND d.payload->>'kind' = 'invoice' AND NOT (d.payload ? 'buyer_name') AND NOT (d.payload ? 'buyer_tax_id')
    AND d.actor_id = '27a00000-0000-0000-0000-0000000000a1',
    '27/zdarzenie: event_invoice.issued.v1 zapisane, bez danych nabywcy');
END $$;

SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_issue(pg_temp.t27('collective'))$q$,
  'not_draft', '27/wystawienie: drugi raz nie');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_issue('27400000-0000-0000-0000-00000000dead')$q$,
  'not_found', '27/wystawienie: nieznany dokument');

-- Licznik powyzej 9999: numer nie jest obcinany do czterech cyfr.
DO $$
DECLARE v record;
BEGIN
  UPDATE public.event_invoice_counters SET last_seq = 9999
   WHERE tenant_id = '27000000-0000-0000-0000-0000000000a0' AND series = 'FV';
  SELECT * INTO v FROM public._event_invoice_next_number('27000000-0000-0000-0000-0000000000a0', 'FV', pg_temp.t27_today());
  PERFORM pg_temp.assert(v.out_seq = 10000 AND v.out_number = 'FV/' || to_char(pg_temp.t27_today(), 'YYYY/MM') || '/10000',
    '27/numeracja: 10000. dokument w miesiacu ma piec cyfr, nie "0000"');
  UPDATE public.event_invoice_counters SET last_seq = 2
   WHERE tenant_id = '27000000-0000-0000-0000-0000000000a0' AND series = 'FV';
END $$;

-- NIEZMIENNOSC (trigger dziala takze dla zapisu z pominieciem RPC).
SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_invoices SET buyer_name = 'Podmiana' WHERE id = pg_temp.t27('single')$q$,
  'invoice_immutable', '27/niezmiennosc: wystawionego nabywcy nie zmienisz');
SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_invoices SET status = 'draft', number = NULL, issued_at = NULL WHERE id = pg_temp.t27('single')$q$,
  'invoice_immutable', '27/niezmiennosc: nie ma powrotu do szkicu');
SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_invoices SET event_id = '27e00000-0000-0000-0000-0000000000eb' WHERE id = pg_temp.t27('single')$q$,
  'invoice_immutable', '27/niezmiennosc: klucz obcy wolno tylko wyzerowac');
SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_invoice_lines SET description = 'Podmiana' WHERE invoice_id = pg_temp.t27('single')$q$,
  'invoice_immutable', '27/niezmiennosc: pozycji wystawionego dokumentu nie zmienisz');
SELECT pg_temp.assert_raises_like(
  $q$INSERT INTO public.event_invoice_lines (tenant_id, invoice_id, position, description, unit, quantity,
       unit_gross_cents, unit_net_cents, vat_rate, net_cents, vat_cents, gross_cents)
     VALUES ('27000000-0000-0000-0000-0000000000a0', pg_temp.t27('single'), 9, 'X', 'szt.', 1, 1, 1, '0', 1, 0, 1)$q$,
  'invoice_immutable', '27/niezmiennosc: pozycji nie dopiszesz');
SELECT pg_temp.assert_raises_like(
  $q$DELETE FROM public.event_invoices WHERE id = pg_temp.t27('single')$q$,
  'invoice_immutable', '27/niezmiennosc: wystawionego dokumentu nie usuniesz');
SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_invoice_sources SET covers = false WHERE invoice_id = pg_temp.t27('collective')$q$,
  'invoice_immutable', '27/niezmiennosc: zrodla wolno tylko zwolnic');
DO $$
BEGIN
  UPDATE public.event_invoices SET paid_at = now() - interval '1 day' WHERE id = pg_temp.t27('single');
  PERFORM pg_temp.assert(
    (SELECT paid_at FROM public.event_invoices WHERE id = pg_temp.t27('single')) = now() - interval '1 day',
    '27/niezmiennosc: data zaplaty wystawionego dokumentu JEST zmienialna');
END $$;

-- ---------------------------------------------------------------------------
-- 8) STAWKA ZW, PROFORMA -> FAKTURA, ANULOWANIE SZKICU
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM public.admin_event_invoice_draft_update(jsonb_build_object(
    'id', pg_temp.t27('proforma'),
    'buyer', '{"address":"ul. Kolejowa 3","postal_code":"00-100","city":"Warszawa"}'::jsonb,
    'lines', '[{"description":"Ticket: Standard - Congress 27","unit":"pcs","quantity":1,"unit_gross_cents":12300,"vat_rate":"zw"}]'::jsonb));
  PERFORM pg_temp.assert(
    (SELECT buyer_name || '|' || buyer_city FROM public.event_invoices WHERE id = pg_temp.t27('proforma'))
      = 'Karol Kolega|Warszawa',
    '27/edycja: klucze nabywcy pominiete zostaja');
END $$;
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_issue(pg_temp.t27('proforma'))$q$,
  'vat_exempt_basis_required', '27/zw: bez podstawy zwolnienia w ustawieniach dokument nie wyjdzie');

DO $$
DECLARE i public.event_invoices; v_final uuid; f public.event_invoices;
BEGIN
  PERFORM public.admin_event_invoice_settings_save('{"vat_exempt_basis":"art. 43 ust. 1 pkt 29 ustawy o VAT"}');
  PERFORM public.admin_event_invoice_issue(pg_temp.t27('proforma'));
  SELECT * INTO i FROM public.event_invoices WHERE id = pg_temp.t27('proforma');
  PERFORM pg_temp.assert(i.number = 'PRO/' || to_char(pg_temp.t27_today(), 'YYYY/MM') || '/0001'
    AND i.ksef_status = 'not_applicable' AND i.vat_exempt_basis = 'art. 43 ust. 1 pkt 29 ustawy o VAT'
    AND i.due_date = i.issue_date + 14 AND i.gross_cents = 12300 AND i.net_cents = 12300 AND i.vat_cents = 0,
    '27/proforma: wlasna seria, bez KSeF, podstawa zw na dokumencie, termin z ustawien');

  v_final := public.admin_event_invoice_from_proforma(pg_temp.t27('proforma'));
  PERFORM pg_temp.t27_set('final', v_final);
  SELECT * INTO f FROM public.event_invoices WHERE id = v_final;
  PERFORM pg_temp.assert(f.kind = 'invoice' AND f.status = 'draft' AND f.source_proforma_id = i.id
    AND f.buyer_name = 'Karol Kolega' AND f.gross_cents = 12300 AND f.locale = 'en'
    AND (SELECT count(*) FROM public.event_invoice_lines WHERE invoice_id = v_final AND vat_rate = 'zw') = 1
    AND (SELECT count(*) FROM public.event_invoice_sources WHERE invoice_id = v_final AND covers) = 1,
    '27/proforma -> faktura: szkic z tymi samymi pozycjami, nabywca i zamowieniem (juz blokujacym)');
END $$;

SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_from_proforma(pg_temp.t27('proforma'))$q$,
  'proforma_already_converted', '27/proforma: druga faktura z tej samej proformy nie');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_from_proforma(pg_temp.t27('single'))$q$,
  'not_proforma', '27/proforma: faktury nie przerobisz na fakture');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_from_proforma('27400000-0000-0000-0000-00000000dead')$q$,
  'not_found', '27/proforma: nieznany dokument');

DO $$
DECLARE f public.event_invoices; v_final2 uuid;
BEGIN
  PERFORM public.admin_event_invoice_cancel(jsonb_build_object('id', pg_temp.t27('final')));
  SELECT * INTO f FROM public.event_invoices WHERE id = pg_temp.t27('final');
  PERFORM pg_temp.assert(f.status = 'cancelled' AND f.number IS NULL AND f.cancelled_at IS NOT NULL
    AND f.cancelled_by = '27a00000-0000-0000-0000-0000000000a1'
    AND NOT EXISTS (SELECT 1 FROM public.event_invoice_sources WHERE invoice_id = f.id AND released_at IS NULL),
    '27/anulowanie: szkic anulowany bez powodu, zamowienie zwolnione');
  PERFORM pg_temp.assert(EXISTS (SELECT 1 FROM public.domain_events
    WHERE aggregate_id = f.id::text AND event_type = 'event_invoice.cancelled.v1'),
    '27/zdarzenie: event_invoice.cancelled.v1 zapisane');
  v_final2 := public.admin_event_invoice_from_proforma(pg_temp.t27('proforma'));
  PERFORM pg_temp.t27_set('final2', v_final2);
  PERFORM pg_temp.assert(v_final2 <> f.id, '27/proforma: po anulowaniu szkicu faktury mozna zrobic nowy');
END $$;
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_cancel(jsonb_build_object('id', pg_temp.t27('final')))$q$,
  'already_cancelled', '27/anulowanie: drugi raz nie');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_cancel('{"id":"27400000-0000-0000-0000-00000000dead"}')$q$,
  'not_found', '27/anulowanie: nieznany dokument');

-- ---------------------------------------------------------------------------
-- 9) KSeF I DATA ZAPLATY
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_ksef_update(jsonb_build_object('id', pg_temp.t27('single'), 'status', 'accepted'))$q$,
  'ksef_number_required', '27/KSeF: przyjety bez numeru KSeF');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_ksef_update(jsonb_build_object('id', pg_temp.t27('single'), 'status', 'bogus'))$q$,
  'invalid_ksef_status', '27/KSeF: nieznany stan');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_ksef_update(jsonb_build_object('id', pg_temp.t27('proforma'), 'status', 'sent'))$q$,
  'ksef_not_applicable', '27/KSeF: proforma nie idzie do KSeF');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_ksef_update(jsonb_build_object('id', pg_temp.t27('final2'), 'status', 'sent'))$q$,
  'ksef_not_applicable', '27/KSeF: szkic nie idzie do KSeF');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_ksef_update(jsonb_build_object('id', pg_temp.t27('single'), 'status', 'sent', 'number', repeat('1', 65)))$q$,
  'invalid_ksef_number', '27/KSeF: numer dluzszy niz 64 znaki');

DO $$
DECLARE i public.event_invoices;
BEGIN
  PERFORM public.admin_event_invoice_ksef_update(jsonb_build_object(
    'id', pg_temp.t27('single'), 'status', 'accepted', 'number', ' 1132853869-20260926-ABCDEF-01 '));
  SELECT * INTO i FROM public.event_invoices WHERE id = pg_temp.t27('single');
  PERFORM pg_temp.assert(i.ksef_status = 'accepted' AND i.ksef_number = '1132853869-20260926-ABCDEF-01'
    AND i.ksef_updated_at IS NOT NULL,
    '27/KSeF: stan i numer zapisane (na wystawionym dokumencie - wolno)');
  PERFORM public.admin_event_invoice_set_paid(jsonb_build_object('id', pg_temp.t27('single'), 'paid_at', NULL));
  PERFORM pg_temp.assert((SELECT paid_at FROM public.event_invoices WHERE id = pg_temp.t27('single')) IS NULL,
    '27/zaplata: mozna oznaczyc jako nieoplacony');
  PERFORM public.admin_event_invoice_set_paid(jsonb_build_object('id', pg_temp.t27('single'), 'paid_at', '2026-09-01T10:00:00Z'));
  PERFORM pg_temp.assert((SELECT paid_at FROM public.event_invoices WHERE id = pg_temp.t27('single'))
      = '2026-09-01T10:00:00Z'::timestamptz,
    '27/zaplata: data zaplaty zapisana');
END $$;
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_set_paid(jsonb_build_object('id', pg_temp.t27('final'), 'paid_at', now()))$q$,
  'not_found', '27/zaplata: tylko wystawiony dokument');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_cancel(jsonb_build_object('id', pg_temp.t27('single'), 'reason', 'Pomylka'))$q$,
  'ksef_locked', '27/anulowanie: dokument przyjety w KSeF - tylko korekta');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_cancel(jsonb_build_object('id', pg_temp.t27('proforma')))$q$,
  'reason_required', '27/anulowanie: wystawionego dokumentu nie anulujesz bez powodu');

-- ---------------------------------------------------------------------------
-- 10) KOREKTY
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_correction_create(jsonb_build_object('invoice_id', pg_temp.t27('single'), 'mode', 'partial'))$q$,
  'reason_required', '27/korekta: bez przyczyny');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_correction_create(jsonb_build_object('invoice_id', pg_temp.t27('single'), 'mode', 'x', 'reason', 'r'))$q$,
  'invalid_correction_mode', '27/korekta: tryb pelna albo czesciowa');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_correction_create(jsonb_build_object('invoice_id', pg_temp.t27('single'), 'mode', 'partial', 'reason', 'r', 'lines', '[]'::jsonb))$q$,
  'correction_empty', '27/korekta: nic sie nie zmienia');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_correction_create(jsonb_build_object('invoice_id', pg_temp.t27('single'), 'mode', 'partial', 'reason', 'r',
       'lines', jsonb_build_array(jsonb_build_object('line_id', (SELECT id FROM public.event_invoice_lines WHERE invoice_id = pg_temp.t27('single') AND position = 1), 'quantity', -1))))$q$,
  'invalid_line', '27/korekta: ilosc po korekcie nie jest ujemna');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_correction_create(jsonb_build_object('invoice_id', pg_temp.t27('proforma'), 'mode', 'full', 'reason', 'r'))$q$,
  'correction_target_invalid', '27/korekta: proformy sie nie koryguje');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_correction_create(jsonb_build_object('invoice_id', pg_temp.t27('final2'), 'mode', 'full', 'reason', 'r'))$q$,
  'correction_target_invalid', '27/korekta: szkicu sie nie koryguje');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_correction_create('{"invoice_id":"27400000-0000-0000-0000-00000000dead","reason":"r"}')$q$,
  'not_found', '27/korekta: nieznany dokument');

DO $$
DECLARE v_id uuid; c public.event_invoices; v_lines text;
BEGIN
  v_id := public.admin_event_invoice_correction_create(jsonb_build_object(
    'invoice_id', pg_temp.t27('single'), 'mode', 'partial', 'reason', 'Zla stawka VAT biletu',
    'lines', jsonb_build_array(jsonb_build_object(
      'line_id', (SELECT id FROM public.event_invoice_lines WHERE invoice_id = pg_temp.t27('single') AND position = 1),
      'vat_rate', '23'))));
  PERFORM pg_temp.t27_set('corr_partial', v_id);
  SELECT * INTO c FROM public.event_invoices WHERE id = v_id;
  SELECT string_agg(l.quantity || 'x' || l.unit_gross_cents || '@' || l.vat_rate, ';' ORDER BY l.position) INTO v_lines
    FROM public.event_invoice_lines l WHERE l.invoice_id = v_id;
  PERFORM pg_temp.assert(v_lines = '-1x12300@8;1x12300@23'
    AND NOT EXISTS (SELECT 1 FROM public.event_invoice_lines WHERE invoice_id = v_id AND corrects_line_id IS NULL),
    '27/korekta czesciowa: para przed/po tylko dla zmienionej pozycji, z odwolaniem do pozycji');
  PERFORM pg_temp.assert(c.gross_cents = 0 AND c.vat_cents = 2300 - 911 AND c.net_cents = 10000 - 11389
    AND c.kind = 'correction' AND c.correction_mode = 'partial' AND c.corrects_invoice_id = pg_temp.t27('single')
    AND c.buyer_name = 'Druga Firma SA' AND c.correction_reason = 'Zla stawka VAT biletu',
    '27/korekta czesciowa: roznice sum, nabywca z faktury korygowanej');
END $$;

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_correction_create(jsonb_build_object('invoice_id', pg_temp.t27('single'), 'mode', 'full', 'reason', 'r'))$q$,
  'correction_exists', '27/korekta: najpierw dokoncz otwarta korekte');

DO $$
DECLARE c public.event_invoices;
BEGIN
  PERFORM public.admin_event_invoice_issue(pg_temp.t27('corr_partial'));
  SELECT * INTO c FROM public.event_invoices WHERE id = pg_temp.t27('corr_partial');
  PERFORM pg_temp.assert(c.number = 'KOR/' || to_char(pg_temp.t27_today(), 'YYYY/MM') || '/0001'
    AND c.ksef_status = 'pending' AND c.status = 'issued',
    '27/korekta: wlasna seria, idzie do KSeF');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.event_invoice_sources WHERE invoice_id = pg_temp.t27('single') AND released_at IS NOT NULL),
    '27/korekta czesciowa: zamowienie zostaje na fakturze');
  PERFORM pg_temp.assert(EXISTS (SELECT 1 FROM public.audit_log
    WHERE entity_type = 'crm_company' AND action = 'event.invoice.correction_issued'
      AND metadata->>'number' = c.number AND metadata->>'summary_en' LIKE 'Credit note %'),
    '27/CRM: korekta na osi czasu firmy');
END $$;

DO $$
DECLARE v_draft uuid; v_full uuid; c public.event_invoices;
BEGIN
  -- Szkic pelnej korekty porzucony - anulowany szkic NIE jest dokumentem.
  v_draft := public.admin_event_invoice_correction_create(jsonb_build_object(
    'invoice_id', pg_temp.t27('collective'), 'mode', 'full', 'reason', 'Pomylka'));
  PERFORM public.admin_event_invoice_cancel(jsonb_build_object('id', v_draft));
  PERFORM pg_temp.t27_set('corr_cancelled', v_draft);

  v_full := public.admin_event_invoice_correction_create(jsonb_build_object(
    'invoice_id', pg_temp.t27('collective'), 'mode', 'full', 'reason', 'Rezygnacja z udzialu'));
  PERFORM pg_temp.t27_set('corr_full', v_full);
  SELECT * INTO c FROM public.event_invoices WHERE id = v_full;
  PERFORM pg_temp.assert(c.gross_cents = -74601 AND c.net_cents = -60651 AND c.vat_cents = -13950
    AND (SELECT count(*) FROM public.event_invoice_lines WHERE invoice_id = v_full AND quantity < 0) = 3
    AND c.buyer_user_id = '27a00000-0000-0000-0000-0000000000a3',
    '27/korekta pelna: wszystkie pozycje odwrocone');
END $$;

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_cancel(jsonb_build_object('id', pg_temp.t27('collective'), 'reason', 'Pomylka'))$q$,
  'has_corrections', '27/anulowanie: faktury z otwarta korekta nie anulujesz');

DO $$
DECLARE c public.event_invoices;
BEGIN
  PERFORM public.admin_event_invoice_issue(pg_temp.t27('corr_full'));
  SELECT * INTO c FROM public.event_invoices WHERE id = pg_temp.t27('corr_full');
  PERFORM pg_temp.assert(c.number = 'KOR/' || to_char(pg_temp.t27_today(), 'YYYY/MM') || '/0002',
    '27/korekta pelna: kolejny numer korekty');
  PERFORM pg_temp.assert(
    NOT EXISTS (SELECT 1 FROM public.event_invoice_sources WHERE invoice_id = pg_temp.t27('collective') AND released_at IS NULL)
    AND (SELECT count(*) FROM public.event_invoice_requests
          WHERE id IN (pg_temp.t27('req1'), pg_temp.t27('reqp')) AND status = 'pending' AND invoice_id IS NULL) = 2,
    '27/korekta pelna: zamowienia zwolnione, prosby wracaja do oczekujacych');
END $$;

SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_correction_create(jsonb_build_object('invoice_id', pg_temp.t27('collective'), 'mode', 'partial', 'reason', 'r'))$q$,
  'correction_exists', '27/korekta: po pelnej korekcie nic juz nie ma do korygowania');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_cancel(jsonb_build_object('id', pg_temp.t27('corr_full'), 'reason', 'Pomylka'))$q$,
  'correction_locked', '27/anulowanie: wystawionej pelnej korekty nie cofniesz (zamowienia juz zwolnione)');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_correction_create(jsonb_build_object('invoice_id', pg_temp.t27('corr_full'), 'mode', 'full', 'reason', 'r'))$q$,
  'correction_target_invalid', '27/korekta: korekty sie nie koryguje');

-- ---------------------------------------------------------------------------
-- 11) MASOWE WYSTAWIENIE ZBIORCZE Z PROSB
-- ---------------------------------------------------------------------------
DO $$
DECLARE v jsonb; i public.event_invoices;
BEGIN
  v := public.admin_event_invoice_issue_pending(
    '{"event_id":"27e00000-0000-0000-0000-0000000000e1","collective":true}');
  PERFORM pg_temp.assert(jsonb_array_length(v->'issued') = 1 AND jsonb_array_length(v->'failed') = 0
    AND jsonb_array_length(v->'issued'->0->'request_ids') = 2,
    '27/masowo: dwie prosby tej samej firmy (NIP) = JEDNA faktura zbiorcza');
  PERFORM pg_temp.t27_set('bulk', (v->'issued'->0->>'invoice_id')::uuid);
  SELECT * INTO i FROM public.event_invoices WHERE id = pg_temp.t27('bulk');
  PERFORM pg_temp.assert(i.status = 'issued' AND i.gross_cents = 74601
    AND i.number = 'FV/' || to_char(pg_temp.t27_today(), 'YYYY/MM') || '/0003' AND v->'issued'->0->>'number' = i.number
    AND i.po_number = 'PO-27B',
    '27/masowo: wystawiona, kolejny numer bez luki, nabywca z najstarszej prosby');
  v := public.admin_event_invoice_issue_pending(
    '{"event_id":"27e00000-0000-0000-0000-0000000000e1","collective":true}');
  PERFORM pg_temp.assert(v = '{"issued":[],"failed":[]}'::jsonb,
    '27/masowo: drugi przebieg nic nie dubluje');
END $$;

SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000b1', '27000000-0000-0000-0000-0000000000b0');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_issue_pending('{"event_id":"27e00000-0000-0000-0000-0000000000e1"}')$q$,
  'not_found', '27/masowo: admin innego najemcy');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_invoice_issue_pending('{"event_id":"27e00000-0000-0000-0000-0000000000eb"}')$q$,
  'invoicing_disabled', '27/masowo: bez wystawcy nic nie powstaje');

SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a3', '27000000-0000-0000-0000-0000000000a0');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_invoice_request_save('{"registration_id":"27400000-0000-0000-0000-000000000001","buyer":{"name":"Acme"}}')$q$,
  'already_invoiced', '27/prosba: zamowienie z faktura - prosby juz nie zmienisz');
SELECT pg_temp.assert(
  (SELECT invoice_number FROM public.event_my_invoice_sources()
    WHERE source_id = '27400000-0000-0000-0000-000000000001')
    = (SELECT number FROM public.event_invoices WHERE id = pg_temp.t27('bulk')),
  '27/moje zamowienia: numer wystawionej faktury przy zamowieniu');

-- ---------------------------------------------------------------------------
-- 12) ODCZYTY PANELU I KUPUJACEGO
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a1', '27000000-0000-0000-0000-0000000000a0');

DO $$
DECLARE n integer; r record; d jsonb; p jsonb;
BEGIN
  SELECT count(*) INTO n FROM public.admin_event_invoices_list('27e00000-0000-0000-0000-0000000000e1');
  PERFORM pg_temp.assert(n = 9, '27/lista: wszystkie dokumenty wydarzenia (takze szkice i anulowane)');
  SELECT * INTO r FROM public.admin_event_invoices_list('27e00000-0000-0000-0000-0000000000e1')
   WHERE id = pg_temp.t27('proforma');
  PERFORM pg_temp.assert(r.converted_invoice_id = pg_temp.t27('final2') AND r.source_count = 1,
    '27/lista: proforma wskazuje aktywna fakture koncowa');
  SELECT * INTO r FROM public.admin_event_invoices_list('27e00000-0000-0000-0000-0000000000e1')
   WHERE id = pg_temp.t27('corr_full');
  PERFORM pg_temp.assert(r.corrects_number = (SELECT number FROM public.event_invoices WHERE id = pg_temp.t27('collective'))
    AND r.correction_mode = 'full' AND r.source_count = 0,
    '27/lista: korekta z numerem faktury korygowanej');

  d := public.admin_event_invoice_get(pg_temp.t27('collective'));
  PERFORM pg_temp.assert(jsonb_array_length(d->'lines') = 3 AND jsonb_array_length(d->'sources') = 2
    AND jsonb_array_length(d->'corrections') = 2 AND jsonb_array_length(d->'vat_summary') = 1
    AND d->'vat_summary'->0->>'gross_cents' = '74601' AND d->'seller'->>'seller_name' = 'Organizator 27 Sp. z o.o.'
    AND d->>'footer_note' = 'Dziekujemy za udzial' AND NOT (d->'invoice' ? 'tenant_id')
    AND NOT (d->'invoice' ? 'seller') AND d->'invoice'->>'number' IS NOT NULL,
    '27/dokument: pozycje, zrodla, korekty, podsumowanie VAT, migawka sprzedawcy, bez tenant_id');
  d := public.admin_event_invoice_get(pg_temp.t27('corr_full'));
  PERFORM pg_temp.assert(d->'corrects'->>'number' = (SELECT number FROM public.event_invoices WHERE id = pg_temp.t27('collective')),
    '27/dokument: korekta niesie numer i daty faktury korygowanej');

  p := public.admin_event_invoice_notify_payload(pg_temp.t27('bulk'));
  PERFORM pg_temp.assert(p->>'recipient' = 'ksiegowosc@acme.example' AND p->>'has_account' = 'true'
    AND p->>'tenant_id' = '27000000-0000-0000-0000-0000000000a0' AND p->>'status' = 'issued'
    AND p->>'locale' = 'pl' AND p->>'number' IS NOT NULL,
    '27/mail: e-mail z faktury, konto kupujacego, jezyk dokumentu');
  p := public.admin_event_invoice_notify_payload(pg_temp.t27('proforma'));
  PERFORM pg_temp.assert(p->>'has_account' = 'false' AND p->>'recipient' = 'kolega@acme.example',
    '27/mail: bez konta - adres z dokumentu');
END $$;

SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_get('27400000-0000-0000-0000-00000000dead')$q$,
  'not_found', '27/dokument: nieznany');
SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a2', '27000000-0000-0000-0000-0000000000a0');
SELECT pg_temp.assert_raises_like($q$SELECT * FROM public.admin_event_invoices_list('27e00000-0000-0000-0000-0000000000e1')$q$,
  'forbidden', '27/lista: redaktor odbity');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_notify_payload(pg_temp.t27('bulk'))$q$,
  'forbidden', '27/mail: redaktor nie zbuduje ladunku');
SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000b1', '27000000-0000-0000-0000-0000000000b0');
SELECT pg_temp.assert((SELECT count(*) FROM public.admin_event_invoices_list('27e00000-0000-0000-0000-0000000000e1')) = 0,
  '27/lista: admin innego najemcy nie widzi dokumentow wydarzenia A');
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_notify_payload(pg_temp.t27('bulk'))$q$,
  'not_found', '27/mail: admin innego najemcy');

SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a3', '27000000-0000-0000-0000-0000000000a0');
DO $$
DECLARE d jsonb; r record;
BEGIN
  PERFORM pg_temp.assert((SELECT count(*) FROM public.event_my_invoices()) = 3
    AND NOT EXISTS (SELECT 1 FROM public.event_my_invoices() WHERE id = pg_temp.t27('corr_cancelled')),
    '27/moje dokumenty: zbiorcza, jej korekta i nowa zbiorcza - bez porzuconego szkicu');
  SELECT * INTO r FROM public.event_my_invoices() WHERE id = pg_temp.t27('corr_full');
  PERFORM pg_temp.assert(r.kind = 'correction' AND r.gross_cents = -74601
    AND r.corrects_number = (SELECT number FROM public.event_invoices WHERE id = pg_temp.t27('collective'))
    AND r.event_slug = 'kongres-27',
    '27/moje dokumenty: korekta z numerem korygowanej faktury');
  d := public.event_my_invoice(pg_temp.t27('collective'));
  PERFORM pg_temp.assert(NOT (d->'invoice' ? 'crm_company_id') AND NOT (d->'invoice' ? 'buyer_person_id')
    AND NOT (d->'invoice' ? 'buyer_user_id') AND NOT (d ? 'sources') AND jsonb_array_length(d->'lines') = 3,
    '27/moj dokument: pelna migawka do PDF bez wewnetrznych kluczy');
END $$;
SELECT pg_temp.assert_raises_like($q$SELECT public.event_my_invoice(pg_temp.t27('corr_cancelled'))$q$,
  'not_found', '27/moj dokument: anulowany SZKIC (bez numeru) nie jest dokumentem kupujacego');
SELECT pg_temp.assert_raises_like($q$SELECT public.event_my_invoice(pg_temp.t27('single'))$q$,
  'not_found', '27/moj dokument: cudzy dokument');

SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a5', '27000000-0000-0000-0000-0000000000a0');
SELECT pg_temp.assert((SELECT count(*) FROM public.event_my_invoices()) = 2
  AND (SELECT count(*) FROM public.event_my_invoices() WHERE kind = 'correction') = 1,
  '27/moje dokumenty: druga kupujaca widzi swoja fakture i korekte');
SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a4', '27000000-0000-0000-0000-0000000000a0');
SELECT pg_temp.assert((SELECT count(*) FROM public.event_my_invoices()) = 0,
  '27/moje dokumenty: obcy nie ma nic');
SELECT pg_temp.assert_raises_like($q$SELECT public.event_my_invoice(pg_temp.t27('bulk'))$q$,
  'not_found', '27/moj dokument: obcy nie czyta');
SELECT pg_temp.act_as(NULL, '27000000-0000-0000-0000-0000000000a0');
SELECT pg_temp.assert_raises_like($q$SELECT public.event_my_invoice(pg_temp.t27('bulk'))$q$,
  'not_found', '27/moj dokument: anonim nie czyta');
SELECT set_config('nes.public_tenant', '27000000-0000-0000-0000-0000000000b0', false);
SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a3', '27000000-0000-0000-0000-0000000000b0');
SELECT pg_temp.assert((SELECT count(*) FROM public.event_my_invoices()) = 0
  AND (SELECT count(*) FROM public.event_my_invoice_sources()) = 0,
  '27/moje dokumenty: na domenie innego najemcy nic');
SELECT set_config('nes.public_tenant', '27000000-0000-0000-0000-0000000000a0', false);

-- ---------------------------------------------------------------------------
-- 13) RLS: czytaja wylacznie admin/super_admin najemcy
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a1', '27000000-0000-0000-0000-0000000000a0');
SET ROLE authenticated;
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_invoices) = 9
  AND (SELECT count(*) FROM public.event_invoice_lines) > 0
  AND (SELECT count(*) FROM public.event_invoice_sources) > 0
  AND (SELECT count(*) FROM public.event_invoice_requests) = 3
  AND (SELECT count(*) FROM public.event_invoice_settings) = 1,
  '27/RLS: admin najemcy czyta swoje dokumenty, pozycje, zrodla, prosby i ustawienia');
SELECT pg_temp.assert_raises_like($q$SELECT count(*) FROM public.event_invoice_counters$q$,
  'permission denied', '27/RLS: licznika numeracji klient nie czyta wcale');
SELECT pg_temp.assert_raises_like(
  $q$UPDATE public.event_invoices SET note = 'x' WHERE id = pg_temp.t27('final2')$q$,
  'permission denied', '27/RLS: zapis tylko przez RPC, nawet dla admina');
RESET ROLE;

SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a2', '27000000-0000-0000-0000-0000000000a0');
SET ROLE authenticated;
SELECT pg_temp.assert((SELECT count(*) FROM public.event_invoices) = 0
  AND (SELECT count(*) FROM public.event_invoice_settings) = 0,
  '27/RLS: redaktor nie czyta dokumentow ani danych wystawcy');
RESET ROLE;

SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000a3', '27000000-0000-0000-0000-0000000000a0');
SET ROLE authenticated;
SELECT pg_temp.assert((SELECT count(*) FROM public.event_invoices) = 0
  AND (SELECT count(*) FROM public.event_invoice_requests) = 0,
  '27/RLS: kupujacy czyta swoje dokumenty WYLACZNIE przez RPC (bez kluczy CRM)');
RESET ROLE;

SELECT pg_temp.act_as('27a00000-0000-0000-0000-0000000000b1', '27000000-0000-0000-0000-0000000000b0');
SET ROLE authenticated;
SELECT pg_temp.assert((SELECT count(*) FROM public.event_invoices) = 0
  AND (SELECT count(*) FROM public.event_invoice_lines) = 0,
  '27/RLS: admin najemcy B nie czyta dokumentow najemcy A');
RESET ROLE;

SELECT pg_temp.assert(
  (SELECT bool_and(c.relrowsecurity) FROM pg_class c
    WHERE c.oid IN ('public.event_invoice_settings'::regclass, 'public.event_invoice_counters'::regclass,
                    'public.event_invoices'::regclass, 'public.event_invoice_requests'::regclass,
                    'public.event_invoice_sources'::regclass, 'public.event_invoice_lines'::regclass)),
  '27/RLS: wlaczony na wszystkich szesciu tabelach');
SELECT pg_temp.assert(
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'event_invoice%') = 5
  AND (SELECT bool_and(cmd = 'SELECT' AND qual LIKE '%is_super_admin%' AND qual NOT LIKE '%editor%'
                       AND roles = '{authenticated}')
         FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'event_invoice%'),
  '27/RLS: wylacznie polityki ODCZYTU admin/super_admin dla zalogowanych, licznik bez polityki');

SELECT pg_temp.act_as(NULL, NULL);
ROLLBACK;
