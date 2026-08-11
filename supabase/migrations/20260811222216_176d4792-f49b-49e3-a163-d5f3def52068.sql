CREATE OR REPLACE FUNCTION public.payment_order_mark_session(
  _order_id uuid,
  _session_id text DEFAULT NULL,
  _status public.order_status DEFAULT 'processing'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _updated integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  -- Tylko przejścia z etapu otwierania sesji. Stany końcowe (paid, refunded)
  -- ustawia wyłącznie webhook operatora przez rolę serwisową.
  IF _status NOT IN ('processing', 'failed', 'canceled') THEN
    RETURN false;
  END IF;

  UPDATE public.payment_orders o
     SET status = _status,
         provider_session_id = COALESCE(_session_id, o.provider_session_id),
         updated_at = now()
   WHERE o.id = _order_id
     AND o.user_id = auth.uid()
     AND o.paid_at IS NULL
     AND o.status IN ('pending', 'processing');

  GET DIAGNOSTICS _updated = ROW_COUNT;
  RETURN _updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.payment_order_mark_session(uuid, text, public.order_status) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_order_mark_session(uuid, text, public.order_status) TO authenticated;
GRANT EXECUTE ON FUNCTION public.payment_order_mark_session(uuid, text, public.order_status) TO service_role;