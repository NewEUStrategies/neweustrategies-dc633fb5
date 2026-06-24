
-- 1) Global custom meta definitions per tenant
CREATE TABLE IF NOT EXISTS public.post_custom_meta_defs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  label_pl text NOT NULL DEFAULT '',
  label_en text NOT NULL DEFAULT '',
  icon text NOT NULL DEFAULT 'Info',
  position int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

GRANT SELECT ON public.post_custom_meta_defs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.post_custom_meta_defs TO authenticated;
GRANT ALL ON public.post_custom_meta_defs TO service_role;

ALTER TABLE public.post_custom_meta_defs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Custom meta defs are publicly readable"
  ON public.post_custom_meta_defs FOR SELECT
  USING (true);

CREATE POLICY "Editors can manage custom meta defs within tenant"
  ON public.post_custom_meta_defs FOR ALL
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  );

DROP TRIGGER IF EXISTS post_custom_meta_defs_set_updated_at ON public.post_custom_meta_defs;
CREATE TRIGGER post_custom_meta_defs_set_updated_at
  BEFORE UPDATE ON public.post_custom_meta_defs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) Per-post values (key → value)
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS custom_meta jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 3) Floating share bar toggle (post_layout_settings)
ALTER TABLE public.post_layout_settings
  ADD COLUMN IF NOT EXISTS show_floating_share_bar boolean NOT NULL DEFAULT true;
