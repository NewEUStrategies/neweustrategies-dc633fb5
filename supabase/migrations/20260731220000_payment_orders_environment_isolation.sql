-- ============================================================================
-- P0 - IZOLACJA SANDBOX/LIVE dla płatności JEDNORAZOWYCH (payment_orders).
--
-- PRZYCZYNA ŹRÓDŁOWA (audyt "Monetyzacja - brak izolacji środowiska w ścieżce
-- jednorazowej"): ścieżka subskrypcyjna dopasowuje zdarzenia webhooka po
-- `subscriptions.environment = env` (kolumna z 20260729072626), więc sandboxowy
-- webhook NIGDY nie dotknie realnej subskrypcji. Ścieżka jednorazowa NIE miała
-- takiego bezpiecznika: `payment_orders` nie miało kolumny `environment`, a
-- `fulfilOrder()` dobierało zamówienie po samym `order_id` z custom_data i
-- nadawało uprawnienie bez sprawdzenia środowiska. Skutek: jeśli produkcja ma
-- skonfigurowany sandboxowy webhook (np. do testów) celujący w tę samą bazę,
-- zakup kartą testową w sandboxie realizował REALNE zamówienie i odblokowywał
-- płatną treść.
--
-- TA MIGRACJA domyka lukę po stronie danych; kod (resolveEnvironment
-- server-authoritative + guard środowiska w fulfilOrder) domyka ją po stronie
-- aplikacji. Obie warstwy razem = ta sama obrona co subskrypcje.
--
--   1) Kolumna `environment` ('sandbox'|'live') z CHECK, NOT NULL.
--   2) Backfill istniejących wierszy do 'live': zamówienia sprzed tej migracji
--      powstały na produkcji (środowisko live jest jedynym autorytatywnym dla
--      realnego dostępu). DEFAULT 'live' jest też fail-closed dla ewentualnej
--      ścieżki insertu, która zapomni ostemplować środowisko: taki wiersz da
--      się zrealizować WYŁĄCZNIE webhookiem 'live', nigdy sandboxowym.
--   3) Indeks pod dopasowanie po środowisku (spójnie z subscriptions).
-- ============================================================================

ALTER TABLE public.payment_orders
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'live'
  CHECK (environment IN ('sandbox', 'live'));

CREATE INDEX IF NOT EXISTS payment_orders_environment_idx
  ON public.payment_orders (environment);
