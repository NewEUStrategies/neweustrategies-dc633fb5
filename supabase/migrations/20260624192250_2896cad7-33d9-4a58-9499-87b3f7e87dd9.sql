CREATE TABLE IF NOT EXISTS public.related_posts_config (
  tenant_id            uuid PRIMARY KEY DEFAULT public.current_tenant_id() REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled              boolean NOT NULL DEFAULT true,
  position             text    NOT NULL DEFAULT 'end',
  after_paragraph      int     NOT NULL DEFAULT 3,
  layout               text    NOT NULL DEFAULT 'grid',
  columns              int     NOT NULL DEFAULT 3,
  items_limit          int     NOT NULL DEFAULT 6,
  source_strategy      text    NOT NULL DEFAULT 'both',
  show_excerpt         boolean NOT NULL DEFAULT true,
  show_meta            boolean NOT NULL DEFAULT true,
  show_cover           boolean NOT NULL DEFAULT true,
  recency_boost_days   int     NOT NULL DEFAULT 30,
  slider_autoplay      boolean NOT NULL DEFAULT false,
  slider_interval_ms   int     NOT NULL DEFAULT 5000,
  title_pl             text    NOT NULL DEFAULT 'Powiązane wpisy',
  title_en             text    NOT NULL DEFAULT 'Related posts',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.related_posts_config TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.related_posts_config TO authenticated;
GRANT ALL ON public.related_posts_config TO service_role;

ALTER TABLE public.related_posts_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Related posts config is publicly readable"
  ON public.related_posts_config FOR SELECT
  USING (true);

CREATE POLICY "Editors manage related posts config within tenant"
  ON public.related_posts_config FOR ALL
  TO authenticated
  USING (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  )
  WITH CHECK (
    tenant_id = public.current_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'editor'))
  );

DROP TRIGGER IF EXISTS related_posts_config_set_updated_at ON public.related_posts_config;
CREATE TRIGGER related_posts_config_set_updated_at
  BEFORE UPDATE ON public.related_posts_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.related_posts_config (tenant_id)
SELECT id FROM public.tenants
ON CONFLICT (tenant_id) DO NOTHING;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS related_override jsonb;