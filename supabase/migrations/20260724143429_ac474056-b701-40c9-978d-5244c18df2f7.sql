-- Fix: payment_orders owner insert must only allow status='pending' (webhook writes 'paid')
DROP POLICY IF EXISTS "orders owner insert" ON public.payment_orders;
CREATE POLICY "orders owner insert" ON public.payment_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = current_tenant_id()
    AND status = 'pending'::order_status
    AND paid_at IS NULL
  );

-- Defense-in-depth trigger: block any non-service_role writer from setting paid/processing/refunded on INSERT/UPDATE
CREATE OR REPLACE FUNCTION public.payment_orders_guard_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_service boolean := (current_setting('request.jwt.claim.role', true) = 'service_role')
                       OR (current_user = 'service_role');
BEGIN
  IF is_service THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending'::order_status OR NEW.paid_at IS NOT NULL THEN
      RAISE EXCEPTION 'Only service_role can create orders with non-pending status';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
       OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
       OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
       OR NEW.entity_id IS DISTINCT FROM OLD.entity_id
       OR NEW.entity_type IS DISTINCT FROM OLD.entity_type
       OR NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.provider_intent_id IS DISTINCT FROM OLD.provider_intent_id
       OR NEW.provider_session_id IS DISTINCT FROM OLD.provider_session_id
       OR NEW.provider_subscription_id IS DISTINCT FROM OLD.provider_subscription_id THEN
      IF NOT has_role(auth.uid(), 'admin'::app_role) THEN
        RAISE EXCEPTION 'Financial fields on payment_orders can only be updated by service_role or admin';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_orders_guard_status_trg ON public.payment_orders;
CREATE TRIGGER payment_orders_guard_status_trg
  BEFORE INSERT OR UPDATE ON public.payment_orders
  FOR EACH ROW EXECUTE FUNCTION public.payment_orders_guard_status();

-- Fix: billing_profiles owner update must enforce tenant_id
DROP POLICY IF EXISTS "billing owner update" ON public.billing_profiles;
CREATE POLICY "billing owner update" ON public.billing_profiles
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND tenant_id = current_tenant_id())
  WITH CHECK (user_id = auth.uid() AND tenant_id = current_tenant_id());