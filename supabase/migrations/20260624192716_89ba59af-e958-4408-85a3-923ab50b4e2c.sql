ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS slug         text,
  ADD COLUMN IF NOT EXISTS bio_pl       text,
  ADD COLUMN IF NOT EXISTS bio_en       text,
  ADD COLUMN IF NOT EXISTS cover_url    text,
  ADD COLUMN IF NOT EXISTS twitter_url  text,
  ADD COLUMN IF NOT EXISTS linkedin_url text,
  ADD COLUMN IF NOT EXISTS website_url  text;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_slug_unique
  ON public.profiles (slug) WHERE slug IS NOT NULL;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS featured_template_id uuid REFERENCES public.builder_templates(id) ON DELETE SET NULL;

ALTER TABLE public.tags
  ADD COLUMN IF NOT EXISTS featured_template_id uuid REFERENCES public.builder_templates(id) ON DELETE SET NULL;