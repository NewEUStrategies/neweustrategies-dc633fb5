-- ============================================================================
-- 27_invoices_compliance - FAKTURY WYDARZEN PO AUDYCIE ROZLICZEN (2026-10-12)
--
-- PO CO TEN PLIK ISTNIEJE
-- Migracje 20261012095900 i 20261012100000..100600 naprawiaja ustalenia
-- audytu INV-02, 05, 06, 08, 09, 12, 14, 15, 16 i 17. Kazde z nich mialo
-- KRYTERIUM ODBIORU "test w harnessie" - ten plik jest tym testem. Logika
-- siedzi w bazie (SECURITY DEFINER + triggery), wiec dowodem jest wykonanie
-- na prawdziwym PostgreSQL, nie lektura.
--
-- CO SPRAWDZA (sekcja = ustalenie)
--   A  INV-09  plaszczyzna rozliczen stemplowana na zamowieniu przy INSERT,
--              niezmienna; zmiana ustawien kasy PO zamowieniu nic nie zmienia.
--   B  INV-16  VAT od SUMY brutto w stawce (3 x 0,61 zl = 149 + 34, nie
--              150 + 33), korekta jako roznica stanu, suma = stan koncowy.
--   C  INV-02  KSeF jednokierunkowy: accepted -> pending = invalid_transition
--              (RPC i trigger), numer niezmienny, dziennik append-only.
--      INV-17  format numeru (NIP sprzedawcy, data), unikalnosc w najemcy,
--              korekta niesie numer KSeF faktury korygowanej, korekta faktury
--              czekajacej na KSeF - odmowa.
--   D  INV-08  anulowanie odrzucone po mailu albo pobraniu przez nabywce.
--   E  INV-06  faktura w EUR bez kursu = fx_rate_required z dniem kursu; z
--              kursem - kurs, tabela, data i VAT w PLN; korekta dziedziczy kurs.
--   F  INV-12  "np" bez podstawy = odmowa; odwrotne obciazenie wymaga VIES
--              (zmiana nabywcy kasuje weryfikacje); "np" + 23% = odmowa.
--   G  INV-14  oplacony zapis bez zaksiegowanej wplaty = odmowa; wplata inna
--              niz pozycje = amount_mismatch; zaksiegowana kwota na fakturze.
--   H  INV-15  termin prosby od pozniejszej z dat zaplaty i wydarzenia.
--   I  INV-05  zwrot po fakturze: szkic korekty (pelnej, czesciowej) albo
--              alarm o korekcie recznej - zawsze z powiadomieniem
--              administratorow najemcy (nie redaktora, nie obcego najemcy).
--
-- SPRZATANIE: caly plik siedzi w BEGIN ... ROLLBACK.
-- ============================================================================

\echo '== 27b faktury wydarzen: zgodnosc po audycie (KSeF, NBP, VAT od sumy, VIES, wplata, zwrot) =='

BEGIN;

CREATE FUNCTION pg_temp.c27(_k text) RETURNS uuid
LANGUAGE sql STABLE AS $f$ SELECT NULLIF(current_setting('nes.c27_' || _k, true), '')::uuid $f$;
CREATE FUNCTION pg_temp.c27_set(_k text, _v uuid) RETURNS uuid
LANGUAGE sql AS $f$ SELECT set_config('nes.c27_' || _k, _v::text, false)::uuid $f$;
CREATE FUNCTION pg_temp.c27_today() RETURNS date
LANGUAGE sql STABLE AS $f$ SELECT (now() AT TIME ZONE 'Europe/Warsaw')::date $f$;

-- Szkic z jednego zrodla z jawnym nabywca (polska firma albo podany).
CREATE FUNCTION pg_temp.c27_draft(_kind text, _id uuid, _doc text DEFAULT 'invoice', _buyer jsonb DEFAULT NULL)
RETURNS uuid LANGUAGE sql AS $f$
  SELECT public.admin_event_invoice_draft_create(jsonb_build_object(
    'event_id', '2be00000-0000-0000-0000-0000000000e1', 'kind', _doc,
    'sources', jsonb_build_array(jsonb_build_object('kind', _kind, 'id', _id)),
    'buyer', COALESCE(_buyer, '{"is_company":true,"name":"Acme Sp. z o.o.","tax_id":"5260250274",
                               "address":"ul. Morska 5","postal_code":"80-001","city":"Gdansk"}'::jsonb)))
$f$;

-- Pozycje dokumentu w zwartym zapisie: "ILOSCxCENA@STAWKA;...".
CREATE FUNCTION pg_temp.c27_lines(_id uuid) RETURNS text
LANGUAGE sql STABLE AS $f$
  SELECT string_agg(l.quantity || 'x' || l.unit_gross_cents || '@' || l.vat_rate, ';' ORDER BY l.position)
    FROM public.event_invoice_lines l WHERE l.invoice_id = _id
$f$;

CREATE FUNCTION pg_temp.c27_ksef(_date date) RETURNS text
LANGUAGE sql IMMUTABLE AS $f$ SELECT '7011278375-' || to_char(_date, 'YYYYMMDD') || '-0A1B2C3D4E5F-7A' $f$;

-- ---------------------------------------------------------------------------
-- SCENOGRAFIA
-- ---------------------------------------------------------------------------
INSERT INTO public.tenants (id, name, slug) VALUES
  ('2b000000-0000-0000-0000-0000000000a0', 'Tenant 27b (zgodnosc)', 't27b-fv'),
  ('2b000000-0000-0000-0000-0000000000b0', 'Tenant 27b B', 't27b-fv-b')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.users (id, email) VALUES
  ('2ba00000-0000-0000-0000-0000000000a1', 'admin27b@org27b.example'),
  ('2ba00000-0000-0000-0000-0000000000a2', 'redaktor27b@org27b.example'),
  ('2ba00000-0000-0000-0000-0000000000a3', 'kupujacy27b@acme.example'),
  ('2ba00000-0000-0000-0000-0000000000a8', 'super27b@org27b.example'),
  ('2ba00000-0000-0000-0000-0000000000b1', 'admin27bb@orgb.example')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id) VALUES
  ('2ba00000-0000-0000-0000-0000000000a1', '2b000000-0000-0000-0000-0000000000a0'),
  ('2ba00000-0000-0000-0000-0000000000a2', '2b000000-0000-0000-0000-0000000000a0'),
  ('2ba00000-0000-0000-0000-0000000000a3', '2b000000-0000-0000-0000-0000000000a0'),
  ('2ba00000-0000-0000-0000-0000000000a8', '2b000000-0000-0000-0000-0000000000a0'),
  ('2ba00000-0000-0000-0000-0000000000b1', '2b000000-0000-0000-0000-0000000000b0')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role, tenant_id) VALUES
  ('2ba00000-0000-0000-0000-0000000000a1', 'admin', '2b000000-0000-0000-0000-0000000000a0'),
  ('2ba00000-0000-0000-0000-0000000000a2', 'editor', '2b000000-0000-0000-0000-0000000000a0'),
  ('2ba00000-0000-0000-0000-0000000000a8', 'super_admin', '2b000000-0000-0000-0000-0000000000a0'),
  ('2ba00000-0000-0000-0000-0000000000b1', 'admin', '2b000000-0000-0000-0000-0000000000b0');

INSERT INTO public.events
  (id, tenant_id, slug, title_pl, title_en, starts_at, status, registration_mode, registration_flow, capacity)
VALUES
  ('2be00000-0000-0000-0000-0000000000e1', '2b000000-0000-0000-0000-0000000000a0',
   'forum-27b', 'Forum 27b', 'Forum 27b', now() + interval '30 days', 'published', 'form', 'instant', NULL),
  ('2be00000-0000-0000-0000-0000000000e2', '2b000000-0000-0000-0000-0000000000a0',
   'forum-27b-dawne', 'Forum dawne', 'Old forum', now() - interval '200 days', 'published', 'form', 'instant', NULL);

INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, min_tier_rank, requires_approval, is_active, sort_order,
   group_registration_enabled, group_max_size, tax_mode)
VALUES
  ('2b100000-0000-0000-0000-000000000001', '2b000000-0000-0000-0000-0000000000a0',
   '2be00000-0000-0000-0000-0000000000e1', 'standard', 'Standard', 'Standard', 12300, 'PLN',
   NULL, 0, false, true, 10, true, 10, 'inclusive'),
  ('2b100000-0000-0000-0000-000000000002', '2b000000-0000-0000-0000-0000000000a0',
   '2be00000-0000-0000-0000-0000000000e1', 'euro', 'Euro', 'Euro', 10000, 'EUR',
   NULL, 0, false, true, 20, false, 10, 'inclusive'),
  ('2b100000-0000-0000-0000-000000000003', '2b000000-0000-0000-0000-0000000000a0',
   '2be00000-0000-0000-0000-0000000000e2', 'dawny', 'Dawny', 'Old', 12300, 'PLN',
   NULL, 0, false, true, 10, false, 10, 'inclusive');

INSERT INTO public.event_ticket_packages
  (id, tenant_id, event_id, ticket_type_id, key, name_pl, name_en, seats, price_cents, currency)
