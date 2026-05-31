-- Brand design tokens per tenant: colors, font pairs, spacing scale, radius.
CREATE TABLE public.site_design_tokens (
  tenant_id uuid NOT NULL PRIMARY KEY DEFAULT public.current_tenant_id(),
  colors jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Example shape: [{ "name": "primary", "value": "#3B82F6" }, ...]
  fonts jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Example shape: { "heading": "Inter", "body": "Inter", "pair": "inter-inter" }
  scale jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Example shape: { "radius": "8px", "spacing": ["4px","8px","16px","24px","48px"] }
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

-- Public read so the published site can apply tokens for anonymous visitors.
GRANT SELECT ON public.site_design_tokens TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_design_tokens TO authenticated;
GRANT ALL ON public.site_design_tokens TO service_role;

ALTER TABLE public.site_design_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "design_tokens public read"
  ON public.site_design_tokens
  FOR SELECT
  USING (true);

CREATE POLICY "design_tokens staff insert tenant"
  ON public.site_design_tokens
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'editor'::app_role))
  );

CREATE POLICY "design_tokens staff update tenant"
  ON public.site_design_tokens
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'editor'::app_role))
  )
  WITH CHECK (tenant_id = public.current_tenant_id());

-- Keep updated_at fresh.
CREATE TRIGGER trg_design_tokens_updated_at
  BEFORE UPDATE ON public.site_design_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
