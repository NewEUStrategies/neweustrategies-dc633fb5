ALTER TABLE public.post_layout_settings
  ADD COLUMN IF NOT EXISTS title_size_source text NOT NULL DEFAULT 'theme';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'post_layout_settings_title_size_source_chk'
  ) THEN
    ALTER TABLE public.post_layout_settings
      ADD CONSTRAINT post_layout_settings_title_size_source_chk
      CHECK (title_size_source IN ('theme', 'layout'));
  END IF;
END $$;

COMMENT ON COLUMN public.post_layout_settings.title_size_source IS
  'theme = post title/excerpt sizes inherit global font sizes (--fs-h1/--fs-lead); layout = use per-breakpoint px values in this row.';