-- ============================================================================
-- FIX (P0): kolizja timestampów migracji 20260723180000
--   Dwie migracje o identycznym prefiksie 20260723180000 redefiniowały
--   public.seed_pricing_defaults:
--     * ..._chat_plus_tier_gating_and_benefit.sql  (dodaje seed_chat_tier_flags
--       + apply_pricing_catalog_v5)
--     * ..._expert_request_quota.sql                (model kwotowy expert_request,
--       ale BEZ seed_chat_tier_flags i BEZ apply_pricing_catalog_v5)
--   Sortowanie leksykalne uruchamia je w kolejności chat_plus -> expert_request,
--   więc wygrywa wersja bez flag czatu i bez katalogu v5. Skutek: KAŻDY nowo
--   zaseedowany tenant miał czat wyłączony na wszystkich progach i brak copy v5
--   na /pricing.
--
-- Naprawa forward-only (nie zmieniamy zaaplikowanych plików - to zerwałoby sumy
-- kontrolne migracji): redefiniujemy seed_pricing_defaults ze scalonym,
-- kanonicznym ciałem (model kwotowy expert_request z quota + flagi czatu + v5)
-- i idempotentnie backfillujemy istniejące tenanty (na wypadek tenantów
-- utworzonych w oknie regresji). Wszystkie kroki są idempotentne.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_pricing_defaults(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.seed_pricing_audiences(p_tenant);
  PERFORM public.seed_membership_tiers(p_tenant);

  UPDATE public.membership_tiers
     SET audience_key = CASE
       WHEN key IN ('reader', 'supporter', 'member', 'pro', 'vip') THEN 'individual'
       WHEN key IN ('corporate', 'partner', 'partner_general', 'presidents_circle')
         THEN 'business'
       WHEN key IN ('student', 'educator', 'ngo') THEN 'academic'
       WHEN key = 'team' THEN 'team'
       ELSE audience_key
     END
   WHERE tenant_id = p_tenant AND audience_key IS NULL;

  -- Monitoring regulacyjny (tracker) - benefit Pro i wyzej.
  UPDATE public.membership_tiers
     SET features = features || jsonb_build_object('regulatory_monitoring', true)
   WHERE tenant_id = p_tenant
     AND key IN ('pro', 'vip', 'corporate', 'partner', 'partner_general', 'presidents_circle')
     AND NOT (features ? 'regulatory_monitoring');

  -- Linki podarunkowe - od Pro w gore (flaga boolowska, egzekwowana).
  UPDATE public.membership_tiers
     SET features = features || jsonb_build_object('gift_links', true)
   WHERE tenant_id = p_tenant
     AND key IN ('pro', 'vip', 'corporate', 'partner', 'partner_general', 'presidents_circle', 'ngo', 'team')
     AND NOT (features ? 'gift_links');

  -- „Zapytanie do eksperta": pula miesieczna per plan (Plus=1, Pro/NGO=3),
  -- progi bezposrednie (VIP i wyzej + zespol) na chat_direct_gated.
  UPDATE public.membership_tiers
     SET features = (features - 'expert_request') || jsonb_build_object('expert_request_quota', 1)
   WHERE tenant_id = p_tenant AND key = 'member'
     AND NOT (features ? 'expert_request_quota');

  UPDATE public.membership_tiers
     SET features = (features - 'expert_request') || jsonb_build_object('expert_request_quota', 3)
   WHERE tenant_id = p_tenant AND key IN ('pro', 'ngo')
     AND NOT (features ? 'expert_request_quota');

  UPDATE public.membership_tiers
     SET features = (features - 'expert_request') || jsonb_build_object('chat_direct_gated', true)
   WHERE tenant_id = p_tenant
     AND key IN ('vip', 'team', 'corporate', 'partner', 'partner_general', 'presidents_circle')
     AND NOT (features ? 'chat_direct_gated');

  -- Czat: swiadczenie od progu Plus (i wyzej); reader bez czatu. (przywrocone)
  PERFORM public.seed_chat_tier_flags(p_tenant);

  PERFORM public.seed_pricing_faq(p_tenant);
  PERFORM public.seed_pricing_plans_v3(p_tenant);
  PERFORM public.seed_retention_defaults(p_tenant);
  -- Benefity progow indywidualnych wg macierzy NES (v4) + benefit czatu (v5). (v5 przywrocone)
  PERFORM public.apply_pricing_catalog_v4(p_tenant);
  PERFORM public.apply_pricing_catalog_v5(p_tenant);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) TO service_role;

-- Backfill idempotentny: dla tenantow utworzonych w oknie regresji (lub gdyby
-- ktorykolwiek nie mial flag czatu / katalogu v5) domykamy stan. Guardy w
-- seed_chat_tier_flags i apply_pricing_catalog_v5 czynia to bezpiecznym do
-- wielokrotnego uruchomienia.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_chat_tier_flags(r.id);
    PERFORM public.apply_pricing_catalog_v5(r.id);
  END LOOP;
END;
$$;
