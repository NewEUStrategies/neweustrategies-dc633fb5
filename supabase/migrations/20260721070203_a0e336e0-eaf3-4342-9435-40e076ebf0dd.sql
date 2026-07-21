CREATE TABLE public.b2b_coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id(),
  code text NOT NULL,
  name text,
  description text,
  discount_kind text NOT NULL CHECK (discount_kind IN ('percent','fixed')),
  discount_percent integer CHECK (discount_percent IS NULL OR (discount_percent BETWEEN 1 AND 100)),
  discount_cents integer CHECK (discount_cents IS NULL OR discount_cents > 0),
  currency text,
  active boolean NOT NULL DEFAULT true,
  max_redemptions integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  redemptions_count integer NOT NULL DEFAULT 0,
  valid_from timestamptz,
  valid_until timestamptz,
  plan_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  organization_id uuid REFERENCES public.member_organizations(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT b2b_coupons_code_unique UNIQUE (tenant_id, code),
  CONSTRAINT b2b_coupons_discount_shape CHECK (
    (discount_kind = 'percent' AND discount_percent IS NOT NULL AND discount_cents IS NULL)
    OR (discount_kind = 'fixed' AND discount_cents IS NOT NULL AND discount_percent IS NULL)
  )
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.b2b_coupons TO authenticated;
GRANT ALL ON public.b2b_coupons TO service_role;
ALTER TABLE public.b2b_coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b2b_coupons_staff_all" ON public.b2b_coupons FOR ALL TO authenticated
  USING (tenant_id = public.public_tenant_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor')))
  WITH CHECK (tenant_id = public.public_tenant_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor')));
CREATE TRIGGER b2b_coupons_touch_updated_at BEFORE UPDATE ON public.b2b_coupons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX b2b_coupons_tenant_active_idx ON public.b2b_coupons (tenant_id, active);
CREATE INDEX b2b_coupons_org_idx ON public.b2b_coupons (organization_id);

CREATE TABLE public.b2b_coupon_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id(),
  coupon_id uuid NOT NULL REFERENCES public.b2b_coupons(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.payment_orders(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  applied_cents integer NOT NULL CHECK (applied_cents >= 0),
  original_cents integer NOT NULL CHECK (original_cents >= 0),
  currency text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.b2b_coupon_redemptions TO authenticated;
GRANT ALL ON public.b2b_coupon_redemptions TO service_role;
ALTER TABLE public.b2b_coupon_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "b2b_coupon_redemptions_staff_select" ON public.b2b_coupon_redemptions FOR SELECT TO authenticated
  USING (tenant_id = public.public_tenant_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor')));
CREATE POLICY "b2b_coupon_redemptions_own_select" ON public.b2b_coupon_redemptions FOR SELECT TO authenticated
  USING (tenant_id = public.public_tenant_id() AND user_id = auth.uid());
CREATE INDEX b2b_coupon_redemptions_coupon_idx ON public.b2b_coupon_redemptions (coupon_id, created_at DESC);
CREATE INDEX b2b_coupon_redemptions_tenant_idx ON public.b2b_coupon_redemptions (tenant_id, created_at DESC);

CREATE TABLE public.metering_event_log (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL DEFAULT public.public_tenant_id(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid,
  visitor_id uuid,
  entity_type text,
  entity_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('consumed','denied','granted','exempt','requires_registration')),
  reason text,
  used_before integer,
  monthly_limit integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.metering_event_log TO authenticated;
GRANT ALL ON public.metering_event_log TO service_role;
ALTER TABLE public.metering_event_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "metering_event_log_staff_select" ON public.metering_event_log FOR SELECT TO authenticated
  USING (tenant_id = public.public_tenant_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor')));
CREATE INDEX metering_event_log_tenant_time_idx ON public.metering_event_log (tenant_id, occurred_at DESC);
CREATE INDEX metering_event_log_outcome_idx ON public.metering_event_log (tenant_id, outcome, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.log_metering_consumption()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
BEGIN
  INSERT INTO public.metering_event_log
    (tenant_id, user_id, visitor_id, entity_type, entity_id, outcome, reason)
  VALUES
    (NEW.tenant_id, NEW.user_id, NEW.visitor_id, NEW.entity_type::text, NEW.entity_id, 'consumed', NULL);
  RETURN NEW;
END $$;
CREATE TRIGGER metered_views_log_consume AFTER INSERT ON public.metered_views
  FOR EACH ROW EXECUTE FUNCTION public.log_metering_consumption();

CREATE OR REPLACE FUNCTION public.log_metering_event(
  _entity_type text, _entity_id uuid, _outcome text,
  _reason text DEFAULT NULL, _visitor_id uuid DEFAULT NULL,
  _used_before integer DEFAULT NULL, _monthly_limit integer DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
BEGIN
  IF _outcome NOT IN ('denied','granted','exempt','requires_registration') THEN
    RAISE EXCEPTION 'invalid outcome %', _outcome;
  END IF;
  INSERT INTO public.metering_event_log
    (tenant_id, user_id, visitor_id, entity_type, entity_id, outcome, reason, used_before, monthly_limit)
  VALUES
    (public.public_tenant_id(), auth.uid(), _visitor_id, _entity_type, _entity_id,
     _outcome, _reason, _used_before, _monthly_limit);
END $$;
GRANT EXECUTE ON FUNCTION public.log_metering_event(text,uuid,text,text,uuid,integer,integer) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.validate_b2b_coupon(
  _code text, _plan_id uuid, _amount_cents integer, _currency text
) RETURNS TABLE(
  ok boolean, error text, coupon_id uuid, discount_cents integer,
  final_cents integer, label text, discount_kind text, discount_percent integer
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' STABLE AS $$
DECLARE
  c public.b2b_coupons%ROWTYPE;
  v_disc integer := 0;
  v_norm text := upper(trim(coalesce(_code,'')));
BEGIN
  IF v_norm = '' THEN
    RETURN QUERY SELECT false,'empty_code'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN
    RETURN QUERY SELECT false,'invalid_amount'::text,NULL::uuid,0,coalesce(_amount_cents,0),NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  SELECT * INTO c FROM public.b2b_coupons
    WHERE tenant_id = public.public_tenant_id() AND upper(code) = v_norm;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false,'not_found'::text,NULL::uuid,0,_amount_cents,NULL::text,NULL::text,NULL::integer; RETURN;
  END IF;
  IF NOT c.active THEN
    RETURN QUERY SELECT false,'inactive'::text,c.id,0,_amount_cents,c.name,c.discount_kind,c.discount_percent; RETURN;
  END IF;
  IF c.valid_from IS NOT NULL AND now() < c.valid_from THEN
    RETURN QUERY SELECT false,'not_yet_valid'::text,c.id,0,_amount_cents,c.name,c.discount_kind,c.discount_percent; RETURN;
  END IF;
  IF c.valid_until IS NOT NULL AND now() > c.valid_until THEN
    RETURN QUERY SELECT false,'expired'::text,c.id,0,_amount_cents,c.name,c.discount_kind,c.discount_percent; RETURN;
  END IF;
  IF c.max_redemptions IS NOT NULL AND c.redemptions_count >= c.max_redemptions THEN
    RETURN QUERY SELECT false,'limit_reached'::text,c.id,0,_amount_cents,c.name,c.discount_kind,c.discount_percent; RETURN;
  END IF;
  IF array_length(c.plan_ids,1) IS NOT NULL AND _plan_id IS NOT NULL
     AND NOT (_plan_id = ANY(c.plan_ids)) THEN
    RETURN QUERY SELECT false,'plan_not_eligible'::text,c.id,0,_amount_cents,c.name,c.discount_kind,c.discount_percent; RETURN;
  END IF;
  IF c.discount_kind = 'percent' THEN
    v_disc := (_amount_cents * COALESCE(c.discount_percent,0)) / 100;
  ELSE
    IF c.currency IS NOT NULL AND upper(c.currency) <> upper(_currency) THEN
      RETURN QUERY SELECT false,'currency_mismatch'::text,c.id,0,_amount_cents,c.name,c.discount_kind,c.discount_percent; RETURN;
    END IF;
    v_disc := LEAST(COALESCE(c.discount_cents,0),_amount_cents);
  END IF;
  RETURN QUERY SELECT true,NULL::text,c.id,v_disc,GREATEST(_amount_cents-v_disc,0),c.name,c.discount_kind,c.discount_percent;
END $$;
GRANT EXECUTE ON FUNCTION public.validate_b2b_coupon(text,uuid,integer,text) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.redeem_b2b_coupon(
  _coupon_id uuid, _order_id uuid, _applied_cents integer,
  _original_cents integer, _currency text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' AS $$
DECLARE v_tenant uuid := public.public_tenant_id();
BEGIN
  UPDATE public.b2b_coupons
     SET redemptions_count = redemptions_count + 1, updated_at = now()
   WHERE id = _coupon_id AND tenant_id = v_tenant AND active
     AND (max_redemptions IS NULL OR redemptions_count < max_redemptions)
     AND (valid_from IS NULL OR now() >= valid_from)
     AND (valid_until IS NULL OR now() <= valid_until);
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.b2b_coupon_redemptions
    (tenant_id, coupon_id, order_id, user_id, applied_cents, original_cents, currency)
  VALUES
    (v_tenant, _coupon_id, _order_id, auth.uid(), _applied_cents, _original_cents, _currency);
  RETURN true;
END $$;
GRANT EXECUTE ON FUNCTION public.redeem_b2b_coupon(uuid,uuid,integer,integer,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.monetization_dashboard(
  _from timestamptz DEFAULT (now() - interval '30 days'),
  _to timestamptz DEFAULT now(),
  _plan_id uuid DEFAULT NULL,
  _organization_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public' STABLE AS $$
DECLARE v_tenant uuid := public.public_tenant_id(); v_out jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'editor')) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  WITH mv AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE user_id IS NOT NULL)::int AS members,
           count(*) FILTER (WHERE user_id IS NULL)::int AS anonymous
    FROM public.metered_views
    WHERE tenant_id = v_tenant AND created_at >= _from AND created_at <= _to
  ), ev AS (
    SELECT
      count(*) FILTER (WHERE outcome='consumed')::int AS consumed,
      count(*) FILTER (WHERE outcome='denied')::int AS denied,
      count(*) FILTER (WHERE outcome='requires_registration')::int AS reg_wall
    FROM public.metering_event_log
    WHERE tenant_id = v_tenant AND occurred_at >= _from AND occurred_at <= _to
  ), orders AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE status='paid')::int AS paid,
           coalesce(sum(amount_cents) FILTER (WHERE status='paid'),0)::bigint AS revenue_cents
    FROM public.payment_orders
    WHERE created_at >= _from AND created_at <= _to
      AND (_plan_id IS NULL OR plan_id = _plan_id)
  ), coupons AS (
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE active)::int AS active,
           coalesce(sum(redemptions_count),0)::int AS redemptions
    FROM public.b2b_coupons
    WHERE tenant_id = v_tenant
      AND (_organization_id IS NULL OR organization_id = _organization_id)
  ), redemptions AS (
    SELECT count(*)::int AS in_range,
           coalesce(sum(applied_cents),0)::bigint AS discount_cents
    FROM public.b2b_coupon_redemptions r
    WHERE r.tenant_id = v_tenant
      AND r.created_at >= _from AND r.created_at <= _to
      AND (_organization_id IS NULL
           OR EXISTS (SELECT 1 FROM public.b2b_coupons c
                       WHERE c.id = r.coupon_id AND c.organization_id = _organization_id))
  ), cs AS (
    SELECT to_jsonb(cs.*) AS settings
    FROM public.checkout_settings cs
    WHERE cs.tenant_id = v_tenant
    LIMIT 1
  )
  SELECT jsonb_build_object(
    'range', jsonb_build_object('from', _from, 'to', _to),
    'metered_views', (SELECT to_jsonb(mv) FROM mv),
    'metering_events', (SELECT to_jsonb(ev) FROM ev),
    'orders', (SELECT to_jsonb(orders) FROM orders),
    'coupons', (SELECT to_jsonb(coupons) FROM coupons),
    'redemptions', (SELECT to_jsonb(redemptions) FROM redemptions),
    'checkout_settings', COALESCE((SELECT settings FROM cs), '{}'::jsonb)
  ) INTO v_out;
  RETURN v_out;
END $$;
GRANT EXECUTE ON FUNCTION public.monetization_dashboard(timestamptz,timestamptz,uuid,uuid) TO authenticated;
