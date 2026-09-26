-- ===========================================================================
-- 71 PAKIET GRUPOWY I KOD RABATOWY (migracja 20260926110000)
--
-- PO CO TEN PLIK ISTNIEJE. Wlasciciel zglosil: „kod na stala kwote odejmuje sie
-- raz od calego zamowienia, a nie od kazdego biletu". Kasa zapisu grupowego
-- liczy to w TypeScripcie (groupOrderPricing.ts) - pakiet grupowy liczy baza,
-- `event_admission_quote`, i tam kod schodzil RAZ z ceny pakietu. Do tego
-- `70_admissions.sql` w naglowku obiecywal asercje o rabacie kwotowym, ktorej
-- w pliku nie bylo - zadna wycena z kodem nie byla wykonywana przez harness.
--
-- CO SPRAWDZA (kazdy punkt to galaz funkcji, ktora da sie zlamac):
--   A. wycena: kod kwotowy x liczba miejsc; kod wiekszy od ceny miejsca zeruje
--      pakiet (takze grosz reszty), a nie tworzy naleznosci; kod procentowy bez
--      zmian; wejsciowka (1 miejsce) bez zmian; wycena bez kodu nie ma rodzaju
--      ani kwoty na miejsce;
--   B. odmowy: kod TYLKO odslaniajacy (`coupon_no_discount`, a nie cena zero),
--      kod zawezony do innego rodzaju wejsciowki (`coupon_other_ticket_type`)
--      i kontrapunkt - kod zawezony do rodzaju pakietu dziala;
--   C. zakup: kwoty w zamowieniu, zuzycie kodu RAZ (licznik + jeden wiersz
--      realizacji z user_id, order_id NULL i package_order_id = zamowienie -
--      od 20260926130000), sama wycena niczego nie zuzywa, zakup bez kodu nie
--      dotyka licznikow;
--   D. limity: wyczerpany kod odmawia drugiego zakupu, limit na osobe odmawia
--      tej samej osobie, a nie innej;
--   E. wyscig: kod wyczerpany, uzyty przez te sama osobe, WYLACZONY albo
--      wygasly (koniec waznosci lub jej poczatek przesuniety w przod) MIEDZY
--      wycena a zuzyciem - zakup odmawia i wycofuje zamowienie oraz pule;
--   F. KAZDA odmowa wyceny po kolei (logowanie, ladunek, brak, wylaczenie,
--      okno sprzedazy, pula, ranga, limit na osobe, kazda odmowa kodu), zakres
--      biletu dla WEJSCIOWKI (nie tylko pakietu), pierwszenstwo pakietu
--      wymienionego wprost w `package_ids` i pozostale zestawy;
--   G. zakup: logowanie, ladunek, pula miejsc sali mniejsza od pakietu,
--      pakiet bez rodzaju wejsciowki i e-mail kupujacego z ladunku.
--
-- CZEGO NIE SPRAWDZA: ekranu zakupu (vitest EventPackagesPurchase), kasy zapisu
-- grupowego (vitest checkoutGroupCoupon) ani zwrotu uzycia przy anulowaniu
-- zamowienia - to robi 20260926130000 i sprawdza
-- `72_package_order_cancel_coupon.sql`. Ani `sold_out` ZAKUPU: to ten sam
-- warunek, ktory wycena sprawdza tuz przed nim na tym samym wierszu, wiec
-- w jednej sesji zawsze wygrywa odmowa wyceny (`refused_sold_out`, sekcja F).
-- Straznik zakupu istnieje dla drugiej transakcji, ktora sprzeda ostatni
-- zestaw miedzy wycena a blokada - a harness ma jedna sesje.
--
-- SPRZATANIE: caly plik siedzi w BEGIN ... ROLLBACK.
-- ===========================================================================
\echo '== 71 pakiet grupowy i kod rabatowy =='
BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('71a00000-0000-0000-0000-0000000000a1', 'pakiet.kupujacy@example.org'),
  ('71a00000-0000-0000-0000-0000000000a2', 'pakiet.drugi@example.org')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, tenant_id) VALUES
  ('71a00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111'),
  ('71a00000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.events (id, tenant_id, slug, title_pl, title_en, starts_at, status) VALUES
  ('71e00000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   'pak-kongres-71', 'Kongres pakietowy', 'Package congress', now() + interval '40 days',
   'published')
ON CONFLICT (id) DO NOTHING;

-- Rodzaj pakietowy BEZ limitu miejsc, zeby kilka zakupow nie rozbilo sie
-- o pule sali, i drugi rodzaj - cel kodu zawezonego „nie do tego pakietu".
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, audience, requires_verification, max_per_person)
VALUES
  ('71700000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
   '71e00000-0000-0000-0000-0000000000a1', 'firmowa', 'Firmowa', 'Corporate',
   80000, 'PLN', NULL, 'company', false, NULL),
  ('71700000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
   '71e00000-0000-0000-0000-0000000000a1', 'standard', 'Standard', 'Standard',
   60000, 'PLN', NULL, 'public', false, 1)
ON CONFLICT (id) DO NOTHING;

-- Rodzaje pod odmowy wyceny (sekcja F): kazdy lamie JEDEN warunek. `mala_sala`
-- ma pule 4 miejsc - pakiet 5 miejsc na niej przechodzi wycene (ta liczy pule
-- ZESTAWOW), a odmawia dopiero zakup (sekcja G).
INSERT INTO public.event_ticket_types
  (id, tenant_id, event_id, key, name_pl, name_en, price_cents, currency,
   quota, audience, requires_verification, max_per_person, is_active,
   sales_from, sales_to, min_tier_rank)
VALUES
  ('71700000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   '71e00000-0000-0000-0000-0000000000a1', 'wylaczona', 'Wylaczona', 'Disabled',
   10000, 'PLN', NULL, 'public', false, NULL, false, NULL, NULL, 0),
  ('71700000-0000-0000-0000-0000000000a4', '11111111-1111-1111-1111-111111111111',
   '71e00000-0000-0000-0000-0000000000a1', 'przedsprzedaz', 'Przedsprzedaz', 'Presale',
   10000, 'PLN', NULL, 'public', false, NULL, true, now() + interval '1 day', NULL, 0),
  ('71700000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111',
   '71e00000-0000-0000-0000-0000000000a1', 'zamknieta', 'Zamknieta', 'Closed',
   10000, 'PLN', NULL, 'public', false, NULL, true, NULL, now() - interval '1 hour', 0),
  ('71700000-0000-0000-0000-0000000000a6', '11111111-1111-1111-1111-111111111111',
   '71e00000-0000-0000-0000-0000000000a1', 'czlonkowska', 'Czlonkowska', 'Members',
   10000, 'PLN', NULL, 'public', false, NULL, true, NULL, NULL, 2),
  ('71700000-0000-0000-0000-0000000000a7', '11111111-1111-1111-1111-111111111111',
   '71e00000-0000-0000-0000-0000000000a1', 'mala_sala', 'Mala sala', 'Small room',
   10000, 'PLN', 4, 'company', false, NULL, true, NULL, NULL, 0);

