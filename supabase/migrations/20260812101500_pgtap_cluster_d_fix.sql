-- =============================================================================
-- membership_grants.source: przywrocenie zrodla 'coupon'.
--
-- 20260725090300 dopuscilo source='coupon' (nadanie warstwy po POTWIERDZONEJ
-- płatności, apply_b2b_coupon_effects). Dwie pozniejsze migracje przebudowaly
-- ten CHECK od zera, dopisujac swoje zrodlo do listy sprzed kuponu:
--   * 20260805201517 -> ARRAY['manual','donation','import','expert'],
--   * 20260809102603 -> ARRAY['manual','donation','import','expert','org_domain'].
-- Skutek na produkcji: INSERT z apply_b2b_coupon_effects konczy sie bledem
-- 23514, wiec ksiegowanie oplaconego zamowienia z kuponem "nadaj warstwe"
-- wywala sie na ograniczeniu - kupon jest sprzedany, a warstwa nie powstaje.
-- Lista skladana jest tu z sumy wszystkich swiadomie wprowadzonych zrodel.
-- =============================================================================

ALTER TABLE public.membership_grants
  DROP CONSTRAINT IF EXISTS membership_grants_source_check;
ALTER TABLE public.membership_grants
  ADD CONSTRAINT membership_grants_source_check
  CHECK (source = ANY (ARRAY['manual', 'donation', 'import', 'coupon', 'expert', 'org_domain']));

COMMENT ON COLUMN public.membership_grants.source IS
  'Pochodzenie nadania warstwy: manual (admin), donation, import, coupon '
  '(apply_b2b_coupon_effects - wylacznie po potwierdzonej płatności), expert '
  '(odznaka eksperta), org_domain (weryfikacja domeny organizacji).';
