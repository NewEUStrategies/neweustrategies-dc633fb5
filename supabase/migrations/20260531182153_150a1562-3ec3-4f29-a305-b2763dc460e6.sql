CREATE TABLE public.pages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  author_id UUID,
  slug TEXT NOT NULL,
  title_pl TEXT NOT NULL DEFAULT '',
  title_en TEXT NOT NULL DEFAULT '',
  content_pl TEXT,
  content_en TEXT,
  editor editor_type NOT NULL DEFAULT 'richtext',
  status post_status NOT NULL DEFAULT 'draft',
  cover_image_url TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

GRANT SELECT ON public.pages TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pages TO authenticated;
GRANT ALL ON public.pages TO service_role;

ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public reads published pages"
  ON public.pages FOR SELECT
  TO anon, authenticated
  USING (status = 'published');

CREATE POLICY "Staff reads own tenant pages"
  ON public.pages FOR SELECT
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'editor') OR has_role(auth.uid(), 'author'))
  );

CREATE POLICY "Authors insert own tenant pages"
  ON public.pages FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND author_id = auth.uid()
    AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'editor') OR has_role(auth.uid(), 'author'))
  );

CREATE POLICY "Authors update tenant pages"
  ON public.pages FOR UPDATE
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'editor')
         OR (has_role(auth.uid(), 'author') AND author_id = auth.uid()))
  )
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY "Editors delete tenant pages"
  ON public.pages FOR DELETE
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'editor'))
  );

CREATE TRIGGER pages_set_updated_at
  BEFORE UPDATE ON public.pages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();