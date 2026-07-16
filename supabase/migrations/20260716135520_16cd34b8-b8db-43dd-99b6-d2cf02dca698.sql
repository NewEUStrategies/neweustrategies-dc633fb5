CREATE TABLE public.archive_layout_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  archive_type TEXT NOT NULL UNIQUE CHECK (archive_type IN ('category','tag')),
  layout_variant SMALLINT NOT NULL DEFAULT 2 CHECK (layout_variant BETWEEN 1 AND 6),
  columns SMALLINT NOT NULL DEFAULT 3 CHECK (columns BETWEEN 1 AND 4),
  list_style TEXT NOT NULL DEFAULT 'grid' CHECK (list_style IN ('grid','list','masonry')),
  show_hero BOOLEAN NOT NULL DEFAULT true,
  show_description BOOLEAN NOT NULL DEFAULT true,
  show_follow BOOLEAN NOT NULL DEFAULT true,
  show_breadcrumbs BOOLEAN NOT NULL DEFAULT true,
  show_sidebar BOOLEAN NOT NULL DEFAULT false,
  sidebar_position TEXT NOT NULL DEFAULT 'right' CHECK (sidebar_position IN ('left','right')),
  sidebar_widgets JSONB NOT NULL DEFAULT '["popular","related","newsletter","ads"]'::jsonb,
  show_featured_top BOOLEAN NOT NULL DEFAULT true,
  show_related_taxonomies BOOLEAN NOT NULL DEFAULT false,
  show_podcasts BOOLEAN NOT NULL DEFAULT true,
  hero_bg_style TEXT NOT NULL DEFAULT 'gradient' CHECK (hero_bg_style IN ('gradient','image','solid','pattern','mesh','minimal')),
  posts_per_page SMALLINT NOT NULL DEFAULT 60 CHECK (posts_per_page BETWEEN 6 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.archive_layout_settings TO anon, authenticated;
GRANT INSERT, UPDATE ON public.archive_layout_settings TO authenticated;
GRANT ALL ON public.archive_layout_settings TO service_role;

ALTER TABLE public.archive_layout_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Archive layout settings are viewable by everyone"
  ON public.archive_layout_settings FOR SELECT
  USING (true);

CREATE POLICY "Only admins can modify archive layout settings"
  ON public.archive_layout_settings FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.set_archive_layout_settings_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_archive_layout_settings_updated_at
  BEFORE UPDATE ON public.archive_layout_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_archive_layout_settings_updated_at();

INSERT INTO public.archive_layout_settings (archive_type, layout_variant) VALUES
  ('category', 2),
  ('tag', 2)
ON CONFLICT (archive_type) DO NOTHING;