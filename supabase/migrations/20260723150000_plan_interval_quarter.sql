-- ============================================================================
-- Kwartalny cykl rozliczeniowy: enum plan_interval dostaje wartość 'quarter'.
--
-- Osobny plik migracji: nowej wartości enum nie wolno UŻYĆ w tej samej
-- transakcji, w której powstała (ograniczenie PostgreSQL) - kolejne migracje
-- i seedy mogą się do niej odwoływać bez ryzyka.
--
-- Lustra TS w tym samym commicie: types.ts (Enums.plan_interval),
-- billing/types.ts (PlanInterval), entitlement.ts (periodEndFor +
-- stripeRecurringFor: Stripe rozlicza kwartał jako interval=month,
-- interval_count=3), etykiety cennika/profilu (pricing.perQuarter).
-- ============================================================================

ALTER TYPE public.plan_interval ADD VALUE IF NOT EXISTS 'quarter';
