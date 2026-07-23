-- 1) Seed flag na progach Pro-scope (istniejące tenanty).
UPDATE public.membership_tiers
   SET features = features
       || jsonb_build_object('expert_request', true)
       || jsonb_build_object('gift_links', true)
 WHERE key IN ('pro', 'vip', 'corporate', 'partner', 'partner_general', 'presidents_circle', 'ngo', 'team')
   AND NOT (features ? 'expert_request' AND features ? 'gift_links');

-- 2) Twarda bramka linków podarunkowych: od Pro w górę.
CREATE OR REPLACE FUNCTION public.can_gift_articles()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.public_tenant_id();
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RETURN false;
  END IF;
  RETURN public.user_has_tier_feature(v_uid, 'gift_links');
END $$;

REVOKE ALL ON FUNCTION public.can_gift_articles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_gift_articles() TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.can_gift_articles() IS
  'Czy użytkownik może tworzyć linki podarunkowe. Bramka: flaga tier gift_links (od Pro w górę), rozstrzygana per tenant przez user_has_tier_feature.';

-- 3) Nowe tenanty dostają obie flagi w seed_pricing_defaults.
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

  UPDATE public.membership_tiers
     SET features = features || jsonb_build_object('regulatory_monitoring', true)
   WHERE tenant_id = p_tenant
     AND key IN ('pro', 'vip', 'corporate', 'partner', 'partner_general', 'presidents_circle')
     AND NOT (features ? 'regulatory_monitoring');

  UPDATE public.membership_tiers
     SET features = features
         || jsonb_build_object('expert_request', true)
         || jsonb_build_object('gift_links', true)
   WHERE tenant_id = p_tenant
     AND key IN ('pro', 'vip', 'corporate', 'partner', 'partner_general', 'presidents_circle', 'ngo', 'team')
     AND NOT (features ? 'expert_request' AND features ? 'gift_links');

  PERFORM public.seed_pricing_faq(p_tenant);
  PERFORM public.seed_pricing_plans_v3(p_tenant);
  PERFORM public.seed_retention_defaults(p_tenant);
  PERFORM public.apply_pricing_catalog_v4(p_tenant);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_pricing_defaults(uuid) TO service_role;