CREATE OR REPLACE FUNCTION public.pricing_catalog_business_rows()
RETURNS TABLE (
  key text, rank integer, name_pl text, name_en text,
  desc_pl text, desc_en text, benefits jsonb, features jsonb,
  is_default boolean, sort_order integer, audience_key text,
  badge_pl text, badge_en text, highlight boolean,
  per_seat boolean, price_note_pl text, price_note_en text, cta_mode text
)
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT * FROM (VALUES
    ('business', 28, 'Partner Biznesowy', 'Business Partner',
     'Samoobsługowa subskrypcja dla firm: pełen zakres Pro, briefing sektorowy i status partnera biznesowego - w cyklu 2 tygodni, miesiąca lub kwartału.',
     'A self-serve business subscription: the full Pro scope, a sector briefing and business partner status - billed every 2 weeks, monthly or quarterly.',
     '[{"pl":"Pełny zakres planu Pro dla konta firmowego - analizy, monitoring regulacyjny, briefingi","en":"The full Pro scope for the company account - analyses, regulatory monitoring, briefings"},
       {"pl":"Cykliczny briefing sektorowy dla firm","en":"A recurring sector briefing for business"},
       {"pl":"Status partnera biznesowego z wyróżnieniem w sekcji partnerów serwisu","en":"Business partner status with recognition in the site''s partners section"},
       {"pl":"Zaproszenia na wydarzenia i wybrane Decision Labs","en":"Invitations to events and selected Decision Labs"},
       {"pl":"Cykl rozliczeń do wyboru: 2 tygodnie, miesiąc lub kwartał - anulowanie w każdej chwili","en":"Choose your billing cycle: 2 weeks, monthly or quarterly - cancel anytime"}]'::jsonb,
     '{"events_members": true, "recordings": true, "member_library": true, "premium_content": true, "qa_priority": true, "pro_briefings": true, "working_groups": true, "regulatory_monitoring": true, "gift_links": true, "chat_enabled": true, "expert_request_quota": 3}'::jsonb,
     false, 65, 'business', 'Nowość', 'New', false, false, NULL, NULL, 'auto')
  ) AS v(key, rank, name_pl, name_en, desc_pl, desc_en, benefits, features,
         is_default, sort_order, audience_key, badge_pl, badge_en, highlight,
         per_seat, price_note_pl, price_note_en, cta_mode);
$$;

REVOKE EXECUTE ON FUNCTION public.pricing_catalog_business_rows() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pricing_catalog_business_rows() TO service_role;

CREATE OR REPLACE FUNCTION public.seed_membership_tiers(p_tenant uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.membership_tiers
    (tenant_id, key, rank, name_pl, name_en, description_pl, description_en,
     benefits, features, is_default, sort_order, audience_key,
     badge_pl, badge_en, highlight, per_seat, price_note_pl, price_note_en, cta_mode)
  SELECT p_tenant, v.key, v.rank, v.name_pl, v.name_en, v.desc_pl, v.desc_en,
         v.benefits, v.features, v.is_default, v.sort_order, v.audience_key,
         v.badge_pl, v.badge_en, v.highlight, v.per_seat,
         v.price_note_pl, v.price_note_en, v.cta_mode
    FROM (
      SELECT * FROM public.pricing_catalog_v3_rows()
      UNION ALL
      SELECT * FROM public.pricing_catalog_business_rows()
    ) v
   WHERE NOT EXISTS (
     SELECT 1 FROM public.membership_tiers mt
      WHERE mt.tenant_id = p_tenant AND mt.key = v.key
   );
$$;

REVOKE EXECUTE ON FUNCTION public.seed_membership_tiers(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_membership_tiers(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.seed_pricing_plans_v3(p_tenant uuid)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.access_plans
    (tenant_id, name_pl, name_en, price_cents, currency, interval, active,
     sort_order, tier_key)
  SELECT p_tenant, v.name_pl, v.name_en, v.price_cents, 'PLN',
         v.plan_interval::public.plan_interval, true, v.sort_order, v.tier_key
    FROM (VALUES
      ('Plus - miesięcznie', 'Plus - monthly', 5900, 'month', 10, 'member'),
      ('Plus - rocznie', 'Plus - annual', 59000, 'year', 20, 'member'),
      ('Pro - miesięcznie', 'Pro - monthly', 12900, 'month', 30, 'pro'),
      ('Pro - rocznie', 'Pro - annual', 129000, 'year', 40, 'pro'),
      ('Student i Doktorant - miesięcznie', 'Student & Doctoral - monthly', 1900, 'month', 50, 'student'),
      ('Kadra Akademicka - miesięcznie', 'Academic Faculty - monthly', 2900, 'month', 60, 'educator'),
      ('Zespół - za miejsce, miesięcznie', 'Team - per seat, monthly', 9900, 'month', 70, 'team'),
      ('Partner Biznesowy - co 2 tygodnie', 'Business Partner - every 2 weeks', 59000, 'two_weeks', 80, 'business'),
      ('Partner Biznesowy - miesięcznie', 'Business Partner - monthly', 99000, 'month', 90, 'business'),
      ('Partner Biznesowy - kwartalnie', 'Business Partner - quarterly', 249000, 'quarter', 100, 'business')
    ) AS v(name_pl, name_en, price_cents, plan_interval, sort_order, tier_key)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.access_plans ap
      WHERE ap.tenant_id = p_tenant
        AND ap.tier_key = v.tier_key
        AND ap.interval = v.plan_interval::public.plan_interval
   );
$$;

REVOKE EXECUTE ON FUNCTION public.seed_pricing_plans_v3(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_pricing_plans_v3(uuid) TO service_role;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id FROM public.tenants LOOP
    PERFORM public.seed_membership_tiers(r.id);
    PERFORM public.seed_pricing_plans_v3(r.id);
  END LOOP;
END;
$$;