VALUES
  ('2b800000-0000-0000-0000-000000000001', '2b000000-0000-0000-0000-0000000000a0',
   '2be00000-0000-0000-0000-0000000000e1', '2b100000-0000-0000-0000-000000000001',
   'firma3', 'Firmowy 3', 'Company 3', 3, 30000, 'PLN');

INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name) VALUES
  ('2b300000-0000-0000-0000-000000000003', '2b000000-0000-0000-0000-0000000000a0',
   '2ba00000-0000-0000-0000-0000000000a3', 'kupujacy27b@acme.example', 'Anna', 'Kupujaca'),
  ('2b300000-0000-0000-0000-000000000010', '2b000000-0000-0000-0000-0000000000a0', NULL, 'p10@example.org', 'Piotr', 'Dziesiec'),
  ('2b300000-0000-0000-0000-000000000011', '2b000000-0000-0000-0000-0000000000a0', NULL, 'p11@example.org', 'Ola', 'Jedenascie'),
  ('2b300000-0000-0000-0000-000000000012', '2b000000-0000-0000-0000-0000000000a0', NULL, 'p12@example.org', 'Kuba', 'Dwanascie'),
  ('2b300000-0000-0000-0000-000000000013', '2b000000-0000-0000-0000-0000000000a0', NULL, 'p13@example.org', 'Ewa', 'Trzynascie'),
  ('2b300000-0000-0000-0000-000000000014', '2b000000-0000-0000-0000-0000000000a0', NULL, 'p14@example.org', 'Jan', 'Czternascie'),
  ('2b300000-0000-0000-0000-000000000015', '2b000000-0000-0000-0000-0000000000a0', NULL, 'p15@example.org', 'Iza', 'Pietnascie'),
  ('2b300000-0000-0000-0000-000000000016', '2b000000-0000-0000-0000-0000000000a0', NULL, 'p16@example.org', 'Lew', 'Szesnascie'),
  ('2b300000-0000-0000-0000-000000000017', '2b000000-0000-0000-0000-0000000000a0', NULL, 'p17@example.org', 'Ida', 'Siedemnascie'),
  ('2b300000-0000-0000-0000-000000000018', '2b000000-0000-0000-0000-0000000000a0', NULL, 'p18@example.org', 'Max', 'Osiemnascie'),
  ('2b300000-0000-0000-0000-000000000019', '2b000000-0000-0000-0000-0000000000a0', NULL, 'p19@example.org', 'Zoe', 'Dziewietnascie'),
  ('2b300000-0000-0000-0000-000000000020', '2b000000-0000-0000-0000-0000000000a0', NULL, 'p20@example.org', 'Tom', 'Dwadziescia'),
  ('2b300000-0000-0000-0000-000000000021', '2b000000-0000-0000-0000-0000000000a0', NULL, 'p21@example.org', 'Gil', 'Gosc'),
  ('2b300000-0000-0000-0000-000000000022', '2b000000-0000-0000-0000-0000000000a0', NULL, 'p22@example.org', 'Ula', 'Nieoplacona'),
  ('2b300000-0000-0000-0000-000000000024', '2b000000-0000-0000-0000-0000000000a0', NULL, 'p24@example.org', 'Rafal', 'Trzy');

-- Kasa: wlasne konto (Stripe Tax), bez faktur Stripe - ZANIM powstana zamowienia.
INSERT INTO public.checkout_settings (tenant_id, automatic_tax, invoice_creation, updated_at)
VALUES ('2b000000-0000-0000-0000-0000000000a0', true, false, now() - interval '1 day');

SELECT set_config('nes.public_tenant', '2b000000-0000-0000-0000-0000000000a0', false);
SELECT pg_temp.act_as('2ba00000-0000-0000-0000-0000000000a1', '2b000000-0000-0000-0000-0000000000a0');
SELECT public.admin_event_invoice_settings_save(
  '{"enabled":true,"confirm_seller":true,"seller_name":"Organizator 27b Sp. z o.o.",
    "seller_tax_id":"7011278375","seller_address":"ul. Dluga 1","seller_postal_code":"00-001",
    "seller_city":"Warszawa","seller_bank_account":"PL61109010140000071219812874"}'::jsonb);

-- ---------------------------------------------------------------------------
-- A) INV-09: PLASZCZYZNA ROZLICZEN STEMPLOWANA NA ZAMOWIENIU
-- ---------------------------------------------------------------------------
-- O1 (3 x 0,61 zl, karta), O2 (karta, zwrot czesciowy), O3 (karta, zwrot
-- pelny), O4 (karta, zwrot niejednoznaczny), O5 (EUR).
INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, paid_at, metadata) VALUES
  ('2b600000-0000-0000-0000-000000000001', '2b000000-0000-0000-0000-0000000000a0',
   '2ba00000-0000-0000-0000-0000000000a3', 'paid', 183, 'PLN', now(), '{"quantity":3}'),
  ('2b600000-0000-0000-0000-000000000002', '2b000000-0000-0000-0000-0000000000a0',
   '2ba00000-0000-0000-0000-0000000000a3', 'paid', 12300, 'PLN', now(), '{"quantity":2}'),
  ('2b600000-0000-0000-0000-000000000003', '2b000000-0000-0000-0000-0000000000a0',
   '2ba00000-0000-0000-0000-0000000000a3', 'paid', 12300, 'PLN', now(), '{"quantity":1}'),
  ('2b600000-0000-0000-0000-000000000004', '2b000000-0000-0000-0000-0000000000a0',
   '2ba00000-0000-0000-0000-0000000000a3', 'paid', 12300, 'PLN', now(), '{"quantity":1}'),
  ('2b600000-0000-0000-0000-000000000005', '2b000000-0000-0000-0000-0000000000a0',
   '2ba00000-0000-0000-0000-0000000000a3', 'paid', 10000, 'EUR', now() - interval '3 days', '{"quantity":1}');

SELECT pg_temp.assert(
  (SELECT bool_and(billing_plane = 'merchant' AND NOT operator_invoice) FROM public.payment_orders
    WHERE tenant_id = '2b000000-0000-0000-0000-0000000000a0'),
  '27b/plaszczyzna: zamowienie z kasy na wlasnym koncie bez faktur Stripe = merchant, bez dokumentu operatora');

-- Przelaczenie kasy na operatora PO zamowieniu: stempel zostaje, organizator
-- moze fakturowac (dawniej billing_plane_unknown - INV-09).
UPDATE public.checkout_settings SET automatic_tax = false, updated_at = clock_timestamp()
 WHERE tenant_id = '2b000000-0000-0000-0000-0000000000a0';
SELECT pg_temp.assert(
  public._event_invoice_card_block('2b000000-0000-0000-0000-0000000000a0', '2b600000-0000-0000-0000-000000000001') IS NULL,
  '27b/plaszczyzna: zmiana ustawien kasy PO zamowieniu nie blokuje faktury (stempel z chwili zamowienia)');
INSERT INTO public.payment_orders (id, tenant_id, user_id, status, amount_cents, currency, paid_at, billing_plane, operator_invoice) VALUES
  ('2b600000-0000-0000-0000-000000000009', '2b000000-0000-0000-0000-0000000000a0',
   '2ba00000-0000-0000-0000-0000000000a3', 'paid', 12300, 'PLN', now(), 'merchant', false);
SELECT pg_temp.assert(
  (SELECT billing_plane || '|' || operator_invoice::text FROM public.payment_orders
    WHERE id = '2b600000-0000-0000-0000-000000000009') = 'managed|true',
  '27b/plaszczyzna: deklaracja klienta przy INSERT ignorowana - stempel z ustawien kasy (operator)');
UPDATE public.checkout_settings SET automatic_tax = true, updated_at = clock_timestamp()
 WHERE tenant_id = '2b000000-0000-0000-0000-0000000000a0';
SELECT pg_temp.assert(
  public._event_invoice_card_block('2b000000-0000-0000-0000-0000000000a0', '2b600000-0000-0000-0000-000000000009')
    = 'mor_seller_conflict',
  '27b/plaszczyzna: zamowienie sprzedane przez operatora zostaje operatora mimo powrotu kasy na wlasne konto');
UPDATE public.payment_orders SET billing_plane = 'merchant', operator_invoice = false
 WHERE id = '2b600000-0000-0000-0000-000000000009';
SELECT pg_temp.assert(
  (SELECT billing_plane FROM public.payment_orders WHERE id = '2b600000-0000-0000-0000-000000000009') = 'managed',
  '27b/plaszczyzna: stempel niezmienny przy UPDATE');

-- Zapisy (lead) - karta, przelew, EUR, pakiet.
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
   payment_status, payment_order_id, paid_at, created_by, source)
