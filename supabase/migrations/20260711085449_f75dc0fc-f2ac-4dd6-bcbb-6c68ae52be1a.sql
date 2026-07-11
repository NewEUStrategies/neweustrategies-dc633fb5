-- P0 security hardening
-- 1) Prevent direct SELECT of content_access.password_hash by client roles.
--    App code should use RPC/functions (has_content_access, verify_content_password)
--    instead of reading the hash. Presence can be exposed as computed column via
--    a security-definer RPC if needed.
REVOKE SELECT (password_hash) ON public.content_access FROM anon, authenticated;

-- Expose only "has password" presence to clients via a stable RPC (staff-safe;
-- readable by anyone who can already SELECT the row per existing RLS).
CREATE OR REPLACE FUNCTION public.content_access_has_password(
  _entity_type public.access_entity_type,
  _entity_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.content_access
    WHERE entity_type = _entity_type
      AND entity_id = _entity_id
      AND password_hash IS NOT NULL
      AND password_hash <> ''
  );
$$;

GRANT EXECUTE ON FUNCTION public.content_access_has_password(public.access_entity_type, uuid)
  TO anon, authenticated;

-- 2) Constrain client-side INSERT on payment_orders: force safe initial state.
--    Only service_role (used by Stripe webhook) may set status/paid state/provider IDs.
CREATE OR REPLACE FUNCTION public.payment_orders_secure_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service role and admin bypass (webhooks, admin tooling)
  IF current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Force safe initial state for user-originated inserts
  NEW.status := 'pending';
  NEW.provider_session_id := NULL;
  NEW.provider_intent_id := NULL;
  NEW.invoice_url := NULL;
  NEW.paid_at := NULL;

  -- Prevent spoofing user_id (RLS already checks, defensive)
  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'payment_orders.user_id must match auth.uid()';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_orders_secure_insert_trg ON public.payment_orders;
CREATE TRIGGER payment_orders_secure_insert_trg
  BEFORE INSERT ON public.payment_orders
  FOR EACH ROW EXECUTE FUNCTION public.payment_orders_secure_insert();