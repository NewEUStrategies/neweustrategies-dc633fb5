ALTER TABLE public.site_design_tokens
  ADD COLUMN IF NOT EXISTS global_colors jsonb NOT NULL DEFAULT '{}'::jsonb;