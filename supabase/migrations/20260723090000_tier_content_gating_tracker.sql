-- ============================================================================
-- WPIĘCIE EGZEKWOWANIA WARSTW: drabinka rangowa dla treści + monitoring
-- regulacyjny (tracker) jako realny benefit Pro.
--
-- PROBLEM (diagnoza): dostęp do treści był BINARNY - flaga features.premium_content
-- (którą mają wszystkie płatne warstwy) globalnie otwierała treść 'paid',
-- omijając wybór planu. Skutkiem Plus i Pro były nierozróżnialne dla artykułów,
-- a flagowy benefit Pro "monitoring regulacyjny z alertami" nie był nigdzie
-- egzekwowany (/tracker w pełni otwarty).
--
-- ROZWIĄZANIE:
--   1) content_access.min_tier_rank - opcjonalny próg RANGI warstwy per treść
--      (spójny z bramką biblioteki i wydarzeń, które już działają na randze).
--      Domyślnie 0 = zachowanie legacy (premium_content binarny) BEZ ZMIAN.
--      Gdy > 0, dostęp wg rangi (current_tier_rank liczy subskrypcję + nadanie
--      + miejsce w organizacji), więc Plus (10) vs Pro (20) realnie się różnią,
--      a site licence / komplementy nadal działają.
--   2) Flaga features.regulatory_monitoring dla Pro i wyżej + bramka w RLS
--      obserwowania pozycji trackera (eu_policy_follows): PODGLĄD trackera
--      zostaje publiczny (lejek), ale obserwowanie/alerty wymagają warstwy Pro.
--
-- Idempotentne. Sygnatura has_content_access bez zmian (get_entity_content /
-- metered paywall / gift-links wołają ją tak samo).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Próg rangi warstwy per treść.
-- ----------------------------------------------------------------------------
ALTER TABLE public.content_access
  ADD COLUMN IF NOT EXISTS min_tier_rank integer NOT NULL DEFAULT 0;
DO $$
BEGIN
  ALTER TABLE public.content_access
    ADD CONSTRAINT content_access_min_tier_rank_check CHECK (min_tier_rank >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 2) Rdzeń bramki treści - rank-aware, wstecznie zgodny.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_content_access(
  _entity_type access_entity_type,
  _entity_id uuid
) RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode access_mode;
  v_plans uuid[];
  v_tenant uuid;
  v_min_rank integer;
  v_uid uuid := auth.uid();
BEGIN
  SELECT mode, plan_ids, tenant_id, min_tier_rank
    INTO v_mode, v_plans, v_tenant, v_min_rank
    FROM public.content_access
   WHERE entity_type = _entity_type AND entity_id = _entity_id;

  IF NOT FOUND OR v_mode = 'public' THEN
    RETURN true;
  END IF;

  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  v_min_rank := COALESCE(v_min_rank, 0);

  -- Tryb 'members': konto zalogowane w tenancie; przy ustawionym progu
  -- dodatkowo wymagana ranga (domyślnie 0 = legacy "każdy zalogowany",
  -- co domyka wcześniejszy przeciek treści members do konta bezpłatnego).
  IF v_mode = 'members' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = v_uid AND p.tenant_id = v_tenant
    ) AND (v_min_rank = 0 OR public.current_tier_rank() >= v_min_rank);
  END IF;

  -- Tryb 'paid'. Zakup jednorazowy zawsze otwiera daną treść.
  IF EXISTS (
    SELECT 1 FROM public.user_purchases
     WHERE user_id = v_uid
       AND entity_type = _entity_type
       AND entity_id = _entity_id
       AND status = 'active'
  ) THEN
    RETURN true;
  END IF;

  -- Konkretny plan wskazany na treści (targetowanie planem) - niezależnie od rangi.
  IF array_length(v_plans, 1) IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_subscriptions
     WHERE user_id = v_uid
       AND plan_id = ANY (v_plans)
       AND status = 'active'
       AND (current_period_end IS NULL OR current_period_end > now())
  ) THEN
    RETURN true;
  END IF;

  -- Drabinka warstw: gdy ustawiono próg, dostęp wg RANGI (Plus vs Pro realnie
  -- różne). Ranga z subskrypcji + nadania + miejsca w organizacji, więc site
  -- licence i komplementy działają; premium_content nie jest tu globalnym
  -- obejściem wyższego progu.
  IF v_min_rank > 0 THEN
    RETURN public.current_tier_rank() >= v_min_rank;
  END IF;

  -- Legacy (min_tier_rank = 0): binarny site-licence przez premium_content -
  -- zachowanie sprzed tej migracji dla istniejącej treści bez zmian.
  IF public.user_has_tier_feature(v_uid, 'premium_content') THEN
    RETURN true;
  END IF;

  RETURN false;
END $$;

-- ----------------------------------------------------------------------------
-- 3) Monitoring regulacyjny jako benefit Pro+ (flaga maszynowa).
--    Dokłada flagę tam, gdzie jej nie ma - nie nadpisuje ręcznych zmian admina.
-- ----------------------------------------------------------------------------
UPDATE public.membership_tiers
   SET features = features || jsonb_build_object('regulatory_monitoring', true)
 WHERE key IN ('pro', 'vip', 'corporate', 'partner', 'partner_general', 'presidents_circle')
   AND NOT (features ? 'regulatory_monitoring');

-- Nowe tenanty: seed_pricing_defaults dokłada tę samą flagę po zaseedowaniu
-- warstw (wersja rozszerzona o krok regulatory_monitoring).
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

  -- Monitoring regulacyjny (tracker) - benefit Pro i wyżej.
  UPDATE public.membership_tiers
     SET features = features || jsonb_build_object('regulatory_monitoring', true)
   WHERE tenant_id = p_tenant
     AND key IN ('pro', 'vip', 'corporate', 'partner', 'partner_general', 'presidents_circle')
     AND NOT (features ? 'regulatory_monitoring');

  PERFORM public.seed_pricing_faq(p_tenant);
  PERFORM public.seed_pricing_plans_v3(p_tenant);
  PERFORM public.seed_retention_defaults(p_tenant);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 4) Bramka obserwowania trackera: podgląd publiczny, obserwowanie/alerty dla
--    Pro. Zmieniamy WYŁĄCZNIE WITH CHECK (INSERT) - SELECT/DELETE po USING
--    zostają, więc istniejące obserwacje są widoczne i można je usunąć nawet
--    po zmianie planu. Egzekwowanie serwerowe (RLS), niezależne od klienta.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS "policy follows owner all" ON public.eu_policy_follows;
CREATE POLICY "policy follows owner all" ON public.eu_policy_follows
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.has_tier_feature('regulatory_monitoring')
    AND EXISTS (
      SELECT 1 FROM public.eu_policy_items i
       WHERE i.id = eu_policy_follows.item_id
         AND i.status = 'published'
         AND i.tenant_id = eu_policy_follows.tenant_id
    )
  );

-- Zastosuj domyślne (w tym regulatory_monitoring) do istniejących tenantów.
DO $$
DECLARE v_t uuid;
BEGIN
  FOR v_t IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_pricing_defaults(v_t);
  END LOOP;
END $$;
