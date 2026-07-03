
-- 1. TABLE
CREATE TABLE public.mobile_drawer_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  section_order text[] NOT NULL DEFAULT ARRAY['top_tools','account','nav','builder']::text[],
  top_tools jsonb NOT NULL DEFAULT '{"search":true,"theme":true,"language":true}'::jsonb,
  nav_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mobile_drawer_section_order_len CHECK (array_length(section_order, 1) BETWEEN 1 AND 8),
  CONSTRAINT mobile_drawer_nav_items_is_array CHECK (jsonb_typeof(nav_items) = 'array'),
  CONSTRAINT mobile_drawer_top_tools_is_object CHECK (jsonb_typeof(top_tools) = 'object')
);

-- 2. GRANTS
-- anon+authenticated can SELECT (drawer is rendered on public pages, filter by public_tenant_id())
GRANT SELECT ON public.mobile_drawer_configs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mobile_drawer_configs TO authenticated;
GRANT ALL ON public.mobile_drawer_configs TO service_role;

-- 3. RLS
ALTER TABLE public.mobile_drawer_configs ENABLE ROW LEVEL SECURITY;

-- 4. POLICIES
-- Public read: only for the tenant matching the current host
CREATE POLICY "mobile_drawer_public_read"
  ON public.mobile_drawer_configs FOR SELECT
  TO anon, authenticated
  USING (tenant_id = public.public_tenant_id());

-- Super-admin write: only within the caller's own tenant
CREATE POLICY "mobile_drawer_super_admin_write"
  ON public.mobile_drawer_configs FOR ALL
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.is_super_admin(auth.uid())
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND public.is_super_admin(auth.uid())
  );

-- 5. updated_at trigger (reuse existing set_updated_at)
CREATE TRIGGER mobile_drawer_configs_set_updated_at
  BEFORE UPDATE ON public.mobile_drawer_configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. audit log trigger on upsert
CREATE OR REPLACE FUNCTION public.mobile_drawer_configs_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_log (tenant_id, actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    NEW.tenant_id,
    auth.uid(),
    CASE WHEN TG_OP = 'INSERT' THEN 'mobile_drawer.create' ELSE 'mobile_drawer.update' END,
    'mobile_drawer_config',
    NEW.id,
    jsonb_build_object(
      'section_order', to_jsonb(NEW.section_order),
      'nav_items_count', jsonb_array_length(NEW.nav_items),
      'top_tools', NEW.top_tools
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER mobile_drawer_configs_audit_trigger
  AFTER INSERT OR UPDATE ON public.mobile_drawer_configs
  FOR EACH ROW EXECUTE FUNCTION public.mobile_drawer_configs_audit();
