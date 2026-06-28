
ALTER TABLE public.newsletter_settings
  ADD COLUMN IF NOT EXISTS popup_bg_color text DEFAULT '#0a0a0a',
  ADD COLUMN IF NOT EXISTS popup_text_color text DEFAULT '#ffffff',
  ADD COLUMN IF NOT EXISTS popup_muted_color text DEFAULT '#b8b8b8',
  ADD COLUMN IF NOT EXISTS popup_accent_color text DEFAULT '#f97316',
  ADD COLUMN IF NOT EXISTS popup_accent_text_color text DEFAULT '#ffffff',
  ADD COLUMN IF NOT EXISTS popup_overlay_color text DEFAULT 'rgba(0,0,0,0.7)',
  ADD COLUMN IF NOT EXISTS popup_border_radius_px int DEFAULT 16,
  ADD COLUMN IF NOT EXISTS popup_eyebrow_pl text DEFAULT 'Newsletter',
  ADD COLUMN IF NOT EXISTS popup_eyebrow_en text DEFAULT 'Newsletter';