-- P5: 5 miejsc za 3200 zl (640 zl za miejsce). P3: 3 miejsca za 1000 zl -
-- cena NIE dzieli sie przez liczbe miejsc (333,33 zl i grosz reszty).
INSERT INTO public.event_ticket_packages
  (id, tenant_id, event_id, ticket_type_id, key, name_pl, name_en, audience,
   seats, price_cents, currency, quota)
VALUES
  ('71900000-0000-0000-0000-0000000000a5', '11111111-1111-1111-1111-111111111111',
   '71e00000-0000-0000-0000-0000000000a1', '71700000-0000-0000-0000-0000000000a1',
   'firmowy_5', 'Pakiet firmowy 5', 'Corporate 5', 'company', 5, 320000, 'PLN', NULL),
  ('71900000-0000-0000-0000-0000000000a3', '11111111-1111-1111-1111-111111111111',
   '71e00000-0000-0000-0000-0000000000a1', '71700000-0000-0000-0000-0000000000a1',
   'firmowy_3', 'Pakiet firmowy 3', 'Corporate 3', 'company', 3, 100000, 'PLN', NULL);

-- P6: pula JEDNEGO zestawu, juz sprzedanego. P7: pula dwoch, jeden sprzedany -
-- wycena mowi, ile zostalo. P8: 5 miejsc na sali z pula 4.
INSERT INTO public.event_ticket_packages
  (id, tenant_id, event_id, ticket_type_id, key, name_pl, name_en, audience,
   seats, price_cents, currency, quota, sold_count)
VALUES
  ('71900000-0000-0000-0000-0000000000a6', '11111111-1111-1111-1111-111111111111',
   '71e00000-0000-0000-0000-0000000000a1', '71700000-0000-0000-0000-0000000000a1',
   'wyprzedany', 'Pakiet wyprzedany', 'Sold out', 'company', 2, 100000, 'PLN', 1, 1),
  ('71900000-0000-0000-0000-0000000000a7', '11111111-1111-1111-1111-111111111111',
   '71e00000-0000-0000-0000-0000000000a1', '71700000-0000-0000-0000-0000000000a1',
   'ostatni', 'Pakiet ostatni', 'Last one', 'company', 2, 100000, 'PLN', 2, 1),
  ('71900000-0000-0000-0000-0000000000a8', '11111111-1111-1111-1111-111111111111',
   '71e00000-0000-0000-0000-0000000000a1', '71700000-0000-0000-0000-0000000000a7',
   'za_duzy', 'Pakiet za duzy', 'Too big', 'company', 5, 200000, 'PLN', NULL, 0);

INSERT INTO public.b2b_coupons
  (id, tenant_id, code, discount_kind, discount_percent, discount_cents, currency,
   event_ids, ticket_type_ids, max_redemptions, max_redemptions_per_user,
   applies_discount, reveals_hidden)
VALUES
  ('71c00000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'PAK-MINUS50', 'fixed', NULL, 5000, 'PLN',
   ARRAY['71e00000-0000-0000-0000-0000000000a1']::uuid[], ARRAY[]::uuid[], NULL, NULL, true, false),
  ('71c00000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'PAK-MINUS700', 'fixed', NULL, 70000, 'PLN',
   ARRAY['71e00000-0000-0000-0000-0000000000a1']::uuid[], ARRAY[]::uuid[], NULL, NULL, true, false),
  ('71c00000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'PAK-10PROC', 'percent', 10, NULL, NULL,
   ARRAY['71e00000-0000-0000-0000-0000000000a1']::uuid[], ARRAY[]::uuid[], NULL, NULL, true, false),
  ('71c00000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'PAK-ODSLON', 'percent', NULL, NULL, NULL,
   ARRAY['71e00000-0000-0000-0000-0000000000a1']::uuid[], ARRAY[]::uuid[], NULL, NULL, false, true),
  ('71c00000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'PAK-TYLKO-STD', 'fixed', NULL, 5000, 'PLN',
   ARRAY['71e00000-0000-0000-0000-0000000000a1']::uuid[],
   ARRAY['71700000-0000-0000-0000-0000000000a2']::uuid[], NULL, NULL, true, false),
  ('71c00000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   'PAK-TYLKO-FIRM', 'fixed', NULL, 5000, 'PLN',
   ARRAY['71e00000-0000-0000-0000-0000000000a1']::uuid[],
   ARRAY['71700000-0000-0000-0000-0000000000a1']::uuid[], NULL, NULL, true, false),
  ('71c00000-0000-0000-0000-000000000007', '11111111-1111-1111-1111-111111111111',
   'PAK-RAZ', 'fixed', NULL, 5000, 'PLN',
   ARRAY['71e00000-0000-0000-0000-0000000000a1']::uuid[], ARRAY[]::uuid[], 1, NULL, true, false),
  ('71c00000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111',
   'PAK-OSOBA', 'fixed', NULL, 5000, 'PLN',
   ARRAY['71e00000-0000-0000-0000-0000000000a1']::uuid[], ARRAY[]::uuid[], NULL, 1, true, false),
  ('71c00000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111',
   'PAK-WYSCIG', 'fixed', NULL, 5000, 'PLN',
   ARRAY['71e00000-0000-0000-0000-0000000000a1']::uuid[], ARRAY[]::uuid[], 5, NULL, true, false),
  ('71c00000-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111',
   'PAK-WYSCIG-OS', 'fixed', NULL, 5000, 'PLN',
   ARRAY['71e00000-0000-0000-0000-0000000000a1']::uuid[], ARRAY[]::uuid[], NULL, 1, true, false);

-- Kody pod odmowy wyceny (F) i pod straznikow zuzycia (E). Wszystkie kwotowe
-- -50 zl na to samo wydarzenie, zeby odmowe dawal JEDEN zmieniony warunek.
-- `now()` jest czasem poczatku transakcji, wiec „teraz" jest tym samym
-- momentem w seedzie i w kazdej asercji ponizej.
INSERT INTO public.b2b_coupons
  (id, tenant_id, code, discount_kind, discount_cents, currency, event_ids,
   ticket_type_ids, package_ids, active, valid_from, valid_until)
