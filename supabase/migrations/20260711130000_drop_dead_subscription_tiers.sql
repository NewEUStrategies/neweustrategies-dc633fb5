-- Usunięcie martwej tabeli `subscription_tiers`.
--
-- Tabela została utworzona i zaseedowana w 20260628212746, ale żaden kod
-- aplikacji (src/**) ani żadna inna migracja nigdy jej nie odczytuje - płatności
-- i dostęp opierają się o `access_plans` + `content_access` + `user_subscriptions`.
-- To martwy schemat; usuwamy go wraz z zależnymi politykami/triggerami (CASCADE).
DROP TABLE IF EXISTS public.subscription_tiers CASCADE;
