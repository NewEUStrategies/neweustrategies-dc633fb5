
CREATE TABLE public.saved_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT public_tenant_id(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  entity text NOT NULL CHECK (entity IN ('company', 'lead', 'contact')),
  name text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_shared boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX saved_views_user_entity_idx ON public.saved_views (user_id, entity, sort_order);
CREATE INDEX saved_views_tenant_entity_shared_idx ON public.saved_views (tenant_id, entity) WHERE is_shared;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_views TO authenticated;
GRANT ALL ON public.saved_views TO service_role;

ALTER TABLE public.saved_views ENABLE ROW LEVEL SECURITY;

CREATE POLICY "saved_views_select" ON public.saved_views
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND (user_id = auth.uid() OR is_shared = true));

CREATE POLICY "saved_views_insert" ON public.saved_views
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id() AND user_id = auth.uid());

CREATE POLICY "saved_views_update" ON public.saved_views
  FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id() AND user_id = auth.uid())
  WITH CHECK (tenant_id = current_tenant_id() AND user_id = auth.uid());

CREATE POLICY "saved_views_delete" ON public.saved_views
  FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id() AND user_id = auth.uid());

CREATE TRIGGER saved_views_set_updated_at
  BEFORE UPDATE ON public.saved_views
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
