
-- Module E: Page templates
ALTER TABLE public.pages
  ADD COLUMN IF NOT EXISTS template_type text NOT NULL DEFAULT 'default',
  ADD COLUMN IF NOT EXISTS header_override text;

ALTER TABLE public.pages
  ADD CONSTRAINT pages_template_type_check
  CHECK (template_type IN ('default','full_width','landing','archive_listing','contact'));

-- Module F: Custom crop sizes
CREATE TABLE IF NOT EXISTS public.custom_crop_sizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  ratio_w integer NOT NULL CHECK (ratio_w > 0),
  ratio_h integer NOT NULL CHECK (ratio_h > 0),
  width integer NOT NULL CHECK (width > 0 AND width <= 4096),
  height integer NOT NULL CHECK (height > 0 AND height <= 4096),
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

GRANT SELECT ON public.custom_crop_sizes TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_crop_sizes TO authenticated;
GRANT ALL ON public.custom_crop_sizes TO service_role;

ALTER TABLE public.custom_crop_sizes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read crop sizes"
  ON public.custom_crop_sizes FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Tenant members can insert crop sizes"
  ON public.custom_crop_sizes FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "Tenant members can update crop sizes"
  ON public.custom_crop_sizes FOR UPDATE
  TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());

CREATE POLICY "Tenant members can delete crop sizes"
  ON public.custom_crop_sizes FOR DELETE
  TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE TRIGGER set_custom_crop_sizes_updated_at
  BEFORE UPDATE ON public.custom_crop_sizes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