VALUES
  ('71c00000-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111',
   'PAK-NIEAKT', 'fixed', 5000, 'PLN', ARRAY['71e00000-0000-0000-0000-0000000000a1']::uuid[],
   ARRAY[]::uuid[], ARRAY[]::uuid[], false, NULL, NULL),
  ('71c00000-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
   'PAK-PRZYSZLY', 'fixed', 5000, 'PLN', ARRAY['71e00000-0000-0000-0000-0000000000a1']::uuid[],
   ARRAY[]::uuid[], ARRAY[]::uuid[], true, now() + interval '1 day', NULL),
  ('71c00000-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111',
   'PAK-PRZETERM', 'fixed', 5000, 'PLN', ARRAY['71e00000-0000-0000-0000-0000000000a1']::uuid[],
   ARRAY[]::uuid[], ARRAY[]::uuid[], true, NULL, now()),
  ('71c00000-0000-0000-0000-00000000000e', '11111111-1111-1111-1111-111111111111',
   'PAK-INNE-WYD', 'fixed', 5000, 'PLN', ARRAY['71e00000-0000-0000-0000-0000000000ff']::uuid[],
   ARRAY[]::uuid[], ARRAY[]::uuid[], true, NULL, NULL),
  ('71c00000-0000-0000-0000-00000000000f', '11111111-1111-1111-1111-111111111111',
   'PAK-TYLKO-P3', 'fixed', 5000, 'PLN', ARRAY['71e00000-0000-0000-0000-0000000000a1']::uuid[],
   ARRAY[]::uuid[], ARRAY['71900000-0000-0000-0000-0000000000a3']::uuid[], true, NULL, NULL),
  ('71c00000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111',
   'PAK-EUR', 'fixed', 5000, 'EUR', ARRAY['71e00000-0000-0000-0000-0000000000a1']::uuid[],
   ARRAY[]::uuid[], ARRAY[]::uuid[], true, NULL, NULL),
  -- Zakres rodzaju (Standard) PLUS pakiet P5 wymieniony wprost.
  ('71c00000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111',
   'PAK-STD-I-P5', 'fixed', 5000, 'PLN', ARRAY['71e00000-0000-0000-0000-0000000000a1']::uuid[],
   ARRAY['71700000-0000-0000-0000-0000000000a2']::uuid[],
   ARRAY['71900000-0000-0000-0000-0000000000a5']::uuid[], true, NULL, NULL),
  -- Straznicy zuzycia (E): kod wazny przy wycenie, zamkniety tuz po niej.
  ('71c00000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111',
   'PAK-WYLACZONY', 'fixed', 5000, 'PLN', ARRAY['71e00000-0000-0000-0000-0000000000a1']::uuid[],
   ARRAY[]::uuid[], ARRAY[]::uuid[], true, NULL, NULL),
  ('71c00000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111',
   'PAK-WYGASL', 'fixed', 5000, 'PLN', ARRAY['71e00000-0000-0000-0000-0000000000a1']::uuid[],
   ARRAY[]::uuid[], ARRAY[]::uuid[], true, NULL, NULL),
  ('71c00000-0000-0000-0000-000000000014', '11111111-1111-1111-1111-111111111111',
   'PAK-ODROCZONY', 'fixed', 5000, 'PLN', ARRAY['71e00000-0000-0000-0000-0000000000a1']::uuid[],
   ARRAY[]::uuid[], ARRAY[]::uuid[], true, NULL, NULL);

-- ---------------------------------------------------------------------------
-- A. WYCENA: KOD KWOTOWY SCHODZI Z KAZDEGO MIEJSCA
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_q jsonb;
BEGIN
  PERFORM pg_temp.act_as('71a00000-0000-0000-0000-0000000000a1',
                         '11111111-1111-1111-1111-111111111111');

  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a5'));
  PERFORM pg_temp.assert((v_q->>'ok')::boolean AND (v_q->>'discount_cents')::integer = 0
    AND (v_q->>'total_cents')::integer = 320000,
    '71/wycena: bez kodu pakiet kosztuje swoja cene');
  PERFORM pg_temp.assert(v_q->'discount_kind' = 'null'::jsonb
    AND v_q->'discount_per_seat_cents' = 'null'::jsonb,
    '71/wycena: bez kodu nie ma rodzaju rabatu ani kwoty na miejsce');

  -- Sedno zgloszenia: 5 miejsc x 50 zl = 250 zl rabatu, nie 50 zl.
  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a5', 'coupon_code', 'pak-minus50'));
  PERFORM pg_temp.assert((v_q->>'discount_cents')::integer = 25000,
    '71/wycena: kod -50 zl na pakiet 5 miejsc daje rabat 5 x 50 zl, nie 50 zl');
  PERFORM pg_temp.assert((v_q->>'total_cents')::integer = 295000,
    '71/wycena: do zaplaty 3200 - 250 = 2950 zl');
  PERFORM pg_temp.assert(v_q->>'discount_kind' = 'fixed'
    AND (v_q->>'discount_per_seat_cents')::integer = 5000,
    '71/wycena: odpowiedz niesie rodzaj kodu i kwote na miejsce (ekran pisze „5 x 50 zl")');

  -- Kod 700 zl przy 640 zl za miejsce: kazde miejsce darmowe, nie ujemne.
  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a5', 'coupon_code', 'PAK-MINUS700'));
  PERFORM pg_temp.assert((v_q->>'discount_cents')::integer = 320000
    AND (v_q->>'total_cents')::integer = 0,
    '71/wycena: kod wiekszy od ceny miejsca zeruje pakiet, a nie tworzy naleznosci');
  PERFORM pg_temp.assert((v_q->>'discount_per_seat_cents')::integer = 64000,
    '71/wycena: kwota na miejsce jest ucieta do ceny miejsca (640 zl, nie 700 zl)');

  -- Reszta z dzielenia: 1000 zl / 3 miejsca. Kod 400 zl pokrywa kazde miejsce,
  -- wiec do zaplaty jest ZERO, a nie grosz reszty.
  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a3', 'coupon_code', 'PAK-MINUS700'));
  PERFORM pg_temp.assert((v_q->>'total_cents')::integer = 0
    AND (v_q->>'discount_cents')::integer = 100000
    AND (v_q->>'discount_per_seat_cents')::integer = 33333,
    '71/wycena: cena niepodzielna przez miejsca - kod pokrywajacy miejsca zeruje TAKZE grosz reszty');
  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a3', 'coupon_code', 'PAK-MINUS50'));
  PERFORM pg_temp.assert((v_q->>'discount_cents')::integer = 15000
    AND (v_q->>'total_cents')::integer = 85000,
    '71/wycena: pakiet 3 miejsc z kodem -50 zl kosztuje 850 zl');

  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a5', 'coupon_code', 'PAK-10PROC'));
  PERFORM pg_temp.assert((v_q->>'discount_cents')::integer = 32000
    AND (v_q->>'total_cents')::integer = 288000,
    '71/wycena: kod procentowy bez zmian - 10% od sumy to 10% od kazdego miejsca');
  PERFORM pg_temp.assert(v_q->>'discount_kind' = 'percent'
    AND v_q->'discount_per_seat_cents' = 'null'::jsonb,
    '71/wycena: kod procentowy nie udaje kwoty na miejsce');

  -- Wejsciowka to jedno miejsce - kod kwotowy schodzi raz, jak dotad.
  v_q := public.event_admission_quote(jsonb_build_object(
    'ticket_type_id', '71700000-0000-0000-0000-0000000000a2', 'coupon_code', 'PAK-MINUS50'));
  PERFORM pg_temp.assert((v_q->>'discount_cents')::integer = 5000
    AND (v_q->>'total_cents')::integer = 55000
    AND (v_q->>'seats')::integer = 1,
    '71/wycena: pojedyncza wejsciowka - kod kwotowy schodzi raz (1 miejsce)');
