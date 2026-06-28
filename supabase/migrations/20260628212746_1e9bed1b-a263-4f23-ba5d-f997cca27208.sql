
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'super_admin'::public.app_role
  )
$$;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.grant_super_admin_for_marketing_email()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tenant uuid;
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL
     AND lower(NEW.email) = 'marketing@neweuropeanstrategies.com' THEN
    SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = NEW.id;
    IF v_tenant IS NULL THEN
      SELECT id INTO v_tenant FROM public.tenants WHERE slug = 'nes' LIMIT 1;
    END IF;
    IF v_tenant IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role, tenant_id)
      VALUES (NEW.id, 'super_admin'::public.app_role, v_tenant)
      ON CONFLICT (user_id, role, tenant_id) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created_grant_super_admin ON auth.users;
CREATE TRIGGER on_auth_user_created_grant_super_admin
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.grant_super_admin_for_marketing_email();

DROP TRIGGER IF EXISTS on_auth_user_confirmed_grant_super_admin ON auth.users;
CREATE TRIGGER on_auth_user_confirmed_grant_super_admin
AFTER UPDATE OF email_confirmed_at ON auth.users
FOR EACH ROW
WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
EXECUTE FUNCTION public.grant_super_admin_for_marketing_email();

-- Backfill existing user if already present
DO $$
DECLARE v_uid uuid; v_tenant uuid;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE lower(email) = 'marketing@neweuropeanstrategies.com' LIMIT 1;
  IF v_uid IS NOT NULL THEN
    SELECT tenant_id INTO v_tenant FROM public.profiles WHERE id = v_uid;
    IF v_tenant IS NULL THEN SELECT id INTO v_tenant FROM public.tenants WHERE slug='nes' LIMIT 1; END IF;
    IF v_tenant IS NOT NULL THEN
      INSERT INTO public.user_roles (user_id, role, tenant_id)
      VALUES (v_uid, 'super_admin'::public.app_role, v_tenant)
      ON CONFLICT (user_id, role, tenant_id) DO NOTHING;
    END IF;
  END IF;
END $$;

DROP POLICY IF EXISTS "super_admin manages roles" ON public.user_roles;
CREATE POLICY "super_admin manages roles" ON public.user_roles
FOR ALL TO authenticated
USING (public.is_super_admin())
WITH CHECK (public.is_super_admin());

CREATE TABLE IF NOT EXISTS public.subscription_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name_pl text NOT NULL,
  name_en text NOT NULL,
  description_pl text,
  description_en text,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscription_tiers TO anon, authenticated;
GRANT ALL ON public.subscription_tiers TO service_role;
ALTER TABLE public.subscription_tiers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tiers public read" ON public.subscription_tiers;
CREATE POLICY "tiers public read" ON public.subscription_tiers FOR SELECT USING (is_active);
DROP POLICY IF EXISTS "tiers super_admin write" ON public.subscription_tiers;
CREATE POLICY "tiers super_admin write" ON public.subscription_tiers
FOR ALL TO authenticated
USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
DROP TRIGGER IF EXISTS subscription_tiers_set_updated ON public.subscription_tiers;
CREATE TRIGGER subscription_tiers_set_updated
BEFORE UPDATE ON public.subscription_tiers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.subscription_tiers (slug, name_pl, name_en, description_pl, description_en, sort_order) VALUES
  ('free',    'Bezpłatny','Free',   'Dostęp do podstawowych materiałów.','Access to basic content.',1),
  ('monthly', 'Miesięczny','Monthly','Pełny dostęp w abonamencie miesięcznym.','Full access on a monthly plan.',2),
  ('yearly',  'Roczny',   'Yearly', 'Pełny dostęp w abonamencie rocznym.','Full access on a yearly plan.',3),
  ('premium', 'Premium',  'Premium','Premium: ekskluzywne materiały i wydarzenia.','Premium: exclusive content and events.',4)
ON CONFLICT (slug) DO NOTHING;
