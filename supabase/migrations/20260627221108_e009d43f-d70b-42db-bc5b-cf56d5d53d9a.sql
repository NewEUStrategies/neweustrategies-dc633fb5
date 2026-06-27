
-- 1. Table
CREATE TABLE public.post_sidebar_layouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  widgets jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX post_sidebar_layouts_tenant_idx ON public.post_sidebar_layouts (tenant_id);
CREATE UNIQUE INDEX post_sidebar_layouts_one_default_idx
  ON public.post_sidebar_layouts (tenant_id) WHERE is_default;

-- 2. Grants (public read allowed; writes go through RLS)
GRANT SELECT ON public.post_sidebar_layouts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_sidebar_layouts TO authenticated;
GRANT ALL ON public.post_sidebar_layouts TO service_role;

-- 3. RLS
ALTER TABLE public.post_sidebar_layouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "post_sidebar_layouts public read"
  ON public.post_sidebar_layouts
  FOR SELECT
  USING (true);

CREATE POLICY "post_sidebar_layouts admin/editor write"
  ON public.post_sidebar_layouts
  FOR ALL
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  );

-- 4. updated_at trigger
CREATE TRIGGER post_sidebar_layouts_set_updated_at
  BEFORE UPDATE ON public.post_sidebar_layouts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. Enforce at most one is_default per tenant via trigger (covers updates that would create conflict)
CREATE OR REPLACE FUNCTION public.post_sidebar_layouts_enforce_default()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE public.post_sidebar_layouts
       SET is_default = false
     WHERE tenant_id = NEW.tenant_id
       AND id <> NEW.id
       AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER post_sidebar_layouts_enforce_default_trg
  BEFORE INSERT OR UPDATE ON public.post_sidebar_layouts
  FOR EACH ROW EXECUTE FUNCTION public.post_sidebar_layouts_enforce_default();

-- 6. Posts override column
ALTER TABLE public.posts
  ADD COLUMN sidebar_layout_id uuid NULL
  REFERENCES public.post_sidebar_layouts(id) ON DELETE SET NULL;

CREATE INDEX posts_sidebar_layout_idx ON public.posts(sidebar_layout_id);

-- 7. Seed default layout for every existing tenant
INSERT INTO public.post_sidebar_layouts (tenant_id, name, is_default, widgets)
SELECT
  t.id,
  'default',
  true,
  jsonb_build_array(
    jsonb_build_object(
      'id', gen_random_uuid()::text,
      'type', 'reading-panel',
      'hidden', false,
      'settings', jsonb_build_object(
        'showToc', true,
        'showProgress', true,
        'showSaveLater', true,
        'showPrint', true,
        'showPdf', true,
        'social', jsonb_build_object(
          'x', true,
          'facebook', true,
          'linkedin', true,
          'mail', true,
          'copy', true,
          'whatsapp', false,
          'telegram', false,
          'reddit', false
        )
      )
    )
  )
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.post_sidebar_layouts l
   WHERE l.tenant_id = t.id AND l.is_default
);