END $do$;

-- ---------------------------------------------------------------------------
-- B. ODMOWY: KOD BEZ RABATU I KOD Z INNEGO ZAKRESU BILETOW
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_q jsonb;
BEGIN
  PERFORM pg_temp.act_as('71a00000-0000-0000-0000-0000000000a1',
                         '11111111-1111-1111-1111-111111111111');

  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a5', 'coupon_code', 'PAK-ODSLON'));
  PERFORM pg_temp.assert(NOT (v_q->>'ok')::boolean AND v_q->>'reason' = 'coupon_no_discount',
    '71/ODMOWA: kod TYLKO odslaniajacy nie daje pakietu za zero zlotych - odmowa coupon_no_discount');
  PERFORM pg_temp.assert(v_q->'total_cents' IS NULL,
    '71/ODMOWA: odmowa kodu bez rabatu nie niesie zadnej kwoty do zaplaty');

  v_q := public.event_admission_quote(jsonb_build_object(
    'ticket_type_id', '71700000-0000-0000-0000-0000000000a2', 'coupon_code', 'PAK-ODSLON'));
  PERFORM pg_temp.assert(v_q->>'reason' = 'coupon_no_discount',
    '71/ODMOWA: ta sama odmowa dla pojedynczej wejsciowki w tej wycenie');

  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a5', 'coupon_code', 'PAK-TYLKO-STD'));
  PERFORM pg_temp.assert(NOT (v_q->>'ok')::boolean
    AND v_q->>'reason' = 'coupon_other_ticket_type',
    '71/ODMOWA: kod zawezony do INNEGO rodzaju wejsciowki nie dziala na pakiet');

  -- Kontrapunkt: bez niego odmowa wyzej nie odroznia zakresu od blokady.
  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a5', 'coupon_code', 'PAK-TYLKO-FIRM'));
  PERFORM pg_temp.assert((v_q->>'ok')::boolean AND (v_q->>'discount_cents')::integer = 25000,
    '71/zakres: kod zawezony do rodzaju pakietu dziala - i tez od kazdego miejsca');

  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.event_package_purchase(jsonb_build_object(
         'package_id', '71900000-0000-0000-0000-0000000000a5', 'coupon_code', 'PAK-ODSLON'))$q$,
    'refused_coupon_no_discount',
    '71/ODMOWA: zakup z kodem bez rabatu odmawia z ta sama nazwa');
END $do$;

-- ---------------------------------------------------------------------------
-- C. ZAKUP: KWOTY W ZAMOWIENIU I ZUZYCIE KODU RAZ
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_res jsonb;
  v_n integer;
  v_order public.event_package_orders;
  v_red public.b2b_coupon_redemptions;
