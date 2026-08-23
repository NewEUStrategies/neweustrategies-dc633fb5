-- pgTAP: ograniczenia kwotowe kuponów B2B - dowód, że baza ich PILNUJE.
--
-- USTALENIE, KTÓRE ODWRÓCIŁO CEL TEGO PLIKU. Zlecenie zakładało, że
-- `b2b_coupons` nie ma CHECK-ów na kwocie i że „walidacja kwoty istnieje
-- wyłącznie w panelu". Lektura migracji zakładającej tabelę
-- (20260721070203_a0e336e0-eaf3-4342-9435-40e076ebf0dd.sql) pokazuje coś
-- innego: baza egzekwuje WSZYSTKIE CZTERY warunki, o które pytało zlecenie -
-- zakres procentu, dodatniość kwoty, spójność rodzaju rabatu z polem kwoty
-- oraz dodatniość limitu wykorzystań. Ten plik nie dokumentuje więc BRAKU,
-- a chroni OBECNOŚĆ: każdy z tych CHECK-ów jest tu przypięty testem, bo
-- ich utrata jest cicha (panel nadal waliduje, więc nikt nie zauważy, dopóki
-- ktoś nie wpisze kuponu przez API).
--
-- CO WOLNO CZYTAĆ Z ZIELENI TEGO PLIKU: że kupon o niepoprawnej kwocie nie
-- osiądzie w tabeli NAWET wtedy, gdy ominięto panel (własny skrypt, PostgREST,
-- import). Panel `/admin/coupons` jest drugą, wcześniejszą linią - nie jedyną.
--
-- JEDNA REALNA LUKA, udokumentowana na końcu pliku: kolumna `currency` NIE ma
-- ani CHECK-a, ani powiązania z `discount_kind`. Kupon kwotowy z `currency
-- IS NULL` przechodzi przez bazę, a spójność trzyma wyłącznie panel
-- (`currency: kind === "fixed" ? currency.toUpperCase() : null`). Ostatnie dwie
-- asercje opisują ten stan FAKTYCZNY - są dokumentacją luki, nie jej akceptacją;
-- domknięcie wymaga migracji, a ta jest poza zakresem tego zlecenia.
--
-- Uruchamianie: `supabase test db` (albo `bun run test:pgtap-local`).

BEGIN;
SELECT plan(19);

INSERT INTO public.tenants (id, slug, name, domain) VALUES
  ('b1111111-1111-1111-1111-1111111111b1', 'cpn-money', 'Coupon Money Tenant',
   'cpn-money.example');

-- Skrót: wstawka kuponu z podmienialnymi polami kwoty.
-- `code` jest unikalny per najemca, więc każda próba dostaje własny.

-- ═══════════════════════════════════════════════════════════════════════════
-- (1) discount_percent BETWEEN 1 AND 100
-- ═══════════════════════════════════════════════════════════════════════════

SELECT throws_ok(
  $$INSERT INTO public.b2b_coupons
      (tenant_id, code, discount_kind, discount_percent)
    VALUES ('b1111111-1111-1111-1111-1111111111b1', 'PCT_ZERO', 'percent', 0)$$,
  '23514',
  NULL,
  'discount_percent = 0 ODRZUCONE (rabat zerowy nie jest rabatem)'
);

SELECT throws_ok(
  $$INSERT INTO public.b2b_coupons
      (tenant_id, code, discount_kind, discount_percent)
    VALUES ('b1111111-1111-1111-1111-1111111111b1', 'PCT_101', 'percent', 101)$$,
  '23514',
  NULL,
  'discount_percent = 101 ODRZUCONE (rabat powyżej 100% to kwota do zwrotu)'
);

SELECT throws_ok(
  $$INSERT INTO public.b2b_coupons
      (tenant_id, code, discount_kind, discount_percent)
    VALUES ('b1111111-1111-1111-1111-1111111111b1', 'PCT_NEG', 'percent', -20)$$,
  '23514',
  NULL,
  'discount_percent ujemny ODRZUCONY (rabat ujemny podniósłby cenę)'
);