VALUES
  ('2b400000-0000-0000-0000-000000000001', '2b000000-0000-0000-0000-0000000000a0', '2be00000-0000-0000-0000-0000000000e1',
   '2b300000-0000-0000-0000-000000000024', '2b100000-0000-0000-0000-000000000001', 'approved', 'form', 'paid',
   '2b600000-0000-0000-0000-000000000001', now(), '2ba00000-0000-0000-0000-0000000000a3', 'self_registration'),
  ('2b400000-0000-0000-0000-000000000002', '2b000000-0000-0000-0000-0000000000a0', '2be00000-0000-0000-0000-0000000000e1',
   '2b300000-0000-0000-0000-000000000010', '2b100000-0000-0000-0000-000000000001', 'approved', 'form', 'paid',
   '2b600000-0000-0000-0000-000000000002', now(), NULL, 'organizer'),
  ('2b400000-0000-0000-0000-000000000003', '2b000000-0000-0000-0000-0000000000a0', '2be00000-0000-0000-0000-0000000000e1',
   '2b300000-0000-0000-0000-000000000011', '2b100000-0000-0000-0000-000000000001', 'approved', 'form', 'paid',
   '2b600000-0000-0000-0000-000000000003', now(), NULL, 'organizer'),
  ('2b400000-0000-0000-0000-000000000004', '2b000000-0000-0000-0000-0000000000a0', '2be00000-0000-0000-0000-0000000000e1',
   '2b300000-0000-0000-0000-000000000012', '2b100000-0000-0000-0000-000000000001', 'approved', 'form', 'paid',
   '2b600000-0000-0000-0000-000000000004', now(), NULL, 'organizer'),
  ('2b400000-0000-0000-0000-000000000005', '2b000000-0000-0000-0000-0000000000a0', '2be00000-0000-0000-0000-0000000000e1',
   '2b300000-0000-0000-0000-000000000013', '2b100000-0000-0000-0000-000000000002', 'approved', 'form', 'paid',
   '2b600000-0000-0000-0000-000000000005', now() - interval '3 days', NULL, 'organizer'),
  -- R10..R14: przelewy bez karty (KSeF, doreczenie, wplata, np, zwrot przelewu).
  ('2b400000-0000-0000-0000-000000000010', '2b000000-0000-0000-0000-0000000000a0', '2be00000-0000-0000-0000-0000000000e1',
   '2b300000-0000-0000-0000-000000000014', '2b100000-0000-0000-0000-000000000001', 'approved', 'form', 'paid',
   NULL, now(), NULL, 'organizer'),
  ('2b400000-0000-0000-0000-000000000011', '2b000000-0000-0000-0000-0000000000a0', '2be00000-0000-0000-0000-0000000000e1',
   '2b300000-0000-0000-0000-000000000015', '2b100000-0000-0000-0000-000000000001', 'approved', 'form', 'paid',
   NULL, now(), NULL, 'organizer'),
  ('2b400000-0000-0000-0000-000000000012', '2b000000-0000-0000-0000-0000000000a0', '2be00000-0000-0000-0000-0000000000e1',
   '2b300000-0000-0000-0000-000000000016', '2b100000-0000-0000-0000-000000000001', 'approved', 'form', 'paid',
   NULL, now(), NULL, 'organizer'),
  ('2b400000-0000-0000-0000-000000000013', '2b000000-0000-0000-0000-0000000000a0', '2be00000-0000-0000-0000-0000000000e1',
   '2b300000-0000-0000-0000-000000000017', '2b100000-0000-0000-0000-000000000001', 'approved', 'form', 'paid',
   NULL, now(), NULL, 'organizer'),
  ('2b400000-0000-0000-0000-000000000014', '2b000000-0000-0000-0000-0000000000a0', '2be00000-0000-0000-0000-0000000000e1',
   '2b300000-0000-0000-0000-000000000018', '2b100000-0000-0000-0000-000000000001', 'approved', 'form', 'paid',
   NULL, now(), NULL, 'organizer'),
  ('2b400000-0000-0000-0000-000000000015', '2b000000-0000-0000-0000-0000000000a0', '2be00000-0000-0000-0000-0000000000e1',
   '2b300000-0000-0000-0000-000000000019', '2b100000-0000-0000-0000-000000000001', 'approved', 'form', 'paid',
   NULL, now(), NULL, 'organizer'),
  -- R20: kupujacy a3 zaplacil 5 miesiecy temu za wydarzenie za 30 dni (INV-15).
  ('2b400000-0000-0000-0000-000000000020', '2b000000-0000-0000-0000-0000000000a0', '2be00000-0000-0000-0000-0000000000e1',
   '2b300000-0000-0000-0000-000000000003', '2b100000-0000-0000-0000-000000000001', 'approved', 'form', 'paid',
   NULL, now() - interval '5 months', '2ba00000-0000-0000-0000-0000000000a3', 'self_registration'),
  -- R22: nieoplacony zapis (wplata do zaksiegowania niemozliwa).
  ('2b400000-0000-0000-0000-000000000022', '2b000000-0000-0000-0000-0000000000a0', '2be00000-0000-0000-0000-0000000000e1',
   '2b300000-0000-0000-0000-000000000022', '2b100000-0000-0000-0000-000000000001', 'pending', 'form', 'unpaid',
   NULL, NULL, NULL, 'organizer'),
  -- R23: zaplata 5 miesiecy temu za wydarzenie sprzed 200 dni (INV-15: po terminie).
  ('2b400000-0000-0000-0000-000000000023', '2b000000-0000-0000-0000-0000000000a0', '2be00000-0000-0000-0000-0000000000e2',
   '2b300000-0000-0000-0000-000000000003', '2b100000-0000-0000-0000-000000000003', 'approved', 'form', 'paid',
   NULL, now() - interval '5 months', '2ba00000-0000-0000-0000-0000000000a3', 'self_registration');

-- R21: gosc grupy R10 (rozliczany przez prowadzacego).
INSERT INTO public.event_registrations
  (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
   payment_status, paid_at, group_lead_registration_id)
VALUES
  ('2b400000-0000-0000-0000-000000000021', '2b000000-0000-0000-0000-0000000000a0', '2be00000-0000-0000-0000-0000000000e1',
   '2b300000-0000-0000-0000-000000000021', '2b100000-0000-0000-0000-000000000001', 'approved', 'form', 'paid', now(),
   '2b400000-0000-0000-0000-000000000015');

INSERT INTO public.event_package_orders
  (id, tenant_id, event_id, package_id, buyer_user_id, buyer_person_id, buyer_email,
   buyer_name, seats_total, status, amount_cents, currency, paid_at)
VALUES
  ('2b900000-0000-0000-0000-000000000001', '2b000000-0000-0000-0000-0000000000a0',
   '2be00000-0000-0000-0000-0000000000e1', '2b800000-0000-0000-0000-000000000001',
   '2ba00000-0000-0000-0000-0000000000a3', '2b300000-0000-0000-0000-000000000003',
   'kupujacy27b@acme.example', 'Anna Kupujaca', 3, 'paid', 30000, 'PLN', now());

-- ---------------------------------------------------------------------------
-- B) INV-16: VAT OD SUMY BRUTTO W STAWCE
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_inv uuid; v_cor uuid; i public.event_invoices; c public.event_invoices; v_line uuid;
BEGIN
  v_inv := pg_temp.c27_draft('registration', '2b400000-0000-0000-0000-000000000001');
  -- Trzy pozycje po 0,61 zl w 23%: kazda ma netto 0,50 (suma 1,50), ale
  -- podatek liczy sie od SUMY 1,83 -> netto 1,49, VAT 0,34.
  PERFORM public.admin_event_invoice_draft_update(jsonb_build_object('id', v_inv, 'lines',
    '[{"description":"Bilet A","unit":"szt.","quantity":1,"unit_gross_cents":61,"vat_rate":"23"},
      {"description":"Bilet B","unit":"szt.","quantity":1,"unit_gross_cents":61,"vat_rate":"23"},
      {"description":"Bilet C","unit":"szt.","quantity":1,"unit_gross_cents":61,"vat_rate":"23"}]'::jsonb));
  SELECT * INTO i FROM public.event_invoices WHERE id = v_inv;
  PERFORM pg_temp.assert(i.net_cents = 149 AND i.vat_cents = 34 AND i.gross_cents = 183
    AND (SELECT sum(net_cents) FROM public.event_invoice_lines WHERE invoice_id = v_inv) = 150,
    '27b/VAT od sumy: 3 x 0,61 zl = netto 1,49 + VAT 0,34 (suma netto pozycji 1,50 nie decyduje)');
  PERFORM pg_temp.assert(i.vat_summary = '[{"vat_rate":"23","net_cents":149,"vat_cents":34,"gross_cents":183}]'::jsonb,
    '27b/VAT od sumy: podsumowanie stawek zamrozone na szkicu');
  PERFORM public.admin_event_invoice_issue(v_inv);
  PERFORM pg_temp.c27_set('b_inv', v_inv);
  PERFORM pg_temp.assert((SELECT vat_summary->0->>'vat_cents' FROM public.event_invoices WHERE id = v_inv) = '34',
    '27b/VAT od sumy: wystawiona faktura niesie podsumowanie od sumy');
  -- Korekta usuwa jedna pozycje: roznica stanu (1,83 -> 1,22): netto
  -- 1,49 -> 0,99 (-0,50), VAT 0,34 -> 0,23 (-0,11).
  SELECT l.id INTO v_line FROM public.event_invoice_lines l WHERE l.invoice_id = v_inv AND l.position = 1;
  v_cor := public.admin_event_invoice_correction_create(jsonb_build_object(
    'invoice_id', v_inv, 'mode', 'partial', 'reason', 'Rezygnacja jednej osoby',
    'lines', jsonb_build_array(jsonb_build_object('line_id', v_line, 'quantity', 0))));
  SELECT * INTO c FROM public.event_invoices WHERE id = v_cor;
  PERFORM pg_temp.assert(c.net_cents = -50 AND c.vat_cents = -11 AND c.gross_cents = -61,
    '27b/VAT od sumy: korekta = roznica stanu w stawce (po - przed)');
  PERFORM pg_temp.assert(
    (SELECT (d->'rate_gross_before'->>'23')::bigint FROM public.admin_event_invoice_get(v_cor) AS d) = 183,
    '27b/VAT od sumy: panel dostaje brutto stanu PRZED szkicem korekty (podglad liczy roznice)');
  PERFORM public.admin_event_invoice_issue(v_cor);
  PERFORM pg_temp.assert(
    (SELECT sum(net_cents) || '/' || sum(vat_cents) || '/' || sum(gross_cents) FROM public.event_invoices
      WHERE id IN (v_inv, v_cor)) = '99/23/122',
    '27b/VAT od sumy: faktura + korekta = podatek stanu koncowego (1,22 -> 0,99 + 0,23)');
END $$;

-- ---------------------------------------------------------------------------
-- C) INV-02 / INV-17: KSeF
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_inv uuid;
BEGIN
  v_inv := pg_temp.c27_draft('registration', '2b400000-0000-0000-0000-000000000002');
  PERFORM public.admin_event_invoice_issue(v_inv);
  PERFORM pg_temp.c27_set('c_inv', v_inv);
  PERFORM pg_temp.assert((SELECT ksef_status FROM public.event_invoices WHERE id = v_inv) = 'pending',
    '27b/KSeF: faktura sprzedawcy z PL czeka na wyslanie');
