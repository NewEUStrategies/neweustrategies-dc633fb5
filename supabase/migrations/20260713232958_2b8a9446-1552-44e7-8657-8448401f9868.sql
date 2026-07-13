ALTER TABLE public.expert_layout_settings
  ADD COLUMN IF NOT EXISTS bio_bullet_color text,
  ADD COLUMN IF NOT EXISTS bio_bullet_color_dark text;