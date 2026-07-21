
ALTER TABLE public.b2b_coupons
  ADD COLUMN IF NOT EXISTS campaign_id UUID,
  ADD COLUMN IF NOT EXISTS assigned_company_id UUID REFERENCES public.crm_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_lead_id UUID REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS grants_tier_key TEXT,
  ADD COLUMN IF NOT EXISTS grants_duration_days INTEGER,
  ADD COLUMN IF NOT EXISTS newsletter_segment TEXT,
  ADD COLUMN IF NOT EXISTS prefix TEXT,
  ADD COLUMN IF NOT EXISTS lead_score_bonus INTEGER NOT NULL DEFAULT 15;

CREATE INDEX IF NOT EXISTS b2b_coupons_campaign_idx ON public.b2b_coupons(campaign_id);
CREATE INDEX IF NOT EXISTS b2b_coupons_assigned_company_idx ON public.b2b_coupons(assigned_company_id);
CREATE INDEX IF NOT EXISTS b2b_coupons_assigned_lead_idx ON public.b2b_coupons(assigned_lead_id);

CREATE TABLE IF NOT EXISTS public.b2b_coupon_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL DEFAULT public_tenant_id(),
  name TEXT NOT NULL,
  description TEXT,
  prefix TEXT NOT NULL DEFAULT '',
  code_length INTEGER NOT NULL DEFAULT 8 CHECK (code_length BETWEEN 4 AND 24),
  code_count INTEGER NOT NULL CHECK (code_count > 0 AND code_count <= 10000),
  generated_count INTEGER NOT NULL DEFAULT 0,
  discount_kind TEXT NOT NULL CHECK (discount_kind IN ('percent','fixed')),
  discount_percent INTEGER CHECK (discount_percent IS NULL OR (discount_percent BETWEEN 1 AND 100)),
  discount_cents INTEGER CHECK (discount_cents IS NULL OR discount_cents > 0),
  currency TEXT,
  max_redemptions_per_code INTEGER DEFAULT 1 CHECK (max_redemptions_per_code IS NULL OR max_redemptions_per_code > 0),
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  plan_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  grants_tier_key TEXT,
  grants_duration_days INTEGER CHECK (grants_duration_days IS NULL OR grants_duration_days > 0),
  newsletter_segment TEXT,
  newsletter_campaign_id UUID REFERENCES public.newsletter_campaigns(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','generated','sent','archived')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.b2b_coupon_campaigns TO authenticated;
GRANT ALL ON public.b2b_coupon_campaigns TO service_role;

ALTER TABLE public.b2b_coupon_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "b2b_coupon_campaigns_staff_all" ON public.b2b_coupon_campaigns;
CREATE POLICY "b2b_coupon_campaigns_staff_all" ON public.b2b_coupon_campaigns
  FOR ALL TO authenticated
  USING (tenant_id = public_tenant_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'editor'::app_role)))
  WITH CHECK (tenant_id = public_tenant_id() AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'editor'::app_role)));