END $$;

SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_invoice_ksef_update(jsonb_build_object('id', %L::uuid, 'status', 'accepted', 'number', %L))$q$,
  pg_temp.c27('c_inv'), '5260250274-' || to_char(pg_temp.c27_today(), 'YYYYMMDD') || '-0A1B2C3D4E5F-7A'),
  'invalid_ksef_number', '27b/KSeF: numer z NIP-em innym niz sprzedawcy');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_invoice_ksef_update(jsonb_build_object('id', %L::uuid, 'status', 'accepted', 'number', %L))$q$,
  pg_temp.c27('c_inv'), '7011278375-20261340-0A1B2C3D4E5F-7A'),
  'invalid_ksef_number', '27b/KSeF: numer z nieistniejaca data');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_invoice_ksef_update(jsonb_build_object('id', %L::uuid, 'status', 'accepted', 'number', %L))$q$,
  pg_temp.c27('c_inv'), pg_temp.c27_ksef(pg_temp.c27_today() + 5)),
  'invalid_ksef_number', '27b/KSeF: numer z data przyjecia z przyszlosci');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_invoice_ksef_update(jsonb_build_object('id', %L::uuid, 'status', 'accepted', 'number', %L))$q$,
  pg_temp.c27('c_inv'), '7011278375-' || to_char(pg_temp.c27_today(), 'YYYYMMDD') || '-0A1B2C-7A'),
  'invalid_ksef_number', '27b/KSeF: numer bez 12 znakow szesnastkowych');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_invoice_ksef_update(jsonb_build_object('id', %L::uuid, 'status', 'sent', 'number', %L))$q$,
  pg_temp.c27('c_inv'), pg_temp.c27_ksef(pg_temp.c27_today())),
  'ksef_number_requires_accepted', '27b/KSeF: numer nadaje KSeF przy przyjeciu');

DO $$
DECLARE v_inv uuid := pg_temp.c27('c_inv'); e record; n integer;
BEGIN
  PERFORM public.admin_event_invoice_ksef_update(jsonb_build_object(
    'id', v_inv, 'status', 'sent', 'note', 'Wyslano z programu FK'));
  SELECT * INTO e FROM public.event_invoice_ksef_events
   WHERE invoice_id = v_inv ORDER BY created_at DESC, id DESC LIMIT 1;
  PERFORM pg_temp.assert(e.from_status = 'pending' AND e.to_status = 'sent'
    AND e.actor_id = '2ba00000-0000-0000-0000-0000000000a1' AND e.note = 'Wyslano z programu FK',
    '27b/KSeF: dziennik zapisuje przejscie, autora i notatke');
END $$;

SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_invoice_ksef_update(jsonb_build_object('id', %L::uuid, 'status', 'pending'))$q$,
  pg_temp.c27('c_inv')),
  'invalid_transition', '27b/KSeF: sent -> pending niedozwolone');

DO $$
DECLARE v_inv uuid := pg_temp.c27('c_inv');
BEGIN
  PERFORM public.admin_event_invoice_ksef_update(jsonb_build_object(
    'id', v_inv, 'status', 'accepted', 'number', lower(pg_temp.c27_ksef(pg_temp.c27_today()))));
  PERFORM pg_temp.assert(
    (SELECT ksef_status || '|' || ksef_number FROM public.event_invoices WHERE id = v_inv)
      = 'accepted|' || pg_temp.c27_ksef(pg_temp.c27_today()),
    '27b/KSeF: przyjety z numerem (znormalizowanym)');
END $$;

-- KRYTERIUM INV-02: accepted -> pending = invalid_transition.
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_invoice_ksef_update(jsonb_build_object('id', %L::uuid, 'status', 'pending'))$q$,
  pg_temp.c27('c_inv')),
  'invalid_transition', '27b/KSeF: accepted -> pending = invalid_transition (accepted jest terminalne)');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_invoice_ksef_update(jsonb_build_object('id', %L::uuid, 'status', 'rejected'))$q$,
  pg_temp.c27('c_inv')),
  'invalid_transition', '27b/KSeF: accepted -> rejected niedozwolone');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_invoice_ksef_update(jsonb_build_object('id', %L::uuid, 'status', 'accepted', 'number', %L))$q$,
  pg_temp.c27('c_inv'), pg_temp.c27_ksef(pg_temp.c27_today() - 1)),
  'ksef_number_immutable', '27b/KSeF: numeru KSeF nie da sie podmienic');
-- Trigger pilnuje tego samego takze poza RPC (service_role, reczny SQL).
SELECT pg_temp.assert_raises_like(format(
  $q$UPDATE public.event_invoices SET ksef_status = 'pending' WHERE id = %L$q$, pg_temp.c27('c_inv')),
  'invalid_transition', '27b/KSeF: trigger odrzuca cofniecie stanu z pominieciem RPC');
SELECT pg_temp.assert_raises_like(format(
  $q$UPDATE public.event_invoices SET ksef_number = NULL WHERE id = %L$q$, pg_temp.c27('c_inv')),
  'ksef_number_immutable', '27b/KSeF: trigger odrzuca wyczyszczenie numeru');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_invoice_cancel(jsonb_build_object('id', %L::uuid, 'reason', 'Pomylka'))$q$,
  pg_temp.c27('c_inv')),
  'ksef_locked', '27b/KSeF: faktury przyjetej w KSeF nie anulujesz - zostaje korekta');
SELECT pg_temp.assert(
  (SELECT string_agg(COALESCE(from_status, '-') || '>' || to_status, ',' ORDER BY created_at, id)
     FROM public.event_invoice_ksef_events WHERE invoice_id = pg_temp.c27('c_inv')) = '->pending,pending>sent,sent>accepted',
  '27b/KSeF: dziennik ma wystawienie, wysylke i przyjecie - nic wiecej');
SELECT pg_temp.assert_raises_like(format(
  $q$UPDATE public.event_invoice_ksef_events SET note = 'x' WHERE invoice_id = %L$q$, pg_temp.c27('c_inv')),
  'invoice_immutable', '27b/KSeF: dziennik jest append-only (UPDATE)');
SELECT pg_temp.assert_raises_like(format(
  $q$DELETE FROM public.event_invoice_ksef_events WHERE invoice_id = %L$q$, pg_temp.c27('c_inv')),
  'invoice_immutable', '27b/KSeF: dziennik jest append-only (DELETE)');
-- Zapis bez zmiany stanu: bez notatki nic nie dopisuje, sama notatka to wpis
-- dziennika (panel zglasza sukces, wiec notatka nie moze przepasc).
SELECT public.admin_event_invoice_ksef_update(jsonb_build_object('id', pg_temp.c27('c_inv'), 'status', 'accepted'));
SELECT public.admin_event_invoice_ksef_update(jsonb_build_object('id', pg_temp.c27('c_inv'), 'status', 'accepted',
  'note', ' UPO 123 '));
