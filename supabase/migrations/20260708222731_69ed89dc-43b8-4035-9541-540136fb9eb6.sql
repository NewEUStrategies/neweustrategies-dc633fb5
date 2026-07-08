
ALTER TABLE public.post_layout_settings
  ADD COLUMN IF NOT EXISTS overlay_title_size_base   smallint NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS overlay_title_size_md     smallint NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS overlay_title_size_lg     smallint NOT NULL DEFAULT 36,
  ADD COLUMN IF NOT EXISTS overlay_excerpt_size_base smallint NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS overlay_excerpt_size_md   smallint NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS overlay_excerpt_size_lg   smallint NOT NULL DEFAULT 16,
  ADD COLUMN IF NOT EXISTS header_title_size_base    smallint NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS header_title_size_md      smallint NOT NULL DEFAULT 36,
  ADD COLUMN IF NOT EXISTS header_title_size_lg      smallint NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS header_excerpt_size_base  smallint NOT NULL DEFAULT 16,
  ADD COLUMN IF NOT EXISTS header_excerpt_size_md    smallint NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS header_excerpt_size_lg    smallint NOT NULL DEFAULT 18;

ALTER TABLE public.post_layout_settings
  ADD CONSTRAINT post_layout_settings_font_size_range CHECK (
    overlay_title_size_base BETWEEN 10 AND 96 AND
    overlay_title_size_md   BETWEEN 10 AND 96 AND
    overlay_title_size_lg   BETWEEN 10 AND 96 AND
    overlay_excerpt_size_base BETWEEN 8 AND 48 AND
    overlay_excerpt_size_md   BETWEEN 8 AND 48 AND
    overlay_excerpt_size_lg   BETWEEN 8 AND 48 AND
    header_title_size_base  BETWEEN 12 AND 128 AND
    header_title_size_md    BETWEEN 12 AND 128 AND
    header_title_size_lg    BETWEEN 12 AND 128 AND
    header_excerpt_size_base BETWEEN 8 AND 48 AND
    header_excerpt_size_md   BETWEEN 8 AND 48 AND
    header_excerpt_size_lg   BETWEEN 8 AND 48
  );
