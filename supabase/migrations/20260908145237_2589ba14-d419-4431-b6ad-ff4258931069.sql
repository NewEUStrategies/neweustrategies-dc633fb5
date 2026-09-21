ALTER TABLE public.site_design_tokens
  ADD COLUMN IF NOT EXISTS font_scale jsonb NOT NULL DEFAULT '{}'::jsonb;