SELECT pg_temp.assert(
  (SELECT string_agg(COALESCE(from_status, '-') || '>' || to_status || ':' || note, ',' ORDER BY created_at, id)
     FROM public.event_invoice_ksef_events WHERE invoice_id = pg_temp.c27('c_inv') AND from_status = to_status)
    = 'accepted>accepted:UPO 123'
  AND (SELECT count(*) FROM public.event_invoice_ksef_events WHERE invoice_id = pg_temp.c27('c_inv')) = 4,
  '27b/KSeF: sama notatka trafia do dziennika (stan bez zmian), pusty zapis - nic');

-- Unikalnosc numeru i numer KSeF w korekcie.
DO $$
DECLARE v_other uuid; v_cor uuid; d jsonb;
BEGIN
  v_other := pg_temp.c27_draft('registration', '2b400000-0000-0000-0000-000000000003');
  PERFORM public.admin_event_invoice_issue(v_other);
  PERFORM pg_temp.c27_set('c_other', v_other);
  v_cor := public.admin_event_invoice_correction_create(jsonb_build_object(
    'invoice_id', pg_temp.c27('c_inv'), 'mode', 'full', 'reason', 'Zwrot biletu'));
  d := public.admin_event_invoice_get(v_cor);
  PERFORM pg_temp.assert(d->'corrects'->>'ksef_number' = pg_temp.c27_ksef(pg_temp.c27_today()),
    '27b/KSeF: korekta niesie numer KSeF faktury korygowanej (do wydruku)');
  PERFORM public.admin_event_invoice_cancel(jsonb_build_object('id', v_cor));
END $$;
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_invoice_ksef_update(jsonb_build_object('id', %L::uuid, 'status', 'accepted', 'number', %L))$q$,
  pg_temp.c27('c_other'), pg_temp.c27_ksef(pg_temp.c27_today())),
  'ksef_number_taken', '27b/KSeF: ten sam numer KSeF na drugiej fakturze - odmowa');
SELECT pg_temp.assert(
  EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'event_invoices_ksef_number_unique'),
  '27b/KSeF: indeks unikalny numeru w najemcy istnieje');
DO $$
DECLARE v_cor uuid;
BEGIN
  PERFORM public.admin_event_invoice_ksef_update(jsonb_build_object('id', pg_temp.c27('c_other'), 'status', 'sent'));
  v_cor := public.admin_event_invoice_correction_create(jsonb_build_object(
    'invoice_id', pg_temp.c27('c_other'), 'mode', 'full', 'reason', 'Zwrot biletu'));
  PERFORM pg_temp.c27_set('c_other_cor', v_cor);
END $$;
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_invoice_issue(%L::uuid)$q$, pg_temp.c27('c_other_cor')),
  'correction_awaits_ksef', '27b/KSeF: korekta faktury czekajacej na numer KSeF - odmowa');
SELECT public.admin_event_invoice_cancel(jsonb_build_object('id', pg_temp.c27('c_other_cor')));

-- ---------------------------------------------------------------------------
-- D) INV-08: DORECZONY DOKUMENT = TYLKO KOREKTA
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_inv uuid; v_at timestamptz; v_pro uuid;
BEGIN
  UPDATE public.event_registrations SET paid_amount_cents = 12300, paid_amount_currency = 'PLN',
         paid_amount_recorded_at = now()
   WHERE id IN ('2b400000-0000-0000-0000-000000000010', '2b400000-0000-0000-0000-000000000011');
  v_inv := pg_temp.c27_draft('registration', '2b400000-0000-0000-0000-000000000010');
  PERFORM public.admin_event_invoice_issue(v_inv);
  PERFORM pg_temp.c27_set('d_mail', v_inv);
  v_at := public.admin_event_invoice_mark_notified(v_inv);
  PERFORM pg_temp.assert(v_at IS NOT NULL AND public.admin_event_invoice_mark_notified(v_inv) = v_at,
    '27b/doreczenie: stempel maila raz (drugie wolanie oddaje ten sam czas)');
  v_pro := pg_temp.c27_draft('registration', '2b400000-0000-0000-0000-000000000011', 'proforma');
  PERFORM public.admin_event_invoice_issue(v_pro);
  PERFORM public.admin_event_invoice_mark_notified(v_pro);
  PERFORM public.admin_event_invoice_cancel(jsonb_build_object('id', v_pro, 'reason', 'Nieaktualna oferta'));
  PERFORM pg_temp.assert((SELECT status FROM public.event_invoices WHERE id = v_pro) = 'cancelled',
    '27b/doreczenie: proforma (nie faktura VAT) po doreczeniu nadal do anulowania');
END $$;
-- KRYTERIUM INV-08: anulowanie odrzucone, gdy wyslano mail o fakturze.
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_invoice_cancel(jsonb_build_object('id', %L::uuid, 'reason', 'Pomylka'))$q$,
  pg_temp.c27('d_mail')),
  'delivered_locked', '27b/doreczenie: faktury doreczonej mailem nie anulujesz');
SELECT pg_temp.assert_raises_like(format(
  $q$UPDATE public.event_invoices SET buyer_notified_at = NULL WHERE id = %L$q$, pg_temp.c27('d_mail')),
  'invoice_immutable', '27b/doreczenie: stempla nie da sie zdjac');
SELECT pg_temp.act_as('2ba00000-0000-0000-0000-0000000000a2', '2b000000-0000-0000-0000-0000000000a0');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_invoice_mark_notified(%L::uuid)$q$, pg_temp.c27('d_mail')),
  'forbidden', '27b/doreczenie: redaktor nie stempluje');

-- Pobranie przez kupujacego z profilu.
SELECT pg_temp.act_as('2ba00000-0000-0000-0000-0000000000a1', '2b000000-0000-0000-0000-0000000000a0');
DO $$
DECLARE v_inv uuid;
BEGIN
  v_inv := public.admin_event_invoice_draft_create(jsonb_build_object(
    'event_id', '2be00000-0000-0000-0000-0000000000e1',
    'sources', jsonb_build_array(jsonb_build_object('kind', 'package_order', 'id', '2b900000-0000-0000-0000-000000000001')),
    'buyer', '{"is_company":true,"name":"Acme Sp. z o.o.","tax_id":"5260250274","address":"ul. Morska 5",
               "postal_code":"80-001","city":"Gdansk"}'::jsonb));
  PERFORM public.admin_event_invoice_issue(v_inv);
  PERFORM pg_temp.c27_set('d_download', v_inv);
END $$;
SELECT pg_temp.act_as('2ba00000-0000-0000-0000-0000000000a3', '2b000000-0000-0000-0000-0000000000a0');
SELECT pg_temp.assert(
  (public.event_my_invoice(pg_temp.c27('d_download')))->'invoice' ? 'number'
  AND NOT ((public.event_my_invoice(pg_temp.c27('d_download')))->'invoice' ? 'buyer_downloaded_at'),
  '27b/doreczenie: kupujacy pobiera migawke (bez stempli panelu)');
SELECT pg_temp.act_as('2ba00000-0000-0000-0000-0000000000a1', '2b000000-0000-0000-0000-0000000000a0');
SELECT pg_temp.assert(
  (SELECT buyer_downloaded_at FROM public.event_invoices WHERE id = pg_temp.c27('d_download')) IS NOT NULL,
  '27b/doreczenie: pierwsze pobranie stempluje doreczenie');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public.admin_event_invoice_cancel(jsonb_build_object('id', %L::uuid, 'reason', 'Pomylka'))$q$,
  pg_temp.c27('d_download')),
  'delivered_locked', '27b/doreczenie: faktury pobranej przez nabywce nie anulujesz');

-- ---------------------------------------------------------------------------
-- E) INV-06: FAKTURA W EUR - KURS NBP I VAT W PLN
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_inv uuid; v_need jsonb; v_rate_date date := (pg_temp.c27_today() - 3) - 1;
BEGIN
  v_inv := pg_temp.c27_draft('registration', '2b400000-0000-0000-0000-000000000005');
  PERFORM pg_temp.c27_set('e_inv', v_inv);
  PERFORM pg_temp.assert((SELECT currency FROM public.event_invoices WHERE id = v_inv) = 'EUR',
    '27b/EUR: szkic dziedziczy walute zamowienia');
  v_need := public.admin_event_invoice_fx_needs(jsonb_build_object('invoice_ids', jsonb_build_array(v_inv)));
  PERFORM pg_temp.assert(v_need = jsonb_build_array(jsonb_build_object(
      'currency', 'EUR', 'rate_date', to_char(v_rate_date, 'YYYY-MM-DD'), 'loaded', false)),
    '27b/EUR: potrzebny kurs z dnia poprzedzajacego zaplate (obowiazek podatkowy)');
  PERFORM pg_temp.assert((public.admin_event_invoice_get(v_inv))->'fx_need'->>'rate_date' = to_char(v_rate_date, 'YYYY-MM-DD'),
    '27b/EUR: panel wie, jakiego kursu brakuje');
END $$;
SELECT pg_temp.assert_raises_like(format($q$SELECT public.admin_event_invoice_issue(%L::uuid)$q$, pg_temp.c27('e_inv')),
  'fx_rate_required: EUR ' || to_char((pg_temp.c27_today() - 3) - 1, 'YYYY-MM-DD'),
  '27b/EUR: bez kursu NBP faktury w EUR nie wystawisz (komunikat podaje walute i dzien)');
