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
--      realizacji z user_id i order_id NULL), sama wycena niczego nie zuzywa,
--      zakup bez kodu nie dotyka licznikow;
--   D. limity: wyczerpany kod odmawia drugiego zakupu, limit na osobe odmawia
--      tej samej osobie, a nie innej;
--   E. wyscig: kod wyczerpany albo uzyty przez te sama osobe MIEDZY wycena
--      a zuzyciem - zakup odmawia i wycofuje zamowienie oraz pule.
--
-- CZEGO NIE SPRAWDZA: ekranu zakupu (vitest EventPackagesPurchase), kasy zapisu
-- grupowego (vitest checkoutGroupCoupon) ani zwrotu uzycia przy anulowaniu
-- zamowienia - tego ta migracja nie zmienia.
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

  PERFORM pg_temp.assert(
    (SELECT count(*) FROM public.event_package_orders o
      WHERE o.coupon_id IN ('71c00000-0000-0000-0000-000000000009',
                            '71c00000-0000-0000-0000-00000000000a')) = 0,
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

ROLLBACK;

\echo '== 71 pakiet grupowy i kod rabatowy: koniec =='
