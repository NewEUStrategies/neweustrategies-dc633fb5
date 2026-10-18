-- Twin of supabase/migrations/20261007140200_release_coupon_server_only.sql (same executable SQL).
-- Port onto the production lane: until now the release_b2b_coupon abuse fix existed only in the
-- supabase lane. Rationale, deploy order and the pgTAP proof live in that file.

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
  -- Zamowienie TEGO konta, w TYM najemcy, jeszcze nieoplacone. Oplacone,
  -- przetwarzane i zwrocone zachowuja realizacje - inaczej zwolnienie
  -- resetowaloby limit kodu po skorzystaniu z rabatu.
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_orders o
     WHERE o.id = _order_id AND o.tenant_id = p_tenant AND o.user_id = p_uid
       AND o.status IN ('pending', 'failed', 'canceled')
  ) THEN
    RETURN false;
  END IF;
  -- Blokada wiersza kodu: rownolegla rezerwacja i zwolnienie licza na tym samym
  -- liczniku.
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

CREATE OR REPLACE FUNCTION public.release_b2b_coupon_for_user(
  _tenant_id uuid, _user_id uuid, _coupon_id uuid, _order_id uuid
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public._release_b2b_coupon(_tenant_id, _user_id, _coupon_id, _order_id);
END $$;
REVOKE ALL ON FUNCTION public.release_b2b_coupon_for_user(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_b2b_coupon_for_user(uuid, uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.release_b2b_coupon(_coupon_id uuid, _order_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public._release_b2b_coupon(
    (SELECT o.tenant_id FROM public.payment_orders o WHERE o.id = _order_id),
    auth.uid(), _coupon_id, _order_id);
END $$;
REVOKE ALL ON FUNCTION public.release_b2b_coupon(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_b2b_coupon(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.release_b2b_coupon_for_user(uuid, uuid, uuid, uuid) IS
  'Zwolnienie uzycia kodu - TYLKO service_role. Wylacznie dla nieoplaconego (pending/failed/canceled) zamowienia tego konta w tym najemcy; usuwa tylko wiersze tego konta.';
COMMENT ON FUNCTION public.release_b2b_coupon(uuid, uuid) IS
  'Wrapper zgodnosci (konto z JWT, najemca zamowienia) z tymi samymi warunkami - TYLKO service_role. Kasa woluje release_b2b_coupon_for_user.';
