ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS last_event_at timestamptz;

COMMENT ON COLUMN public.subscriptions.last_event_at IS
  'occurred_at ostatniego zastosowanego zdarzenia operatora - strażnik kolejności (out-of-order webhooks).';

CREATE OR REPLACE FUNCTION public.release_b2b_coupon(_coupon_id uuid, _order_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _deleted int;
BEGIN
  DELETE FROM public.b2b_coupon_redemptions
   WHERE coupon_id = _coupon_id AND order_id = _order_id;
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  IF _deleted = 0 THEN
    RETURN false;
  END IF;
  UPDATE public.b2b_coupons
     SET redemptions_count = GREATEST(0, COALESCE(redemptions_count, 0) - _deleted),
         updated_at = now()
   WHERE id = _coupon_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.release_b2b_coupon(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_b2b_coupon(uuid, uuid) TO authenticated, service_role;