SELECT pg_temp.assert(
  (SELECT count(*) FROM public.event_invoice_counters WHERE tenant_id = '2b000000-0000-0000-0000-0000000000a0'
     AND series = 'FV') = 1
  AND (SELECT last_seq FROM public.event_invoice_counters WHERE tenant_id = '2b000000-0000-0000-0000-0000000000a0'
     AND series = 'FV') = (SELECT count(*) FROM public.event_invoices WHERE tenant_id = '2b000000-0000-0000-0000-0000000000a0'
                             AND series = 'FV'),
  '27b/EUR: odmowa nie zuzyla numeru');

INSERT INTO public.nbp_exchange_rates (currency, rate_date, effective_date, table_no, mid)
VALUES ('EUR', (pg_temp.c27_today() - 3) - 1, (pg_temp.c27_today() - 3) - 1, '195/A/NBP/2026', 4.2731);

DO $$
DECLARE v_inv uuid := pg_temp.c27('e_inv'); i public.event_invoices; v_cor uuid; c public.event_invoices;
BEGIN
  PERFORM pg_temp.assert(
    (public.admin_event_invoice_fx_needs(jsonb_build_object('invoice_ids', jsonb_build_array(v_inv))))->0->>'loaded' = 'true',
    '27b/EUR: po pobraniu kursu potrzeba jest zaspokojona');
  PERFORM public.admin_event_invoice_issue(v_inv);
  SELECT * INTO i FROM public.event_invoices WHERE id = v_inv;
  -- 100,00 EUR brutto w 23%: netto 81,30, VAT 18,70 EUR x 4,2731 = 79,90697 -> 79,91 zl.
  PERFORM pg_temp.assert(i.fx_rate = 4.2731 AND i.fx_table_no = '195/A/NBP/2026'
    AND i.fx_effective_date = (pg_temp.c27_today() - 3) - 1 AND i.vat_cents = 1870 AND i.vat_pln_cents = 7991
    AND (i.vat_summary->0->>'vat_pln_cents')::bigint = 7991,
    '27b/EUR: KRYTERIUM - faktura w EUR ma kurs, numer i date tabeli oraz VAT w PLN');
  -- Korekta: kurs faktury korygowanej (art. 31a ust. 2b), nawet bez tabeli NBP.
  DELETE FROM public.nbp_exchange_rates WHERE currency = 'EUR';
  v_cor := public.admin_event_invoice_correction_create(jsonb_build_object(
    'invoice_id', v_inv, 'mode', 'full', 'reason', 'Zwrot biletu'));
  PERFORM public.admin_event_invoice_issue(v_cor);
  SELECT * INTO c FROM public.event_invoices WHERE id = v_cor;
  PERFORM pg_temp.assert(c.fx_rate = 4.2731 AND c.fx_table_no = '195/A/NBP/2026' AND c.vat_pln_cents = -7991,
    '27b/EUR: korekta po kursie faktury korygowanej, VAT w PLN odwrocony co do grosza');
END $$;
SELECT pg_temp.assert(
  public._event_invoice_pln(1870, 4.2731) = 7991 AND public._event_invoice_pln(-1870, 4.2731) = -7991
  AND public._event_invoice_pln(1, 0.5) = 1 AND public._event_invoice_pln(-1, 0.5) = -1
  AND public._event_invoice_pln(3, 0.1667) = 1 AND public._event_invoice_pln(0, 4.5) = 0,
  '27b/EUR: przeliczenie na PLN - polowka od zera (te same wektory co vitest amountInPln)');
SET ROLE authenticated;
SELECT pg_temp.assert_raises($q$SELECT count(*) FROM public.nbp_exchange_rates$q$,
  '27b/EUR: tabela kursow niedostepna dla zalogowanych (pisze i czyta tylko serwer)');
RESET ROLE;

-- ---------------------------------------------------------------------------
-- F) INV-12: STAWKA "np", ODWROTNE OBCIAZENIE, VIES
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert_raises_like($q$SELECT public.admin_event_invoice_settings_save('{"default_vat_rate":"np"}')$q$,
  'vat_np_basis_required', '27b/np: domyslna stawka np bez podstawy prawnej - odmowa');
DO $$
DECLARE v_inv uuid; d jsonb;
BEGIN
  UPDATE public.event_registrations SET paid_amount_cents = 12300, paid_amount_currency = 'PLN',
         paid_amount_recorded_at = now()
   WHERE id = '2b400000-0000-0000-0000-000000000013';
  v_inv := pg_temp.c27_draft('registration', '2b400000-0000-0000-0000-000000000013', 'invoice',
    '{"is_company":true,"name":"Muster GmbH","tax_id":"DE123456789","country":"DE","address":"Hauptstr. 1",
      "postal_code":"10115","city":"Berlin"}'::jsonb);
  PERFORM public.admin_event_invoice_draft_update(jsonb_build_object('id', v_inv, 'lines',
    '[{"description":"Udzial online","unit":"szt.","quantity":1,"unit_gross_cents":12300,"vat_rate":"np"}]'::jsonb));
  PERFORM pg_temp.c27_set('f_inv', v_inv);
  d := public.admin_event_invoice_get(v_inv);
  PERFORM pg_temp.assert((d->'invoice'->>'reverse_charge_effective')::boolean AND d->'invoice'->>'np_basis_effective' = ''
    AND d->'invoice'->'reverse_charge' = 'null'::jsonb,
    '27b/np: szkic pokazuje skutek - odwrotne obciazenie automatycznie (np + firma z UE), podstawy brak');
  -- Podstawa z ustawien wystawcy jest skutkiem szkicu takze wtedy, gdy edytor
  -- dopiero zmienia stawke na "np" (pozycji "np" jeszcze nie ma w bazie).
  UPDATE public.event_invoice_settings SET vat_np_basis = 'Art. 28b (ustawienia)'
   WHERE tenant_id = '2b000000-0000-0000-0000-0000000000a0';
  d := public.admin_event_invoice_get(v_inv);
  PERFORM pg_temp.assert(d->'invoice'->>'np_basis_effective' = 'Art. 28b (ustawienia)',
    '27b/np: szkic bez wlasnej podstawy pokazuje podstawe z ustawien wystawcy');
  UPDATE public.event_invoice_settings SET vat_np_basis = ''
   WHERE tenant_id = '2b000000-0000-0000-0000-0000000000a0';
END $$;
SELECT pg_temp.assert_raises_like(format($q$SELECT public.admin_event_invoice_issue(%L::uuid)$q$, pg_temp.c27('f_inv')),
  'vat_np_basis_required', '27b/np: KRYTERIUM - wystawienie z "np" bez podstawy prawnej odrzucone');
SELECT public.admin_event_invoice_draft_update(jsonb_build_object('id', pg_temp.c27('f_inv'),
  'np_basis', 'Art. 28b ustawy o VAT - usluga dla podatnika z siedziba poza Polska'));
SELECT pg_temp.assert_raises_like(format($q$SELECT public.admin_event_invoice_issue(%L::uuid)$q$, pg_temp.c27('f_inv')),
  'vies_verification_required', '27b/np: odwrotne obciazenie dla nabywcy z UE wymaga weryfikacji VIES');
SELECT pg_temp.assert(
  (public.admin_event_invoice_vies_subject(pg_temp.c27('f_inv')))
    = jsonb_build_object('tenant_id', '2b000000-0000-0000-0000-0000000000a0', 'invoice_id', pg_temp.c27('f_inv'),
                         'subject', 'DE123456789', 'country_code', 'DE', 'vat_number', '123456789',
                         'requester_country', 'PL', 'requester_number', '7011278375'),
  '27b/VIES: podmiot zapytania - kod VIES, numer bez prefiksu, zapytujacy = NIP sprzedawcy');
SELECT public._event_invoice_vies_record('2b000000-0000-0000-0000-0000000000a0', pg_temp.c27('f_inv'),
  'DE123456789', true, 'WAPIAAAAYXXXX');
-- Zmiana nabywcy uniewaznia weryfikacje.
SELECT public.admin_event_invoice_draft_update(jsonb_build_object('id', pg_temp.c27('f_inv'),
  'buyer', '{"tax_id":"DE999999999"}'::jsonb));
SELECT pg_temp.assert(
  (SELECT buyer_vies_checked_at IS NULL AND buyer_vies_subject IS NULL FROM public.event_invoices WHERE id = pg_temp.c27('f_inv')),
  '27b/VIES: zmiana numeru nabywcy kasuje weryfikacje');
SELECT pg_temp.assert_raises_like(format($q$SELECT public.admin_event_invoice_issue(%L::uuid)$q$, pg_temp.c27('f_inv')),
  'vies_verification_required', '27b/VIES: po zmianie nabywcy - weryfikacja do powtorzenia');