BEGIN
  PERFORM pg_temp.act_as('71a00000-0000-0000-0000-0000000000a1',
                         '11111111-1111-1111-1111-111111111111');

  -- Wycena jest STABLE i niczego nie zuzywa, ile razy by jej nie wolac.
  PERFORM public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a5', 'coupon_code', 'PAK-MINUS50'));
  PERFORM public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a5', 'coupon_code', 'PAK-MINUS50'));
  SELECT c.redemptions_count INTO v_n FROM public.b2b_coupons c
  WHERE c.id = '71c00000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(v_n = 0, '71/zuzycie: sama wycena nie zuzywa kodu');

  v_res := public.event_package_purchase(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a5', 'coupon_code', 'PAK-MINUS50',
    'buyer_name', 'Firma Testowa'));
  PERFORM pg_temp.assert((v_res->>'total_cents')::integer = 295000
    AND (v_res->>'discount_cents')::integer = 25000,
    '71/zakup: odpowiedz niesie kwote po rabacie od kazdego miejsca');

  SELECT * INTO v_order FROM public.event_package_orders o
  WHERE o.id = (v_res->>'order_id')::uuid;
  PERFORM pg_temp.assert(v_order.amount_cents = 295000 AND v_order.discount_cents = 25000
    AND v_order.coupon_id = '71c00000-0000-0000-0000-000000000001',
    '71/zakup: zamowienie zapisuje 2950 zl, rabat 250 zl i kod');

  SELECT c.redemptions_count INTO v_n FROM public.b2b_coupons c
  WHERE c.id = '71c00000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(v_n = 1,
    '71/zuzycie: zakup zuzywa JEDNO uzycie kodu (licznik liczy zamowienia, nie miejsca)');

  SELECT count(*)::integer INTO v_n FROM public.b2b_coupon_redemptions r
  WHERE r.coupon_id = '71c00000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(v_n = 1, '71/zuzycie: dokladnie jeden wiersz realizacji');

  SELECT * INTO v_red FROM public.b2b_coupon_redemptions r
  WHERE r.coupon_id = '71c00000-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(v_red.order_id IS NULL
    AND v_red.user_id = '71a00000-0000-0000-0000-0000000000a1'
    AND v_red.tenant_id = '11111111-1111-1111-1111-111111111111'
    AND v_red.applied_cents = 25000 AND v_red.original_cents = 320000
    AND v_red.currency = 'PLN',
    '71/zuzycie: wiersz realizacji - kupujacy, rabat, cena przed rabatem, bez payment_orders');
  -- Wskazanie zamowienia pakietu (20260926130000) - po nim anulowanie oddaje uzycie.
  PERFORM pg_temp.assert(v_red.package_order_id = v_order.id,
    '71/zuzycie: wiersz realizacji wskazuje zamowienie pakietu (package_order_id)');

  -- Zakup BEZ kodu nie dotyka zadnego licznika kodow.
  v_res := public.event_package_purchase(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a3'));
  PERFORM pg_temp.assert((v_res->>'total_cents')::integer = 100000
    AND (v_res->>'discount_cents')::integer = 0,
    '71/zakup: bez kodu pelna cena');
  SELECT count(*)::integer INTO v_n FROM public.b2b_coupon_redemptions r
  WHERE r.user_id = '71a00000-0000-0000-0000-0000000000a1';
  PERFORM pg_temp.assert(v_n = 1, '71/zuzycie: zakup bez kodu nie dopisuje realizacji');
END $do$;

-- ---------------------------------------------------------------------------
-- D. LIMITY: WYCZERPANY KOD I LIMIT NA OSOBE
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_n integer;
BEGIN
  PERFORM pg_temp.act_as('71a00000-0000-0000-0000-0000000000a1',
                         '11111111-1111-1111-1111-111111111111');

  PERFORM public.event_package_purchase(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a3', 'coupon_code', 'PAK-RAZ'));
  PERFORM pg_temp.assert(
    (SELECT c.redemptions_count FROM public.b2b_coupons c
      WHERE c.id = '71c00000-0000-0000-0000-000000000007') = 1,
    '71/limit: pierwszy zakup zuzyl jedyne uzycie');

  -- Drugi kupujacy: kod z limitem 1 jest juz wyczerpany - przed ta migracja
  -- licznik stal na zerze i kod dzialal bez konca.
  PERFORM pg_temp.act_as('71a00000-0000-0000-0000-0000000000a2',
                         '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert(
    public.event_admission_quote(jsonb_build_object(
      'package_id', '71900000-0000-0000-0000-0000000000a3', 'coupon_code', 'PAK-RAZ'))->>'reason'
      = 'coupon_exhausted',
    '71/limit: wycena po wyczerpaniu mowi coupon_exhausted');
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.event_package_purchase(jsonb_build_object(
         'package_id', '71900000-0000-0000-0000-0000000000a3', 'coupon_code', 'PAK-RAZ'))$q$,
    'refused_coupon_exhausted: coupon_exhausted',
    '71/limit: drugi zakup z wyczerpanym kodem odmowiony');

  -- Limit na osobe: ta sama osoba drugi raz - odmowa; inna osoba - zgoda.
  PERFORM pg_temp.act_as('71a00000-0000-0000-0000-0000000000a1',
                         '11111111-1111-1111-1111-111111111111');
  PERFORM public.event_package_purchase(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a3', 'coupon_code', 'PAK-OSOBA'));
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.event_package_purchase(jsonb_build_object(
         'package_id', '71900000-0000-0000-0000-0000000000a3', 'coupon_code', 'PAK-OSOBA'))$q$,
    'refused_coupon_used_by_you: coupon_used_by_you',
    '71/limit na osobe: ta sama osoba nie uzyje kodu drugi raz');

  PERFORM pg_temp.act_as('71a00000-0000-0000-0000-0000000000a2',
                         '11111111-1111-1111-1111-111111111111');
  PERFORM public.event_package_purchase(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a3', 'coupon_code', 'PAK-OSOBA'));
  SELECT c.redemptions_count INTO v_n FROM public.b2b_coupons c
  WHERE c.id = '71c00000-0000-0000-0000-000000000008';
  PERFORM pg_temp.assert(v_n = 2,
    '71/limit na osobe: inna osoba uzywa tego samego kodu (kontrapunkt)');
END $do$;

-- ---------------------------------------------------------------------------
-- E. WYSCIG MIEDZY WYCENA A ZUZYCIEM
--
-- Wycena sprawdza limity BEZ blokady, wiec rownolegly zakup moze zabrac
-- ostatnie uzycie po niej. W jednej sesji nie da sie przepuscic drugiej
-- transakcji, wiec robi to wyzwalacz TESTOWY na wstawieniu zamowienia (ktore
-- stoi miedzy wycena a zuzyciem): „ktos inny wlasnie zuzyl kod". Wyzwalacz
-- ginie razem z ROLLBACK na koncu pliku.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public._t71_concurrent_coupon_use() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.coupon_id = '71c00000-0000-0000-0000-000000000009' THEN
    UPDATE public.b2b_coupons SET redemptions_count = max_redemptions
    WHERE id = NEW.coupon_id;
  ELSIF NEW.coupon_id = '71c00000-0000-0000-0000-00000000000a' THEN
    INSERT INTO public.b2b_coupon_redemptions
      (tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency)
    VALUES (NEW.tenant_id, NEW.coupon_id, NULL, NEW.buyer_user_id, 5000, 100000, 'PLN');
  -- Admin WYLACZA kod, konczy jego waznosc albo przesuwa jej poczatek w przod,
  -- gdy zakup stoi miedzy wycena a zuzyciem. Warunkowy UPDATE licznika musi to
  -- zobaczyc - inaczej zamkniety kod dalby rabat ostatniemu kupujacemu.
  ELSIF NEW.coupon_id = '71c00000-0000-0000-0000-000000000012' THEN
    UPDATE public.b2b_coupons SET active = false WHERE id = NEW.coupon_id;
  ELSIF NEW.coupon_id = '71c00000-0000-0000-0000-000000000013' THEN
    UPDATE public.b2b_coupons SET valid_until = now() WHERE id = NEW.coupon_id;
  ELSIF NEW.coupon_id = '71c00000-0000-0000-0000-000000000014' THEN
    UPDATE public.b2b_coupons SET valid_from = now() + interval '1 day'
    WHERE id = NEW.coupon_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER _t71_concurrent_coupon_use
  AFTER INSERT ON public.event_package_orders
  FOR EACH ROW EXECUTE FUNCTION public._t71_concurrent_coupon_use();

DO $do$
DECLARE
  v_sold integer;
  v_seats integer;
BEGIN
  PERFORM pg_temp.act_as('71a00000-0000-0000-0000-0000000000a2',
                         '11111111-1111-1111-1111-111111111111');
  SELECT p.sold_count INTO v_sold FROM public.event_ticket_packages p
  WHERE p.id = '71900000-0000-0000-0000-0000000000a3';
  SELECT t.sold_count INTO v_seats FROM public.event_ticket_types t
  WHERE t.id = '71700000-0000-0000-0000-0000000000a1';

  PERFORM pg_temp.assert(
    (public.event_admission_quote(jsonb_build_object(
      'package_id', '71900000-0000-0000-0000-0000000000a3',
      'coupon_code', 'PAK-WYSCIG'))->>'ok')::boolean,
    '71/wyscig: przed zakupem wycena kodu przechodzi (wolne uzycia sa)');
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.event_package_purchase(jsonb_build_object(
         'package_id', '71900000-0000-0000-0000-0000000000a3', 'coupon_code', 'PAK-WYSCIG'))$q$,
    'last use taken by a concurrent order',
    '71/wyscig: ostatnie uzycie zabrane miedzy wycena a zuzyciem - zakup odmawia');

  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.event_package_purchase(jsonb_build_object(
         'package_id', '71900000-0000-0000-0000-0000000000a3', 'coupon_code', 'PAK-WYSCIG-OS'))$q$,
    'refused_coupon_used_by_you: code already used by this buyer in a concurrent order',
    '71/wyscig: ta sama osoba uzyla kodu w rownoleglym zamowieniu - zakup odmawia');

  -- Straznicy warunkowego UPDATE-u: kod zamkniety po wycenie nie jest zuzyty.
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.event_package_purchase(jsonb_build_object(
         'package_id', '71900000-0000-0000-0000-0000000000a3', 'coupon_code', 'PAK-WYLACZONY'))$q$,
    'refused_coupon_exhausted: last use taken by a concurrent order',
    '71/wyscig: kod WYLACZONY miedzy wycena a zuzyciem - zakup odmawia (straznik c.active)');
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.event_package_purchase(jsonb_build_object(
         'package_id', '71900000-0000-0000-0000-0000000000a3', 'coupon_code', 'PAK-WYGASL'))$q$,
    'refused_coupon_exhausted: last use taken by a concurrent order',
    '71/wyscig: kod WYGASL miedzy wycena a zuzyciem - zakup odmawia (straznik valid_until)');
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.event_package_purchase(jsonb_build_object(
         'package_id', '71900000-0000-0000-0000-0000000000a3', 'coupon_code', 'PAK-ODROCZONY'))$q$,
    'refused_coupon_exhausted: last use taken by a concurrent order',
    '71/wyscig: poczatek waznosci przesuniety w przod miedzy wycena a zuzyciem - zakup odmawia (straznik valid_from)');
  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.b2b_coupons c
      WHERE c.id IN ('71c00000-0000-0000-0000-000000000012',
                     '71c00000-0000-0000-0000-000000000013',
                     '71c00000-0000-0000-0000-000000000014')
        AND c.redemptions_count = 0 AND c.active AND c.valid_until IS NULL
        AND c.valid_from IS NULL) = 3
    AND (SELECT count(*) FROM public.b2b_coupon_redemptions r
      WHERE r.coupon_id IN ('71c00000-0000-0000-0000-000000000012',
                            '71c00000-0000-0000-0000-000000000013',
                            '71c00000-0000-0000-0000-000000000014')) = 0,
    '71/wyscig: odmowa wycofuje TAKZE zmiane kodu z wyzwalacza i nie zostawia realizacji');

  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_package_orders o
      WHERE o.coupon_id IN ('71c00000-0000-0000-0000-000000000009',
                            '71c00000-0000-0000-0000-00000000000a',
                            '71c00000-0000-0000-0000-000000000012',
                            '71c00000-0000-0000-0000-000000000013',
                            '71c00000-0000-0000-0000-000000000014')) = 0,
    '71/wyscig: odmowa wycofuje zamowienie - nie zostaje wiersz bez zuzytego kodu');
  PERFORM pg_temp.assert(
    (SELECT p.sold_count FROM public.event_ticket_packages p
      WHERE p.id = '71900000-0000-0000-0000-0000000000a3') = v_sold
    AND (SELECT t.sold_count FROM public.event_ticket_types t
      WHERE t.id = '71700000-0000-0000-0000-0000000000a1') = v_seats,
    '71/wyscig: odmowa wycofuje tez pule zestawow i miejsc');
  PERFORM pg_temp.assert(
    (SELECT c.redemptions_count FROM public.b2b_coupons c
      WHERE c.id = '71c00000-0000-0000-0000-000000000009') = 0,
    '71/wyscig: licznik kodu wraca do stanu sprzed odrzuconego zakupu');
