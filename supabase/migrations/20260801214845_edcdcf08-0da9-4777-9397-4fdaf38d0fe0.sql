-- Naprawa luk wykrytych przez bramkę "kontrakt bazy" (scripts/check-db-contract.ts):
-- obiekty istnieją w migracjach, ale nie ma ich w bazie produkcyjnej.
-- Definicje są kopią 1:1 z oryginalnych migracji (bez zmian semantyki).

-- 1) popular_post_ids - ranking "popularne" dla list wpisów w builderze.
CREATE OR REPLACE FUNCTION public.popular_post_ids(
  _days int DEFAULT 30,
  _limit int DEFAULT 200
)
RETURNS TABLE (post_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id
    FROM public.posts p
    JOIN public.post_views v ON v.post_id = p.id
   WHERE p.status = 'published'
     AND p.deleted_at IS NULL
     AND p.tenant_id = public.public_tenant_id()
     AND v.viewed_at > now() - make_interval(days => GREATEST(_days, 1))
   GROUP BY p.id
   ORDER BY count(v.id) DESC, p.published_at DESC NULLS LAST
   LIMIT GREATEST(LEAST(_limit, 500), 1);
$$;

REVOKE ALL ON FUNCTION public.popular_post_ids(int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.popular_post_ids(int, int)
  TO anon, authenticated, service_role;

-- 2) admin_get_author_profile - pełny wiersz profilu autora dla admina tenanta.
CREATE OR REPLACE FUNCTION public.admin_get_author_profile(_user_id uuid)
RETURNS SETOF public.author_profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ap.*
  FROM public.author_profiles ap
  WHERE ap.user_id = _user_id
    AND (public.has_role(auth.uid(), 'admin'::app_role)
         OR public.has_role(auth.uid(), 'super_admin'::app_role))
    AND ap.tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.admin_get_author_profile(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_author_profile(uuid) TO authenticated, service_role;

-- 3) recommendation_relationships - kanoniczny słownik relacji.
CREATE OR REPLACE FUNCTION public.recommendation_relationships()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ARRAY['colleague','manager','report','client','mentor','partner','other']::text[];
$$;

REVOKE ALL ON FUNCTION public.recommendation_relationships() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recommendation_relationships() TO anon, authenticated, service_role;

-- 4) is_experiment_running - warunek zapisu zdarzeń eksperymentu A/B.
CREATE OR REPLACE FUNCTION public.is_experiment_running(_experiment_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.builder_experiments
    WHERE id = _experiment_id AND status = 'running'
  )
$$;

REVOKE ALL ON FUNCTION public.is_experiment_running(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_experiment_running(uuid) TO anon, authenticated, service_role;

-- 5) apply_b2b_coupon_effects - efekty kuponu PO potwierdzonej płatności.
ALTER TABLE public.b2b_coupon_redemptions
  ADD COLUMN IF NOT EXISTS effects_applied_at timestamptz;

COMMENT ON COLUMN public.b2b_coupon_redemptions.effects_applied_at IS
  'Znacznik jednokrotnego zastosowania efektow kuponu (warstwa + CRM). Ustawiany atomowo przez apply_b2b_coupon_effects; ponowna dostawa webhooka jest no-opem.';

CREATE OR REPLACE FUNCTION public.apply_b2b_coupon_effects(_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_redemption   public.b2b_coupon_redemptions%ROWTYPE;
  v_coupon       public.b2b_coupons%ROWTYPE;
  v_order_status text;
  v_order_user   uuid;
  v_user         uuid;
  v_lead_id      uuid;
  v_lead_email   text;
  v_tier_exists  boolean := false;
  v_granted      boolean := false;
  v_crm          boolean := false;
BEGIN
  IF _order_id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'no_order');
  END IF;

  SELECT o.status, o.user_id INTO v_order_status, v_order_user
    FROM public.payment_orders o WHERE o.id = _order_id;
  IF v_order_status IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'order_not_found');
  END IF;
  IF v_order_status <> 'paid' THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'order_not_paid');
  END IF;

  UPDATE public.b2b_coupon_redemptions r
     SET effects_applied_at = now()
   WHERE r.order_id = _order_id
     AND r.effects_applied_at IS NULL
  RETURNING r.* INTO v_redemption;
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'applied', false,
      'reason', CASE
                  WHEN EXISTS (SELECT 1 FROM public.b2b_coupon_redemptions
                                WHERE order_id = _order_id)
                  THEN 'already_applied' ELSE 'no_redemption' END);
  END IF;

  SELECT * INTO v_coupon FROM public.b2b_coupons
   WHERE id = v_redemption.coupon_id AND tenant_id = v_redemption.tenant_id;
  IF v_coupon.id IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'coupon_not_found');
  END IF;

  v_user := COALESCE(v_redemption.user_id, v_order_user);
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'no_user');
  END IF;

  SELECT u.email INTO v_lead_email FROM auth.users u WHERE u.id = v_user;
  IF v_lead_email IS NOT NULL THEN
    SELECT l.id INTO v_lead_id FROM public.crm_leads l
     WHERE l.tenant_id = v_coupon.tenant_id
       AND l.email_norm = lower(btrim(v_lead_email))
     LIMIT 1;
    IF v_lead_id IS NOT NULL THEN
      INSERT INTO public.crm_lead_notes (tenant_id, lead_id, author_id, body, is_internal)
      VALUES (v_coupon.tenant_id, v_lead_id, v_user,
              'Zrealizowano kupon B2B (płatność potwierdzona): ' || v_coupon.code, true);
      UPDATE public.crm_leads
         SET score = score + COALESCE(v_coupon.lead_score_bonus, 15),
             last_activity_at = now(),
             score_updated_at = now()
       WHERE id = v_lead_id;
      v_crm := true;
    END IF;
  END IF;

  IF v_coupon.grants_tier_key IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.membership_tiers t
       WHERE t.tenant_id = v_coupon.tenant_id AND t.key = v_coupon.grants_tier_key
    ) INTO v_tier_exists;

    IF v_tier_exists THEN
      INSERT INTO public.membership_grants (
        tenant_id, user_id, tier_key, source, source_coupon_id, note,
        granted_by, starts_at, expires_at
      ) VALUES (
        v_coupon.tenant_id, v_user, v_coupon.grants_tier_key, 'coupon', v_coupon.id,
        'Kupon B2B: ' || v_coupon.code,
        NULL, now(),
        CASE WHEN v_coupon.grants_duration_days IS NOT NULL
             THEN now() + make_interval(days => v_coupon.grants_duration_days)
             ELSE NULL END
      );
      v_granted := true;
    ELSE
      RETURN jsonb_build_object(
        'applied', true, 'crm', v_crm, 'tier_granted', false,
        'reason', 'tier_key_not_found', 'tier_key', v_coupon.grants_tier_key);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'applied', true, 'crm', v_crm, 'tier_granted', v_granted,
    'tier_key', v_coupon.grants_tier_key, 'coupon_code', v_coupon.code);
END $$;

REVOKE ALL ON FUNCTION public.apply_b2b_coupon_effects(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_b2b_coupon_effects(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_b2b_coupon_effects(uuid) TO service_role;

COMMENT ON FUNCTION public.apply_b2b_coupon_effects(uuid) IS
  'Efekty kuponu B2B (warstwa czlonkowska + notatka/score CRM) dla ZAPLACONEGO zamowienia. Idempotentna przez b2b_coupon_redemptions.effects_applied_at. Tylko service_role.';