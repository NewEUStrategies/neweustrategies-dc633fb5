-- Web Stories module
CREATE TABLE public.web_stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title_pl text NOT NULL DEFAULT '',
  title_en text NOT NULL DEFAULT '',
  description_pl text NOT NULL DEFAULT '',
  description_en text NOT NULL DEFAULT '',
  cover_url text,
  pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  published_at timestamptz,
  author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

GRANT SELECT ON public.web_stories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.web_stories TO authenticated;
GRANT ALL ON public.web_stories TO service_role;

ALTER TABLE public.web_stories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "web_stories public read published"
  ON public.web_stories FOR SELECT
  USING (status = 'published');

CREATE POLICY "web_stories tenant read all"
  ON public.web_stories FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_tenant_id());

CREATE POLICY "web_stories admin/editor insert"
  ON public.web_stories FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  );

CREATE POLICY "web_stories admin/editor update"
  ON public.web_stories FOR UPDATE
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  );

CREATE POLICY "web_stories admin delete"
  ON public.web_stories FOR DELETE
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND public.has_role(auth.uid(), 'admin')
  );

CREATE TRIGGER set_updated_at_web_stories
  BEFORE UPDATE ON public.web_stories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_web_stories_tenant_status ON public.web_stories(tenant_id, status, published_at DESC NULLS LAST);
