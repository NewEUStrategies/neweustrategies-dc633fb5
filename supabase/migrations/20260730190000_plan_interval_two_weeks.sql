-- ============================================================================
-- Dwutygodniowy cykl rozliczeniowy: enum plan_interval dostaje 'two_weeks'.
--
-- Kontekst produktowy: oferta reklamowa serwisu zostaje wycofana na rzecz
-- subskrypcji biznesowej (Partner Biznesowy) rozliczanej w cyklach
-- 2 tygodnie / miesiąc / kwartał - zgodnie z Acceptable Use Policy operatora
-- płatności (Paddle wspiera subskrypcje, nie sprzedaż reklam/sponsoringu).
--
-- Osobny plik migracji: nowej wartości enum nie wolno UŻYĆ w tej samej
-- transakcji, w której powstała (ograniczenie PostgreSQL) - katalog planów
-- korzysta z niej w kolejnej migracji.
--
-- Lustra TS w tym samym commicie: types.ts (Enums.plan_interval),
-- billing/types.ts (PlanInterval), entitlement.ts (periodEndFor: +14 dni),
-- paddleCatalog.ts (PlanBillingInterval), paddleCatalogSync.server.ts
-- (billing_cycle operatora: two_weeks -> week x2, quarter -> month x3),
-- etykiety cennika/profilu (pricing.perTwoWeeks).
-- ============================================================================

ALTER TYPE public.plan_interval ADD VALUE IF NOT EXISTS 'two_weeks';