SELECT pg_temp.assert_raises_like(format(
  $q$SELECT public._event_invoice_vies_record('2b000000-0000-0000-0000-0000000000a0', %L::uuid, 'DE123456789', true, NULL)$q$,
  pg_temp.c27('f_inv')),
  'vies_subject_changed', '27b/VIES: wynik dla starego numeru nie trafi na nowego nabywce');
SELECT public._event_invoice_vies_record('2b000000-0000-0000-0000-0000000000a0', pg_temp.c27('f_inv'),
  'DE999999999', true, 'WAPIAAAAZZZZ');
DO $$
DECLARE i public.event_invoices;
BEGIN
  PERFORM public.admin_event_invoice_issue(pg_temp.c27('f_inv'));
  SELECT * INTO i FROM public.event_invoices WHERE id = pg_temp.c27('f_inv');
  PERFORM pg_temp.assert(i.reverse_charge AND i.np_basis LIKE 'Art. 28b%' AND i.vat_cents = 0
    AND i.buyer_vies_valid AND i.buyer_vies_request_id = 'WAPIAAAAZZZZ',
    '27b/np: faktura z adnotacja odwrotnego obciazenia, podstawa i dowodem VIES');
END $$;
DO $$
DECLARE v_cor uuid; d jsonb;
BEGIN
  -- Szkic korekty pokazuje to, co zapisze wystawienie: decyzje i podstawe
  -- faktury korygowanej (korekta bez wlasnej decyzji je dziedziczy).
  v_cor := public.admin_event_invoice_correction_create(jsonb_build_object(
    'invoice_id', pg_temp.c27('f_inv'), 'mode', 'full', 'reason', 'Rezygnacja'));
  d := public.admin_event_invoice_get(v_cor);
  PERFORM pg_temp.assert((d->'invoice'->>'reverse_charge_effective')::boolean
    AND d->'invoice'->>'np_basis_effective' LIKE 'Art. 28b%',
    '27b/np: szkic korekty dziedziczy odwrotne obciazenie i podstawe faktury');
  PERFORM public.admin_event_invoice_cancel(jsonb_build_object('id', v_cor));
END $$;
DO $$
DECLARE v_inv uuid;
BEGIN
  UPDATE public.event_registrations SET paid_amount_cents = 12300, paid_amount_currency = 'PLN',
         paid_amount_recorded_at = now()
   WHERE id = '2b400000-0000-0000-0000-000000000012';
  v_inv := pg_temp.c27_draft('registration', '2b400000-0000-0000-0000-000000000012', 'invoice',
    '{"is_company":true,"name":"Muster GmbH","tax_id":"DE123456789","country":"DE","address":"Hauptstr. 1",
      "postal_code":"10115","city":"Berlin"}'::jsonb);
  PERFORM public.admin_event_invoice_draft_update(jsonb_build_object('id', v_inv, 'reverse_charge', true));
  PERFORM pg_temp.c27_set('f_bad', v_inv);
END $$;
SELECT pg_temp.assert_raises_like(format($q$SELECT public.admin_event_invoice_issue(%L::uuid)$q$, pg_temp.c27('f_bad')),
  'reverse_charge_invalid', '27b/np: odwrotne obciazenie z pozycja 23% - odmowa');
SELECT public.admin_event_invoice_cancel(jsonb_build_object('id', pg_temp.c27('f_bad')));
SELECT pg_temp.assert(
  public._event_invoice_vies_subject('GR', '094259216') = 'EL094259216'
  AND public._event_invoice_vies_subject('GR', 'EL094259216') = 'EL094259216'
  AND public._event_invoice_vies_subject('DE', 'de 123-456-789') = 'DE123456789'
  AND public._event_invoice_eu_country('XI') AND NOT public._event_invoice_eu_country('GB'),
  '27b/VIES: Grecja = EL, prefiks i separatory zdjete, Irlandia Polnocna w UE, Wielka Brytania nie');

-- ---------------------------------------------------------------------------
-- G) INV-14: ZAKSIEGOWANA WPLATA ZAMIAST CENNIKA
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_inv uuid; r record;
BEGIN
  v_inv := pg_temp.c27_draft('registration', '2b400000-0000-0000-0000-000000000014');
  PERFORM pg_temp.c27_set('g_old', v_inv);
  SELECT * INTO r FROM public.admin_event_invoice_candidates('2be00000-0000-0000-0000-0000000000e1')
   WHERE source_id = '2b400000-0000-0000-0000-000000000014';
  PERFORM pg_temp.assert(r.amount_source = 'price_list' AND r.gross_cents = 12300,
    '27b/wplata: przelew bez zaksiegowanej kwoty = kwota z cennika (do potwierdzenia)');
END $$;
SELECT pg_temp.assert_raises_like(format($q$SELECT public.admin_event_invoice_issue(%L::uuid)$q$, pg_temp.c27('g_old')),
  'payment_amount_unbooked', '27b/wplata: faktura za oplacony przelew bez zaksiegowanej kwoty - odmowa');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_registration_record_payment('{"registration_id":"2b400000-0000-0000-0000-000000000014","amount_cents":"12.3"}')$q$,
  'invalid_price', '27b/wplata: kwota w groszach, liczba calkowita');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_registration_record_payment('{"registration_id":"2b400000-0000-0000-0000-000000000002","amount_cents":12300}')$q$,
  'payment_is_card', '27b/wplata: kwote zamowienia z karty podaje operator');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_registration_record_payment('{"registration_id":"2b400000-0000-0000-0000-000000000021","amount_cents":12300}')$q$,
  'source_not_lead', '27b/wplata: gosc grupy rozliczany na zapisie prowadzacego');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_registration_record_payment('{"registration_id":"2b400000-0000-0000-0000-000000000022","amount_cents":12300}')$q$,
  'registration_not_paid', '27b/wplata: nieoplacony zapis nie ma wplaty');
SELECT pg_temp.act_as('2ba00000-0000-0000-0000-0000000000a2', '2b000000-0000-0000-0000-0000000000a0');
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.admin_event_registration_record_payment('{"registration_id":"2b400000-0000-0000-0000-000000000014","amount_cents":9900}')$q$,
  'forbidden', '27b/wplata: redaktor nie ksieguje kwot');
SELECT pg_temp.act_as('2ba00000-0000-0000-0000-0000000000a1', '2b000000-0000-0000-0000-0000000000a0');
DO $$
DECLARE v jsonb; r record;
BEGIN
  -- Kod rabatowy przy przelewie: wplynelo 99,00 zamiast 123,00.
  v := public.admin_event_registration_record_payment(
    '{"registration_id":"2b400000-0000-0000-0000-000000000014","amount_cents":9900}');
  PERFORM pg_temp.assert(v->>'amount_cents' = '9900' AND v->>'currency' = 'PLN',
    '27b/wplata: kwota zaksiegowana w walucie biletu');
  SELECT * INTO r FROM public.admin_event_invoice_candidates('2be00000-0000-0000-0000-0000000000e1')
   WHERE source_id = '2b400000-0000-0000-0000-000000000014';
  PERFORM pg_temp.assert(r.amount_source = 'booked' AND r.gross_cents = 9900,
    '27b/wplata: kandydat z zaksiegowana kwota');
END $$;
-- KRYTERIUM INV-14: rozjazd pozycji z wplata = odmowa wystawienia.
SELECT pg_temp.assert_raises_like(format($q$SELECT public.admin_event_invoice_issue(%L::uuid)$q$, pg_temp.c27('g_old')),
  'amount_mismatch', '27b/wplata: stary szkic na 123,00 przy wplacie 99,00 - odmowa wystawienia');
DO $$
BEGIN
  PERFORM public.admin_event_invoice_cancel(jsonb_build_object('id', pg_temp.c27('g_old')));
  PERFORM pg_temp.c27_set('g_new', pg_temp.c27_draft('registration', '2b400000-0000-0000-0000-000000000014'));
  PERFORM pg_temp.assert(pg_temp.c27_lines(pg_temp.c27('g_new')) = '1x9900@23',
    '27b/wplata: nowy szkic z zaksiegowanej wplaty');
  PERFORM public.admin_event_invoice_issue(pg_temp.c27('g_new'));
  PERFORM pg_temp.assert((SELECT gross_cents FROM public.event_invoices WHERE id = pg_temp.c27('g_new')) = 9900,
    '27b/wplata: faktura na kwote, ktora wplynela');
END $$;

-- ---------------------------------------------------------------------------
-- H) INV-15: TERMIN PROSBY OD POZNIEJSZEJ Z DAT
-- ---------------------------------------------------------------------------
SELECT pg_temp.assert(
  public._event_invoice_request_deadline('2026-01-15T10:00:00Z', '2026-06-10T10:00:00Z') = '2026-09-30'
  AND public._event_invoice_request_deadline('2026-06-10T10:00:00Z', '2026-01-15T10:00:00Z') = '2026-09-30'
  AND public._event_invoice_request_deadline('2026-03-31T22:30:00Z', NULL) = '2026-07-31'
  AND public._event_invoice_request_deadline('2026-03-31T21:30:00Z', NULL) = '2026-06-30'
  AND public._event_invoice_request_deadline(NULL, '2026-06-10T10:00:00Z') IS NULL,
  '27b/termin: koniec 3. miesiaca po miesiacu pozniejszej z dat zaplaty i wydarzenia (miesiac w Warszawie: 31.03 22:30 UTC = kwiecien), bez zaplaty bez terminu');