CREATE INDEX IF NOT EXISTS b2b_coupon_campaigns_tenant_idx ON public.b2b_coupon_campaigns(tenant_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_b2b_coupon_campaigns_updated_at ON public.b2b_coupon_campaigns;
CREATE TRIGGER trg_b2b_coupon_campaigns_updated_at
  BEFORE UPDATE ON public.b2b_coupon_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.b2b_coupons
  DROP CONSTRAINT IF EXISTS b2b_coupons_campaign_id_fkey;
ALTER TABLE public.b2b_coupons
  ADD CONSTRAINT b2b_coupons_campaign_id_fkey
  FOREIGN KEY (campaign_id) REFERENCES public.b2b_coupon_campaigns(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.bulk_generate_coupons_for_campaign(_campaign_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _c public.b2b_coupon_campaigns%ROWTYPE;
  _uid UUID := auth.uid();
  _i INTEGER := 0;
  _created INTEGER := 0;
  _code TEXT;
  _alphabet TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  _tries INTEGER;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT * INTO _c FROM public.b2b_coupon_campaigns WHERE id = _campaign_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'campaign_not_found'; END IF;
  IF _c.tenant_id <> public_tenant_id() THEN RAISE EXCEPTION 'wrong_tenant'; END IF;
  IF NOT (has_role(_uid,'admin'::app_role) OR has_role(_uid,'editor'::app_role)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF _c.status <> 'draft' THEN RAISE EXCEPTION 'campaign_already_generated'; END IF;

  WHILE _i < _c.code_count LOOP
    _tries := 0;
    LOOP
      _code := COALESCE(NULLIF(_c.prefix,''),'') ||
        (SELECT string_agg(substr(_alphabet, 1 + floor(random()*length(_alphabet))::int, 1),'')
         FROM generate_series(1, _c.code_length));
      BEGIN
        INSERT INTO public.b2b_coupons(
          tenant_id, code, name, discount_kind, discount_percent, discount_cents, currency,
          active, max_redemptions, valid_from, valid_until, plan_ids,
          campaign_id, grants_tier_key, grants_duration_days, newsletter_segment,
          created_by, metadata
        ) VALUES (
          _c.tenant_id, _code, _c.name, _c.discount_kind, _c.discount_percent, _c.discount_cents, _c.currency,
          true, _c.max_redemptions_per_code, _c.valid_from, _c.valid_until, _c.plan_ids,
          _c.id, _c.grants_tier_key, _c.grants_duration_days, _c.newsletter_segment,
          _uid, jsonb_build_object('campaign', _c.name)
        );
        _created := _created + 1;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        _tries := _tries + 1;
        IF _tries > 5 THEN RAISE EXCEPTION 'code_collision_limit'; END IF;
      END;
    END LOOP;
    _i := _i + 1;
  END LOOP;

  UPDATE public.b2b_coupon_campaigns
     SET status = 'generated', generated_count = _created, updated_at = now()
   WHERE id = _campaign_id;

  RETURN _created;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_generate_coupons_for_campaign(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.redeem_b2b_coupon_with_effects(
  _coupon_id UUID, _order_id UUID, _applied_cents INTEGER,
  _original_cents INTEGER, _currency TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid UUID := auth.uid();
  _coupon public.b2b_coupons%ROWTYPE;
  _lead_id UUID;
  _lead_email TEXT;
  _ok BOOLEAN;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;

  SELECT public.redeem_b2b_coupon(_coupon_id, _order_id, _applied_cents, _original_cents, _currency)
    INTO _ok;
  IF NOT _ok THEN RETURN false; END IF;

  SELECT * INTO _coupon FROM public.b2b_coupons WHERE id = _coupon_id;

  SELECT email INTO _lead_email FROM auth.users WHERE id = _uid;
  IF _lead_email IS NOT NULL THEN
    SELECT id INTO _lead_id FROM public.crm_leads
      WHERE tenant_id = _coupon.tenant_id AND email_norm = lower(btrim(_lead_email))
      LIMIT 1;
    IF _lead_id IS NOT NULL THEN
      INSERT INTO public.crm_lead_notes(tenant_id, lead_id, author_id, body, is_internal)
        VALUES (_coupon.tenant_id, _lead_id, _uid,
          'Zrealizowano kupon B2B: ' || _coupon.code, true);
      UPDATE public.crm_leads
         SET score = score + COALESCE(_coupon.lead_score_bonus, 15),
             last_activity_at = now(),
             score_updated_at = now()
       WHERE id = _lead_id;
    END IF;
  END IF;

  IF _coupon.grants_tier_key IS NOT NULL THEN
    INSERT INTO public.membership_grants(
      tenant_id, user_id, tier_key, source, note, granted_by,
      starts_at, expires_at
    ) VALUES (
      _coupon.tenant_id, _uid, _coupon.grants_tier_key, 'manual',
      'Kupon B2B: ' || _coupon.code, _uid,
      now(),
      CASE WHEN _coupon.grants_duration_days IS NOT NULL
           THEN now() + (_coupon.grants_duration_days || ' days')::interval
           ELSE NULL END
    );
  END IF;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_b2b_coupon_with_effects(UUID, UUID, INTEGER, INTEGER, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.b2b_coupons_analytics(_from TIMESTAMPTZ, _to TIMESTAMPTZ)
RETURNS TABLE(
  coupon_id UUID, code TEXT, name TEXT,
  redemptions BIGINT, revenue_cents BIGINT, discount_cents_total BIGINT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.code, c.name,
    COUNT(r.id)::BIGINT,
    COALESCE(SUM(r.applied_cents),0)::BIGINT,
    COALESCE(SUM(r.original_cents - r.applied_cents),0)::BIGINT
  FROM public.b2b_coupons c
  LEFT JOIN public.b2b_coupon_redemptions r
    ON r.coupon_id = c.id
   AND r.tenant_id = c.tenant_id
   AND r.created_at BETWEEN _from AND _to
  WHERE c.tenant_id = public_tenant_id()
    AND (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'editor'::app_role))
  GROUP BY c.id, c.code, c.name
  ORDER BY COUNT(r.id) DESC
  LIMIT 100;
$$;

GRANT EXECUTE ON FUNCTION public.b2b_coupons_analytics(TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