SELECT lives_ok(
  $$INSERT INTO public.b2b_coupons
      (tenant_id, code, discount_kind, discount_percent)
    VALUES ('b1111111-1111-1111-1111-1111111111b1', 'PCT_1', 'percent', 1)$$,
  'discount_percent = 1 PRZYJĘTE (dolna granica jest włączna)'
);

SELECT lives_ok(
  $$INSERT INTO public.b2b_coupons
      (tenant_id, code, discount_kind, discount_percent)
    VALUES ('b1111111-1111-1111-1111-1111111111b1', 'PCT_100', 'percent', 100)$$,
  'discount_percent = 100 PRZYJĘTE (kupon „za darmo” jest legalnym narzędziem)'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- (2) discount_cents > 0
-- ═══════════════════════════════════════════════════════════════════════════

SELECT throws_ok(
  $$INSERT INTO public.b2b_coupons
      (tenant_id, code, discount_kind, discount_cents, currency)
    VALUES ('b1111111-1111-1111-1111-1111111111b1', 'CENTS_ZERO', 'fixed', 0, 'PLN')$$,
  '23514',
  NULL,
  'discount_cents = 0 ODRZUCONE'
);

SELECT throws_ok(
  $$INSERT INTO public.b2b_coupons
      (tenant_id, code, discount_kind, discount_cents, currency)
    VALUES ('b1111111-1111-1111-1111-1111111111b1', 'CENTS_NEG', 'fixed', -5000, 'PLN')$$,
  '23514',
  NULL,
  'discount_cents ujemne ODRZUCONE (ujemny rabat = doliczenie do faktury)'
);

SELECT lives_ok(
  $$INSERT INTO public.b2b_coupons
      (tenant_id, code, discount_kind, discount_cents, currency)
    VALUES ('b1111111-1111-1111-1111-1111111111b1', 'CENTS_1', 'fixed', 1, 'PLN')$$,
  'discount_cents = 1 PRZYJĘTE (jeden grosz to poprawny rabat)'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- (3) SPÓJNOŚĆ discount_kind <-> pole kwoty (b2b_coupons_discount_shape)
--
-- To najważniejszy z czterech CHECK-ów: bez niego kupon mógłby mieć rodzaj
-- „procentowy" i wypełnioną kwotę, a silnik checkoutu czyta pole zgodne
-- z rodzajem - czyli liczyłby rabat z pola PUSTEGO.
-- ═══════════════════════════════════════════════════════════════════════════

SELECT throws_ok(
  $$INSERT INTO public.b2b_coupons
      (tenant_id, code, discount_kind, discount_percent, discount_cents, currency)
    VALUES ('b1111111-1111-1111-1111-1111111111b1', 'BOTH', 'percent', 20, 5000, 'PLN')$$,
  '23514',
  NULL,
  'rodzaj `percent` z WYPEŁNIONYMI oboma polami kwoty ODRZUCONY'
);

SELECT throws_ok(
  $$INSERT INTO public.b2b_coupons
      (tenant_id, code, discount_kind)
    VALUES ('b1111111-1111-1111-1111-1111111111b1', 'NEITHER', 'percent')$$,
  '23514',
  NULL,
  'rodzaj `percent` BEZ procentu ODRZUCONY (kupon bez rabatu)'
);

SELECT throws_ok(
  $$INSERT INTO public.b2b_coupons
      (tenant_id, code, discount_kind, discount_cents, currency)
    VALUES ('b1111111-1111-1111-1111-1111111111b1', 'PCT_WITH_CENTS', 'percent', 5000, 'PLN')$$,
  '23514',
  NULL,
  'rodzaj `percent` z KWOTĄ zamiast procentu ODRZUCONY (sierota po przełączeniu rodzaju)'
);

SELECT throws_ok(
  $$INSERT INTO public.b2b_coupons
      (tenant_id, code, discount_kind, discount_percent)
    VALUES ('b1111111-1111-1111-1111-1111111111b1', 'FIXED_WITH_PCT', 'fixed', 20)$$,
  '23514',
  NULL,
  'rodzaj `fixed` z PROCENTEM zamiast kwoty ODRZUCONY'
);

SELECT throws_ok(
  $$INSERT INTO public.b2b_coupons
      (tenant_id, code, discount_kind)
    VALUES ('b1111111-1111-1111-1111-1111111111b1', 'BAD_KIND', 'wolumenowy')$$,
  '23514',
  NULL,
  'nieznany `discount_kind` ODRZUCONY (silnik nie ma dla niego gałęzi)'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- (4) max_redemptions > 0  (UWAGA: `> 0`, nie `>= 0`)
--
-- Zlecenie zakładało `>= 0`. Baza ma `> 0`, więc ZERO jest ODRZUCANE, a „bez
-- limitu" wyraża się przez NULL. To rozróżnienie ma znaczenie dla panelu:
-- pole puste musi jechać jako NULL, a nie jako 0.
-- ═══════════════════════════════════════════════════════════════════════════

SELECT throws_ok(
  $$INSERT INTO public.b2b_coupons
      (tenant_id, code, discount_kind, discount_percent, max_redemptions)
    VALUES ('b1111111-1111-1111-1111-1111111111b1', 'MAXR_ZERO', 'percent', 10, 0)$$,
  '23514',
  NULL,
  'max_redemptions = 0 ODRZUCONE - „bez limitu” wyraża NULL, nie zero'
);

SELECT throws_ok(
  $$INSERT INTO public.b2b_coupons
      (tenant_id, code, discount_kind, discount_percent, max_redemptions)
    VALUES ('b1111111-1111-1111-1111-1111111111b1', 'MAXR_NEG', 'percent', 10, -1)$$,
  '23514',
  NULL,
  'max_redemptions ujemne ODRZUCONE'
);

SELECT lives_ok(
  $$INSERT INTO public.b2b_coupons
      (tenant_id, code, discount_kind, discount_percent, max_redemptions)
    VALUES ('b1111111-1111-1111-1111-1111111111b1', 'MAXR_NULL', 'percent', 10, NULL)$$,
  'max_redemptions = NULL PRZYJĘTE - to jest kanoniczny zapis „bez limitu”'
);

-- ═══════════════════════════════════════════════════════════════════════════
-- (5) LUKA: kolumna `currency` bez CHECK-a i bez powiązania z rodzajem
--
-- Poniższe dwie asercje opisują stan FAKTYCZNY. Są dokumentacją, nie
-- akceptacją: domknięcie wymaga migracji, a ta jest poza zakresem zlecenia
-- (reguła „brakujący CHECK to pozycja w raporcie, nie migracja”).
-- ═══════════════════════════════════════════════════════════════════════════

SELECT lives_ok(
  $$INSERT INTO public.b2b_coupons
      (tenant_id, code, discount_kind, discount_cents, currency)
    VALUES ('b1111111-1111-1111-1111-1111111111b1', 'FIXED_NO_CCY', 'fixed', 5000, NULL)$$,
  'LUKA: kupon KWOTOWY bez waluty PRZECHODZI - spójność trzyma wyłącznie panel'
);

SELECT lives_ok(
  $$INSERT INTO public.b2b_coupons
      (tenant_id, code, discount_kind, discount_percent, currency)
    VALUES ('b1111111-1111-1111-1111-1111111111b1', 'PCT_WITH_CCY', 'percent', 10, 'XYZ')$$,
  'LUKA: kupon PROCENTOWY z walutą (i to nieistniejącą) PRZECHODZI'
);

-- Kanarek zakresu: wszystkie legalne wstawki powyżej naprawdę osiadły.
-- Bez tego cały plik mógłby „przechodzić" na tabeli, do której nic nie wchodzi.
SELECT is(
  (SELECT count(*)::int FROM public.b2b_coupons
    WHERE tenant_id = 'b1111111-1111-1111-1111-1111111111b1'),
  6,
  'kanarek: osiadło dokładnie SZEŚĆ legalnych kuponów (reszta odrzucona przez CHECK-i)'
);

SELECT * FROM finish();
ROLLBACK;