SELECT pg_temp.act_as('2ba00000-0000-0000-0000-0000000000a3', '2b000000-0000-0000-0000-0000000000a0');
DO $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.event_my_invoice_sources() WHERE source_id = '2b400000-0000-0000-0000-000000000020';
  PERFORM pg_temp.assert(r.can_request AND r.request_deadline >= (now() + interval '30 days')::date,
    '27b/termin: KRYTERIUM - oplata 5 miesiecy temu za wydarzenie za 30 dni: prosba nadal w terminie');
  PERFORM public.event_invoice_request_save(jsonb_build_object(
    'registration_id', '2b400000-0000-0000-0000-000000000020',
    'buyer', '{"is_company":false,"name":"Anna Kupujaca","address":"ul. Polna 1","postal_code":"00-001","city":"Warszawa"}'::jsonb));
  SELECT * INTO r FROM public.event_my_invoice_sources() WHERE source_id = '2b400000-0000-0000-0000-000000000023';
  PERFORM pg_temp.assert(NOT r.can_request AND r.request_block = 'window_closed',
    '27b/termin: zaplata i wydarzenie dawno temu - po terminie');
END $$;
SELECT pg_temp.assert_raises_like(
  $q$SELECT public.event_invoice_request_save('{"registration_id":"2b400000-0000-0000-0000-000000000023","buyer":{"is_company":false,"name":"Anna Dawna","address":"ul. Polna 1","postal_code":"00-001","city":"Warszawa"}}')$q$,
  'request_window_closed', '27b/termin: prosba po terminie odrzucona');
SELECT pg_temp.act_as('2ba00000-0000-0000-0000-0000000000a1', '2b000000-0000-0000-0000-0000000000a0');

-- ---------------------------------------------------------------------------
-- I) INV-05: ZWROT PO FAKTURZE -> SZKIC KOREKTY + ALARM
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_partial uuid; v_full uuid; v_manual uuid; v_transfer uuid; v_pkg uuid;
BEGIN
  v_partial := pg_temp.c27_draft('registration', '2b400000-0000-0000-0000-000000000004');
  PERFORM public.admin_event_invoice_issue(v_partial);
  PERFORM pg_temp.c27_set('i_partial', v_partial);
  v_full := pg_temp.c27('c_other');
  PERFORM pg_temp.c27_set('i_full', v_full);
  UPDATE public.event_registrations SET paid_amount_cents = 12300, paid_amount_currency = 'PLN',
         paid_amount_recorded_at = now()
   WHERE id = '2b400000-0000-0000-0000-000000000015';
  v_transfer := pg_temp.c27_draft('registration', '2b400000-0000-0000-0000-000000000015');
  PERFORM public.admin_event_invoice_issue(v_transfer);
  PERFORM pg_temp.c27_set('i_transfer', v_transfer);
END $$;
SELECT pg_temp.assert(pg_temp.c27_lines(pg_temp.c27('i_partial')) = '1x12300@23',
  '27b/zwrot: faktura za zamowienie z karty 1 x 123,00');
DELETE FROM public.notifications WHERE tenant_id = '2b000000-0000-0000-0000-0000000000a0';

-- Zwrot niejednoznaczny (50,00 z 123,00): alarm o korekcie recznej, bez szkicu.
UPDATE public.payment_orders SET refunded_amount_cents = 5000 WHERE id = '2b600000-0000-0000-0000-000000000004';
SELECT pg_temp.assert(
  NOT EXISTS (SELECT 1 FROM public.event_invoices WHERE corrects_invoice_id = pg_temp.c27('i_partial'))
  AND (SELECT count(*) FROM public.notifications
        WHERE kind = 'billing' AND href LIKE '%invoice=' || pg_temp.c27('i_partial')::text
          AND title_pl LIKE '%wymagana korekta%') = 2,
  '27b/zwrot: kwota nie do rozpisania na pozycje = alarm "wymagana korekta" (admin i super_admin), bez szkicu');

-- Zwrot pelny zamowienia z karty: szkic pelnej korekty + alarm.
UPDATE public.payment_orders SET status = 'refunded', refunded_amount_cents = 12300
 WHERE id = '2b600000-0000-0000-0000-000000000003';
DO $$
DECLARE c public.event_invoices;
BEGIN
  SELECT * INTO c FROM public.event_invoices WHERE corrects_invoice_id = pg_temp.c27('i_full') AND status = 'draft';
  PERFORM pg_temp.assert(c.id IS NOT NULL AND c.correction_mode = 'full' AND c.paid_at IS NOT NULL
    AND pg_temp.c27_lines(c.id) = '-1x12300@23' AND c.created_by IS NULL,
    '27b/zwrot: KRYTERIUM - zwrot zamowienia z faktura tworzy szkic korekty (pelnej, zwrot wykonany)');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.notifications
      WHERE kind = 'billing' AND href LIKE '%invoice=' || pg_temp.c27('i_full')::text
        AND title_pl LIKE '%szkic korekty%'
        AND user_id IN ('2ba00000-0000-0000-0000-0000000000a1', '2ba00000-0000-0000-0000-0000000000a8')) = 2
    AND NOT EXISTS (SELECT 1 FROM public.notifications
      WHERE href LIKE '%invoice=' || pg_temp.c27('i_full')::text
        AND user_id IN ('2ba00000-0000-0000-0000-0000000000a2', '2ba00000-0000-0000-0000-0000000000b1')),
    '27b/zwrot: KRYTERIUM - powiadomienie dla administratorow najemcy (nie redaktora, nie obcego najemcy)');
  PERFORM pg_temp.assert(
    public._event_invoice_refund_followup('2b000000-0000-0000-0000-0000000000a0', pg_temp.c27('i_full')) = 'draft_exists'
    AND (SELECT count(*) FROM public.event_invoices WHERE corrects_invoice_id = pg_temp.c27('i_full')
           AND status = 'draft') = 1,
    '27b/zwrot: kolejne wywolanie nie zaklada drugiego szkicu');
END $$;

-- Zwrot przelewu (akcja panelu `refund` ustawia payment_status): szkic pelny.
UPDATE public.event_registrations SET payment_status = 'refunded'
 WHERE id = '2b400000-0000-0000-0000-000000000015';
SELECT pg_temp.assert(
  (SELECT correction_mode FROM public.event_invoices
    WHERE corrects_invoice_id = pg_temp.c27('i_transfer') AND status = 'draft') = 'full',
  '27b/zwrot: zwrot przelewu po fakturze = szkic pelnej korekty');

-- Zwrot jednego z dwoch miejsc zamowienia z karty: korekta czesciowa o miejsce.
DO $$
DECLARE c public.event_invoices;
BEGIN
  -- c_inv: zamowienie O2 za dwa miejsca (2 x 61,50).
  PERFORM pg_temp.assert(pg_temp.c27_lines(pg_temp.c27('c_inv')) = '2x6150@23',
    '27b/zwrot: faktura za dwa miejsca z jednego zamowienia');
  UPDATE public.payment_orders SET refunded_amount_cents = 6150 WHERE id = '2b600000-0000-0000-0000-000000000002';
  SELECT * INTO c FROM public.event_invoices WHERE corrects_invoice_id = pg_temp.c27('c_inv') AND status = 'draft';
  PERFORM pg_temp.assert(c.correction_mode = 'partial' AND pg_temp.c27_lines(c.id) = '-2x6150@23;1x6150@23'
    AND c.gross_cents = -6150,
    '27b/zwrot: zwrot za jedno miejsce = szkic korekty czesciowej o to miejsce (para przed/po)');
END $$;

-- Zwrot oplaconego pakietu po fakturze: szkic pelnej korekty.
UPDATE public.event_package_orders SET status = 'refunded'
 WHERE id = '2b900000-0000-0000-0000-000000000001';
SELECT pg_temp.assert(
  (SELECT correction_mode || '|' || (paid_at IS NOT NULL)::text FROM public.event_invoices
    WHERE corrects_invoice_id = pg_temp.c27('d_download') AND status = 'draft') = 'full|true',
  '27b/zwrot: zwrocony pakiet po fakturze = szkic pelnej korekty (zwrot wykonany)');

-- Alarm: administratorzy i super_admin TEGO najemcy z profilem w nim.
SELECT pg_temp.assert(
  public._tenant_admins_alert('2b000000-0000-0000-0000-0000000000a0', 'Test', 'Test', NULL, NULL, '/admin/test-27b') = 2
  AND public._tenant_admins_alert('2b000000-0000-0000-0000-0000000000a0', 'Test', 'Test', NULL, NULL, '/admin/test-27b') = 0
  AND public._tenant_admins_alert(NULL, 'Test', 'Test', NULL, NULL, '/admin/test-27b') = 0,
  '27b/alarm: dwoch odbiorcow (admin, super_admin), deduplikacja po href, brak najemcy = nikt');

ROLLBACK;