END $do$;

-- ---------------------------------------------------------------------------
-- F. KAZDA ODMOWA WYCENY
--
-- Migracja przepisuje `event_admission_quote` w calosci, wiec kazda jej galaz
-- ma tu asercje - takze te, ktorych ta zmiana nie ruszala. Odmowa, ktorej nikt
-- nie wywoluje, moze po cichu przestac odmawiac przy nastepnym przepisaniu.
-- ---------------------------------------------------------------------------
DO $do$
DECLARE
  v_q jsonb;
BEGIN
  -- Bez zalogowania nie ma najemcy ani kupujacego.
  PERFORM pg_temp.act_as();
  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a5'));
  PERFORM pg_temp.assert(NOT (v_q->>'ok')::boolean AND v_q->>'reason' = 'sign_in_required',
    '71/wycena: anonim dostaje sign_in_required, nie cene');

  PERFORM pg_temp.act_as('71a00000-0000-0000-0000-0000000000a1',
                         '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.event_admission_quote(jsonb_build_object(
         'package_id', '71900000-0000-0000-0000-0000000000a5',
         'ticket_type_id', '71700000-0000-0000-0000-0000000000a1'))$q$,
    'invalid_payload: give exactly one',
    '71/wycena: pakiet ORAZ wejsciowka naraz to blad ladunku');
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.event_admission_quote('{}'::jsonb)$q$,
    'invalid_payload: give exactly one',
    '71/wycena: ani pakiet, ani wejsciowka - blad ladunku');

  v_q := public.event_admission_quote(jsonb_build_object(
    'ticket_type_id', '71700000-0000-0000-0000-0000000000ff'));
  PERFORM pg_temp.assert(v_q->>'reason' = 'not_found',
    '71/wycena: nieznana wejsciowka - not_found');
  v_q := public.event_admission_quote(jsonb_build_object(
    'ticket_type_id', '71700000-0000-0000-0000-0000000000a3'));
  PERFORM pg_temp.assert(v_q->>'reason' = 'inactive',
    '71/wycena: wejsciowka wylaczona - inactive');
  v_q := public.event_admission_quote(jsonb_build_object(
    'ticket_type_id', '71700000-0000-0000-0000-0000000000a4'));
  PERFORM pg_temp.assert(v_q->>'reason' = 'sales_not_open' AND v_q->>'sales_from' IS NOT NULL,
    '71/wycena: sprzedaz jeszcze nie ruszyla - sales_not_open z data startu');
  v_q := public.event_admission_quote(jsonb_build_object(
    'ticket_type_id', '71700000-0000-0000-0000-0000000000a5'));
  PERFORM pg_temp.assert(v_q->>'reason' = 'sales_closed',
    '71/wycena: sprzedaz zamknieta - sales_closed');
  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a6'));
  PERFORM pg_temp.assert(v_q->>'reason' = 'sold_out',
    '71/wycena: pula zestawow wyczerpana - sold_out');
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.event_package_purchase(jsonb_build_object(
         'package_id', '71900000-0000-0000-0000-0000000000a6'))$q$,
    'refused_sold_out',
    '71/zakup: wyprzedany pakiet odmawia juz na wycenie');
  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a7'));
  PERFORM pg_temp.assert((v_q->>'ok')::boolean AND (v_q->>'seats_left')::integer = 1,
    '71/wycena: pakiet z pula mowi, ile zestawow zostalo (2 - 1 = 1)');
  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a5'));
  PERFORM pg_temp.assert(v_q->'seats_left' = 'null'::jsonb,
    '71/wycena: pakiet bez puli nie udaje liczby zostalych zestawow');

  -- Ranga czlonkostwa: bez niej odmowa, z nia zgoda.
  v_q := public.event_admission_quote(jsonb_build_object(
    'ticket_type_id', '71700000-0000-0000-0000-0000000000a6'));
  PERFORM pg_temp.assert(v_q->>'reason' = 'tier_required'
    AND (v_q->>'min_tier_rank')::integer = 2,
    '71/wycena: wejsciowka dla rangi 2 odmawia bez rangi - tier_required');
  PERFORM pg_temp.act_as('71a00000-0000-0000-0000-0000000000a1',
                         '11111111-1111-1111-1111-111111111111', 2);
  v_q := public.event_admission_quote(jsonb_build_object(
    'ticket_type_id', '71700000-0000-0000-0000-0000000000a6'));
  PERFORM pg_temp.assert((v_q->>'ok')::boolean,
    '71/wycena: z ranga 2 ta sama wejsciowka przechodzi (kontrapunkt)');
  PERFORM pg_temp.act_as('71a00000-0000-0000-0000-0000000000a1',
                         '11111111-1111-1111-1111-111111111111');

  -- Kazda odmowa KODU - kolejno tak, jak sprawdza je funkcja.
  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a5', 'coupon_code', 'NIE-MA-TAKIEGO'));
  PERFORM pg_temp.assert(v_q->>'reason' = 'coupon_unknown',
    '71/kod: nieistniejacy kod - coupon_unknown');
  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a5', 'coupon_code', 'PAK-NIEAKT'));
  PERFORM pg_temp.assert(v_q->>'reason' = 'coupon_unknown',
    '71/kod: kod wylaczony wyglada jak nieznany - coupon_unknown');
  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a5', 'coupon_code', 'PAK-PRZYSZLY'));
  PERFORM pg_temp.assert(v_q->>'reason' = 'coupon_not_yet_valid',
    '71/kod: kod przed poczatkiem waznosci - coupon_not_yet_valid');
  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a5', 'coupon_code', 'PAK-PRZETERM'));
  PERFORM pg_temp.assert(v_q->>'reason' = 'coupon_expired',
    '71/kod: kod po koncu waznosci - coupon_expired');
  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a5', 'coupon_code', 'PAK-INNE-WYD'));
  PERFORM pg_temp.assert(v_q->>'reason' = 'coupon_other_event',
    '71/kod: kod innego wydarzenia - coupon_other_event');
  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a5', 'coupon_code', 'PAK-TYLKO-P3'));
  PERFORM pg_temp.assert(v_q->>'reason' = 'coupon_other_package',
    '71/kod: kod zawezony do innego pakietu - coupon_other_package');
  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a3', 'coupon_code', 'PAK-TYLKO-P3'));
  PERFORM pg_temp.assert((v_q->>'ok')::boolean AND (v_q->>'discount_cents')::integer = 15000,
    '71/kod: ten sam kod na SWOIM pakiecie dziala (kontrapunkt)');
  v_q := public.event_admission_quote(jsonb_build_object(
    'ticket_type_id', '71700000-0000-0000-0000-0000000000a2', 'coupon_code', 'PAK-TYLKO-P3'));
  PERFORM pg_temp.assert((v_q->>'ok')::boolean,
    '71/kod: zakres pakietow nie zaweza wejsciowek');
  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a5', 'coupon_code', 'PAK-EUR'));
  PERFORM pg_temp.assert(v_q->>'reason' = 'coupon_other_currency',
    '71/kod: kod w EUR na pakiet w PLN - coupon_other_currency');

  -- ZAKRES RODZAJU DLA WEJSCIOWKI. `v_scope_type` jest ustawiany osobno dla
  -- wejsciowki i dla pakietu; bez tej pary asercji zgubione przypisanie
  -- (NULL = ANY(...) to NULL, czyli „przepusc") przeszloby niezauwazone.
  v_q := public.event_admission_quote(jsonb_build_object(
    'ticket_type_id', '71700000-0000-0000-0000-0000000000a1', 'coupon_code', 'PAK-TYLKO-STD'));
  PERFORM pg_temp.assert(NOT (v_q->>'ok')::boolean
    AND v_q->>'reason' = 'coupon_other_ticket_type',
    '71/zakres: kod tylko na Standard odmawia na wejsciowce Firmowa');
  v_q := public.event_admission_quote(jsonb_build_object(
    'ticket_type_id', '71700000-0000-0000-0000-0000000000a2', 'coupon_code', 'PAK-TYLKO-STD'));
  PERFORM pg_temp.assert((v_q->>'ok')::boolean AND (v_q->>'discount_cents')::integer = 5000,
    '71/zakres: kod tylko na Standard dziala na wejsciowce Standard (kontrapunkt)');

  -- PIERWSZENSTWO PAKIETU WYMIENIONEGO WPROST. Kod „Standard + P5": P5 dziala,
  -- choc jego rodzaj to Firmowa, a P3 (ten sam rodzaj, niewymieniony) - nie.
  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a5', 'coupon_code', 'PAK-STD-I-P5'));
  PERFORM pg_temp.assert((v_q->>'ok')::boolean AND (v_q->>'discount_cents')::integer = 25000,
    '71/zakres: pakiet wymieniony w package_ids dziala mimo zakresu innego rodzaju');
  v_q := public.event_admission_quote(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a3', 'coupon_code', 'PAK-STD-I-P5'));
  PERFORM pg_temp.assert(v_q->>'reason' = 'coupon_other_ticket_type',
    '71/zakres: pakiet NIEwymieniony, innego rodzaju - dalej odmowa');
  v_q := public.event_admission_quote(jsonb_build_object(
    'ticket_type_id', '71700000-0000-0000-0000-0000000000a2', 'coupon_code', 'PAK-STD-I-P5'));
  PERFORM pg_temp.assert((v_q->>'ok')::boolean,
    '71/zakres: ten sam kod dziala na wejsciowce Standard');
  v_q := public.event_admission_quote(jsonb_build_object(
    'ticket_type_id', '71700000-0000-0000-0000-0000000000a1', 'coupon_code', 'PAK-STD-I-P5'));
  PERFORM pg_temp.assert(v_q->>'reason' = 'coupon_other_ticket_type',
    '71/zakres: wymieniony pakiet nie otwiera kodu dla wejsciowki swojego rodzaju');

  -- LIMIT NA OSOBE (tylko wejsciowka). Drugi kupujacy ma juz zgloszenie na
  -- Standard z limitem 1 - trzecia wycena odmawia, zgloszenie odwolane nie.
  INSERT INTO public.event_people (id, tenant_id, user_id, email, first_name, last_name) VALUES
    ('71600000-0000-0000-0000-0000000000a2', '11111111-1111-1111-1111-111111111111',
     '71a00000-0000-0000-0000-0000000000a2', 'pakiet.drugi@example.org', 'Druga', 'Osoba');
  INSERT INTO public.event_registrations
    (id, tenant_id, event_id, person_id, ticket_type_id, status, registration_mode,
     payment_status, cancelled_at)
  VALUES
    ('71500000-0000-0000-0000-0000000000a1', '11111111-1111-1111-1111-111111111111',
     '71e00000-0000-0000-0000-0000000000a1', '71600000-0000-0000-0000-0000000000a2',
     '71700000-0000-0000-0000-0000000000a2', 'cancelled', 'form', 'not_required', now());
  PERFORM pg_temp.act_as('71a00000-0000-0000-0000-0000000000a2',
                         '11111111-1111-1111-1111-111111111111');
  v_q := public.event_admission_quote(jsonb_build_object(
    'ticket_type_id', '71700000-0000-0000-0000-0000000000a2'));
  PERFORM pg_temp.assert((v_q->>'ok')::boolean,
    '71/limit na osobe: zgloszenie ODWOLANE nie zajmuje limitu');
  UPDATE public.event_registrations
  SET status = 'pending', payment_status = 'unpaid', cancelled_at = NULL
  WHERE id = '71500000-0000-0000-0000-0000000000a1';
  v_q := public.event_admission_quote(jsonb_build_object(
    'ticket_type_id', '71700000-0000-0000-0000-0000000000a2'));
  PERFORM pg_temp.assert(v_q->>'reason' = 'per_person_limit'
    AND (v_q->>'max_per_person')::integer = 1 AND (v_q->>'owned')::integer = 1,
    '71/limit na osobe: druga wejsciowka tej samej osoby - per_person_limit');
END $do$;

-- ---------------------------------------------------------------------------
-- G. ZAKUP: POZOSTALE GALEZIE
-- ---------------------------------------------------------------------------
-- Pakiet bez rodzaju wejsciowki nie powstanie przez klucz obcy - straznik
-- `not_found` zakupu jest na stan, ktorego silnik nie dopuszcza. Zeby go
-- WYWOLAC, wstawiamy taki wiersz z wylaczonymi wyzwalaczami kluczy obcych
-- (`session_replication_role = replica`, tylko superuzytkownik harnessu)
-- i od razu je przywracamy. Wycena czyta sam pakiet, wiec przechodzi.
SET session_replication_role = replica;
INSERT INTO public.event_ticket_packages
  (id, tenant_id, event_id, ticket_type_id, key, name_pl, name_en, audience,
   seats, price_cents, currency, quota)
VALUES
  ('71900000-0000-0000-0000-0000000000a9', '11111111-1111-1111-1111-111111111111',
   '71e00000-0000-0000-0000-0000000000a1', '71700000-0000-0000-0000-0000000000fe',
   'osierocony', 'Pakiet osierocony', 'Orphan', 'company', 2, 100000, 'PLN', NULL);
SET session_replication_role = origin;

DO $do$
DECLARE
  v_res jsonb;
  v_email text;
BEGIN
  PERFORM pg_temp.act_as();
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.event_package_purchase(jsonb_build_object(
         'package_id', '71900000-0000-0000-0000-0000000000a3'))$q$,
    'forbidden: authentication required',
    '71/zakup: anonim nie kupuje pakietu');

  PERFORM pg_temp.act_as('71a00000-0000-0000-0000-0000000000a1',
                         '11111111-1111-1111-1111-111111111111');
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.event_package_purchase('{}'::jsonb)$q$,
    'invalid_payload: package_id is required',
    '71/zakup: bez pakietu - blad ladunku');

  -- Pula ZESTAWOW jest wolna, pula MIEJSC sali (4) mniejsza niz pakiet (5).
  PERFORM pg_temp.assert(
    (public.event_admission_quote(jsonb_build_object(
      'package_id', '71900000-0000-0000-0000-0000000000a8'))->>'ok')::boolean,
    '71/zakup: wycena pakietu za duzego na sale przechodzi (liczy zestawy)');
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.event_package_purchase(jsonb_build_object(
         'package_id', '71900000-0000-0000-0000-0000000000a8'))$q$,
    'seats_exhausted',
    '71/zakup: 5 miejsc na sali z pula 4 - seats_exhausted, bez zamowienia');

  PERFORM pg_temp.assert(
    (public.event_admission_quote(jsonb_build_object(
      'package_id', '71900000-0000-0000-0000-0000000000a9'))->>'ok')::boolean,
    '71/zakup: wycena pakietu osieroconego przechodzi (czyta sam pakiet)');
  PERFORM pg_temp.assert_raises_like(
    $q$SELECT public.event_package_purchase(jsonb_build_object(
         'package_id', '71900000-0000-0000-0000-0000000000a9'))$q$,
    'not_found: package does not exist in this tenant',
    '71/zakup: pakiet bez rodzaju wejsciowki - not_found, bez zamowienia');

  -- E-mail kupujacego z ladunku wygrywa z e-mailem konta i jest znormalizowany.
  v_res := public.event_package_purchase(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a3',
    'buyer_email', '  Zakupy@Firma.PL '));
  SELECT o.buyer_email INTO v_email FROM public.event_package_orders o
  WHERE o.id = (v_res->>'order_id')::uuid;
  PERFORM pg_temp.assert(v_email = 'zakupy@firma.pl',
    '71/zakup: e-mail z ladunku zapisany malymi literami, bez spacji');
  v_res := public.event_package_purchase(jsonb_build_object(
    'package_id', '71900000-0000-0000-0000-0000000000a3'));
  SELECT o.buyer_email INTO v_email FROM public.event_package_orders o
  WHERE o.id = (v_res->>'order_id')::uuid;
  PERFORM pg_temp.assert(v_email = 'pakiet.kupujacy@example.org',
    '71/zakup: bez e-maila w ladunku zamowienie bierze e-mail konta');
END $do$;

ROLLBACK;

\echo '== 71 pakiet grupowy i kod rabatowy: koniec =='
