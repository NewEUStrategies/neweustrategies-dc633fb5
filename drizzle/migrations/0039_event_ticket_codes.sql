-- Kody rejestracyjne wydarzen (model Swapcard „Registration codes").
-- Kod zyje w b2b_coupons (licznik, audyt, atomowe redeem) z przelacznikami
-- applies_discount i reveals_hidden. Zakres: event_ids + ticket_type_ids.
-- Zamyka tez dziure: validate_b2b_coupon ignorowal event_ids.

ALTER TABLE public.b2b_coupons
  ADD COLUMN IF NOT EXISTS applies_discount boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reveals_hidden boolean NOT NULL DEFAULT false;

ALTER TABLE public.b2b_coupons DROP CONSTRAINT IF EXISTS b2b_coupons_discount_shape;
ALTER TABLE public.b2b_coupons ADD CONSTRAINT b2b_coupons_discount_shape CHECK (
  (applies_discount = false AND discount_percent IS NULL AND discount_cents IS NULL AND reveals_hidden = true)
  OR (applies_discount = true AND discount_kind = 'percent' AND discount_percent IS NOT NULL AND discount_cents IS NULL)
  OR (applies_discount = true AND discount_kind = 'fixed' AND discount_cents IS NOT NULL AND discount_percent IS NULL)
);

CREATE INDEX IF NOT EXISTS b2b_coupons_event_ids_gin ON public.b2b_coupons USING gin (event_ids);

CREATE OR REPLACE FUNCTION public._b2b_coupon_evaluate(c public.b2b_coupons, _amount_cents integer, _currency text)
RETURNS TABLE(ok boolean, error text, coupon_id uuid, discount_cents integer, final_cents integer, label text, discount_kind text, discount_percent integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_disc integer := 0;
  v_used integer := 0;
BEGIN
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
  IF c.max_redemptions_per_user IS NOT NULL AND auth.uid() IS NOT NULL THEN
    SELECT count(*)::integer INTO v_used FROM public.b2b_coupon_redemptions r
     WHERE r.coupon_id = c.id AND r.user_id = auth.uid();
    IF v_used >= c.max_redemptions_per_user THEN
      RETURN QUERY SELECT false,'per_user_limit_reached'::text,c.id,0,_amount_cents,c.name,c.discount_kind,c.discount_percent; RETURN;
    END IF;
  END IF;
  IF NOT c.applies_discount THEN
    RETURN QUERY SELECT false,'no_discount'::text,c.id,0,_amount_cents,c.name,c.discount_kind,c.discount_percent; RETURN;
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
REVOKE ALL ON FUNCTION public._b2b_coupon_evaluate(public.b2b_coupons, integer, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validate_b2b_coupon(_code text, _plan_id uuid, _amount_cents integer, _currency text)
RETURNS TABLE(ok boolean, error text, coupon_id uuid, discount_cents integer, final_cents integer, label text, discount_kind text, discount_percent integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  c public.b2b_coupons%ROWTYPE;
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
  IF array_length(c.event_ids,1) IS NOT NULL THEN
    RETURN QUERY SELECT false,'event_not_eligible'::text,c.id,0,_amount_cents,c.name,c.discount_kind,c.discount_percent; RETURN;
  END IF;
  IF array_length(c.plan_ids,1) IS NOT NULL AND _plan_id IS NOT NULL AND NOT (_plan_id = ANY(c.plan_ids)) THEN
    RETURN QUERY SELECT false,'plan_not_eligible'::text,c.id,0,_amount_cents,c.name,c.discount_kind,c.discount_percent; RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public._b2b_coupon_evaluate(c, _amount_cents, _currency);
END $$;

CREATE OR REPLACE FUNCTION public.validate_event_ticket_coupon(_code text, _event_id uuid, _ticket_type_id uuid, _amount_cents integer, _currency text)
RETURNS TABLE(ok boolean, error text, coupon_id uuid, discount_cents integer, final_cents integer, label text, discount_kind text, discount_percent integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  c public.b2b_coupons%ROWTYPE;
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
  IF array_length(c.event_ids,1) IS NOT NULL AND (_event_id IS NULL OR NOT (_event_id = ANY(c.event_ids))) THEN
    RETURN QUERY SELECT false,'event_not_eligible'::text,c.id,0,_amount_cents,c.name,c.discount_kind,c.discount_percent; RETURN;
  END IF;
  IF array_length(c.event_ids,1) IS NULL AND array_length(c.plan_ids,1) IS NOT NULL THEN
    RETURN QUERY SELECT false,'plan_not_eligible'::text,c.id,0,_amount_cents,c.name,c.discount_kind,c.discount_percent; RETURN;
  END IF;
  IF array_length(c.ticket_type_ids,1) IS NOT NULL AND (_ticket_type_id IS NULL OR NOT (_ticket_type_id = ANY(c.ticket_type_ids))) THEN
    RETURN QUERY SELECT false,'ticket_not_eligible'::text,c.id,0,_amount_cents,c.name,c.discount_kind,c.discount_percent; RETURN;
  END IF;
  RETURN QUERY SELECT * FROM public._b2b_coupon_evaluate(c, _amount_cents, _currency);
END $$;
REVOKE ALL ON FUNCTION public.validate_event_ticket_coupon(text, uuid, uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_event_ticket_coupon(text, uuid, uuid, integer, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.event_coupon_revealed_tickets(p_event_id uuid, p_code text)
RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  c public.b2b_coupons%ROWTYPE;
  v_norm text := upper(trim(coalesce(p_code,'')));
  v_ids uuid[];
BEGIN
  IF v_norm = '' OR length(v_norm) > 64 OR p_event_id IS NULL THEN RETURN ARRAY[]::uuid[]; END IF;
  SELECT * INTO c FROM public.b2b_coupons
   WHERE tenant_id = public.public_tenant_id() AND upper(code) = v_norm
     AND active AND reveals_hidden AND p_event_id = ANY(event_ids)
     AND (valid_from IS NULL OR now() >= valid_from)
     AND (valid_until IS NULL OR now() <= valid_until)
     AND (max_redemptions IS NULL OR redemptions_count < max_redemptions);
  IF NOT FOUND THEN RETURN ARRAY[]::uuid[]; END IF;
  SELECT coalesce(array_agg(t.id), ARRAY[]::uuid[]) INTO v_ids
    FROM public.event_ticket_types t
   WHERE t.event_id = p_event_id AND t.is_hidden
     AND t.tenant_id = public.public_tenant_id()
     AND (array_length(c.ticket_type_ids,1) IS NULL OR t.id = ANY(c.ticket_type_ids));
  RETURN v_ids;
END $$;
REVOKE ALL ON FUNCTION public.event_coupon_revealed_tickets(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.event_coupon_revealed_tickets(uuid, text) TO anon, authenticated, service_role;
