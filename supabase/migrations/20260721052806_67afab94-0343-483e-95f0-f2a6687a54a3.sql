-- ── 1) profiles: prevent users from switching their own tenant_id ─────────
-- Users can UPDATE/INSERT their own profile row, but tenant_id must be
-- immutable from the caller's side. Provisioning happens via triggers /
-- service role. Enforced via BEFORE trigger so it applies regardless of
-- which SELECT/UPDATE column set the client sends.
CREATE OR REPLACE FUNCTION public.profiles_pin_tenant_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_service boolean := (current_setting('request.jwt.claim.role', true) = 'service_role')
                          OR (current_user = 'service_role');
  v_is_super boolean := public.has_role(auth.uid(), 'super_admin'::public.app_role);
BEGIN
  IF v_is_service OR v_is_super THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Force new self-inserts to the caller's provisioned tenant. If none yet,
    -- fall back to the default tenant so the row is still valid.
    IF NEW.id = auth.uid() THEN
      NEW.tenant_id := COALESCE(
        (SELECT tenant_id FROM public.profiles WHERE id = auth.uid()),
        NEW.tenant_id,
        (SELECT id FROM public.tenants WHERE is_default = true LIMIT 1)
      );
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: tenant_id is immutable for the row owner.
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'profiles.tenant_id is immutable'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_pin_tenant_id_bi ON public.profiles;
CREATE TRIGGER profiles_pin_tenant_id_bi
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_pin_tenant_id();

DROP TRIGGER IF EXISTS profiles_pin_tenant_id_bu ON public.profiles;
CREATE TRIGGER profiles_pin_tenant_id_bu
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_pin_tenant_id();

-- ── 2) payment_orders: add WITH CHECK on admin UPDATE ─────────────────────
DROP POLICY IF EXISTS "orders admin update" ON public.payment_orders;
CREATE POLICY "orders admin update"
  ON public.payment_orders
  FOR UPDATE
  USING ((tenant_id = current_tenant_id()) AND has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK ((tenant_id = current_tenant_id()) AND has_role(auth.uid(), 'admin'::app_role));

-- ── 3) Align WITH CHECK on staff UPDATE policies to full USING condition ──
DROP POLICY IF EXISTS "pls staff update" ON public.post_layout_settings;
CREATE POLICY "pls staff update"
  ON public.post_layout_settings
  FOR UPDATE
  USING ((tenant_id = current_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)))
  WITH CHECK ((tenant_id = current_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)));

DROP POLICY IF EXISTS "newsletter_settings staff update" ON public.newsletter_settings;
CREATE POLICY "newsletter_settings staff update"
  ON public.newsletter_settings
  FOR UPDATE
  USING ((tenant_id = current_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)))
  WITH CHECK ((tenant_id = current_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)));

DROP POLICY IF EXISTS "campaigns_staff_update" ON public.newsletter_campaigns;
CREATE POLICY "campaigns_staff_update"
  ON public.newsletter_campaigns
  FOR UPDATE
  USING ((tenant_id = current_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)))
  WITH CHECK ((tenant_id = current_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)));

DROP POLICY IF EXISTS "plans staff update" ON public.access_plans;
CREATE POLICY "plans staff update"
  ON public.access_plans
  FOR UPDATE
  USING ((tenant_id = current_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)))
  WITH CHECK ((tenant_id = current_tenant_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'editor'::app_role)));

-- ── 4) Function search_path: pin nes_post_embedding_source ────────────────
ALTER FUNCTION public.nes_post_embedding_source(text, text, text, text)
  SET search_path = public, pg_temp;
