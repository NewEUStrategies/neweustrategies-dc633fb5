CREATE OR REPLACE FUNCTION public._release_b2b_coupon(
  p_tenant uuid, p_uid uuid, _coupon_id uuid, _order_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF p_tenant IS NULL OR p_uid IS NULL OR _coupon_id IS NULL OR _order_id IS NULL THEN
    RETURN false;
  END IF;
  PERFORM 1 FROM public.payment_orders o
   WHERE o.id = _order_id AND o.tenant_id = p_tenant AND o.user_id = p_uid
     AND o.status IN ('pending', 'failed', 'canceled')
   FOR SHARE OF o;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  PERFORM 1 FROM public.b2b_coupons
   WHERE id = _coupon_id AND tenant_id = p_tenant
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  DELETE FROM public.b2b_coupon_redemptions r
   WHERE r.coupon_id = _coupon_id AND r.order_id = _order_id
     AND r.user_id = p_uid AND r.tenant_id = p_tenant;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    RETURN false;
  END IF;
  UPDATE public.b2b_coupons
     SET redemptions_count = GREATEST(0, COALESCE(redemptions_count, 0) - v_deleted),
         updated_at = now()
   WHERE id = _coupon_id AND tenant_id = p_tenant;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._release_b2b_coupon(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;